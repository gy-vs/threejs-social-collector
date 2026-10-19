import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { normalizeUrl, normalizedUrls, reviewIssue, successRecordIds, updateCounts } from './collector-utils.mjs';

const root = process.cwd();
const runtimeDir = path.join(root, '.runtime');
fs.mkdirSync(runtimeDir, { recursive: true });
const config = JSON.parse(fs.readFileSync(path.join(root, 'config/collector.json'), 'utf8'));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const aggregateOnly = args.includes('--aggregate-only');
const inputIndex = args.indexOf('--input');
const inputFile = inputIndex >= 0 ? args[inputIndex + 1] : null;
const runId = process.env.THREEJS_RUN_ID || `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
const marker = config.dedupe.remark_marker;
const target = config.feishu;
const installationFile = path.join(runtimeDir, 'local-collector.json');
if (!fs.existsSync(installationFile)) fs.writeFileSync(installationFile, JSON.stringify({ machine_id: crypto.randomUUID(), counting_epoch: new Date().toISOString() }, null, 2));
const installation = JSON.parse(fs.readFileSync(installationFile, 'utf8'));
const localCli = path.join(runtimeDir, 'lark/node_modules/.bin/lark-cli');
const cliBin = process.env.THREEJS_LARK_CLI || (fs.existsSync(localCli) ? localCli : 'lark-cli');
const journal = path.join(runtimeDir, 'writer-events.ndjson');
const timestamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
function log(event) { fs.appendFileSync(journal, JSON.stringify({ time: timestamp(), run_id: runId, ...event }) + '\n'); }

function cli(args, options = {}) {
  return execFileSync(cliBin, ['--profile', target.profile, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024
  });
}

function readRecords(source = target) {
  const all = [];
  let offset = 0;
  for (;;) {
    const outName = `.runtime/threejs-records-${process.pid}.ndjson`;
    const out = path.join(root, outName);
    try {
      const raw = cli(['base', '+record-list', '--base-token', source.base_token, '--table-id', source.table_id,
        '--field-id', '案例名称', '--field-id', '社媒链接', '--field-id', '代码仓库', '--field-id', '备注',
        '--limit', '2000', '--offset', String(offset), '--format', 'ndjson', '--output', outName, '--overwrite', '--as', target.as]);
      const summary = JSON.parse(raw);
      if (summary.ok === false) throw new Error('Failed to read dedupe index');
      const rows = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
      all.push(...rows);
      function pagination(object) {
        if (!object || typeof object !== 'object') return null;
        if (typeof object.has_more === 'boolean') return object;
        for (const value of Object.values(object)) {
          const found = pagination(value);
          if (found) return found;
        }
        return null;
      }
      const page = pagination(summary);
      if (page?.has_more === false || (!page && rows.length < 2000)) return all;
      if (!page || !Number.isInteger(page.next_offset) || page.next_offset <= offset) {
        throw new Error('Cannot confirm complete dedupe index: missing pagination metadata');
      }
      offset = page.next_offset;
    } finally {
      try { fs.unlinkSync(out); } catch {}
    }
  }
}

function readDedupeSnapshot() {
  const targetRecords = readRecords();
  const feedbackRecords = config.review_feedback ? readRecords(config.review_feedback) : [];
  return { targetRecords, allRecords: [...targetRecords, ...feedbackRecords] };
}

function makeIndexes(records) {
  const social = new Map();
  const repos = new Map();
  for (const row of records) {
    for (const url of normalizedUrls(row['社媒链接'])) social.set(url, row);
    for (const url of normalizedUrls(row['代码仓库'], 'repo')) repos.set(url, row);
  }
  return { social, repos };
}

function withMarker(remark = '') {
  let result = String(remark).trim();
  if (!result.includes(marker)) result += ` ${marker}`;
  if (!result.includes(`run:${runId}`)) result += `; run:${runId}`;
  if (!result.includes(`machine:${installation.machine_id}`)) result += `; machine:${installation.machine_id}`;
  if (!result.includes(`epoch:${installation.counting_epoch}`)) result += `; epoch:${installation.counting_epoch}`;
  return result.trim();
}

function readFields() {
  const result = JSON.parse(cli(['base', '+field-list', '--base-token', target.base_token,
    '--table-id', target.table_id, '--as', target.as]));
  if (result.ok === false) throw new Error('Cannot read target table fields');
  const fields = result.data?.fields || result.fields;
  if (!Array.isArray(fields)) throw new Error('Cannot confirm target table field schema');
  return new Map(fields.map((field) => [field.name || field.field_name, field]));
}

function mapFields(candidate, fields) {
  return Object.fromEntries(Object.entries(candidate).map(([name, value]) => {
    const field = fields.get(name);
    if (!field) throw new Error(`Target field missing: ${name}`);
    const type = field.type;
    if (['select', 3, 4].includes(type)) {
      const values = Array.isArray(value) ? value : [value];
      const options = field.options || field.property?.options;
      if (Array.isArray(options) && values.some((item) => !options.some((option) => (option.name || option) === item))) {
        throw new Error(`Target select options changed: ${name}`);
      }
      return [name, values];
    }
    if (['text', 'url', 1, 15].includes(type)) return [name, Array.isArray(value) ? value.join('、') : value];
    throw new Error(`Unsupported writable field type: ${name} (${type})`);
  }));
}

function updateCountFile({ recordIds = [], ...delta } = {}) {
  const file = path.join(root, config.count_file);
  const text = updateCounts(fs.readFileSync(file, 'utf8'), delta, recordIds, runId, timestamp());
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

const lock = path.join(runtimeDir, 'writer.lock');
if (!dryRun) {
  const fd = fs.openSync(lock, 'wx');
  fs.writeFileSync(fd, String(process.pid));
  fs.closeSync(fd);
  process.on('exit', () => { try { fs.unlinkSync(lock); } catch {} });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
}
process.on('uncaughtException', (error) => {
  const reason = error.code === 'ENOENT' ? 'lark-cli or required input not found'
    : error.stderr ? String(error.stderr).trim() : error.message;
  log({ event: 'stopped', reason });
  if (!dryRun) fs.appendFileSync(path.join(root, config.count_file), `\n\n${timestamp()} 运行 ${runId} 停止：${reason.replace(/\n/g, ' ')}。失败或结果不明的记录不计入成功数量；恢复前先查重。`);
  console.error(reason);
  process.exit(1);
});

if (aggregateOnly) {
  const records = readRecords();
  const owned = records.filter((row) => String(row['备注'] || '').includes(marker));
  const local = owned.filter((row) => String(row['备注']).includes(`machine:${installation.machine_id}`) && String(row['备注']).includes(`epoch:${installation.counting_epoch}`));
  console.log(JSON.stringify({ run_id: runId, table_records: records.length, remote_marked_records: owned.length, local_epoch_records: local.length, record_ids: local.map((row) => row.record_id).filter(Boolean) }, null, 2));
  // Remote aggregation is for reconciliation only. It never replaces this computer's success counter.
  updateCountFile({ tableRecords: records.length });
  process.exit(0);
}

if (!inputFile) throw new Error('usage: node scripts/feishu-sync.mjs --input candidates.json [--dry-run]');
const candidates = JSON.parse(fs.readFileSync(path.resolve(inputFile), 'utf8'));
if (!Array.isArray(candidates)) throw new Error('input must be a JSON array');
if (!dryRun) updateCountFile(); // Confirm the ledger is writable before any remote creation.
const snapshot = readDedupeSnapshot();
const records = snapshot.targetRecords;
const indexes = makeIndexes(snapshot.allRecords);
const fixedRejections = config.rejected_cases_file ? JSON.parse(fs.readFileSync(path.join(root, config.rejected_cases_file), 'utf8')).cases : [];
const unique = [];
const duplicates = [];
const rejected = [];
const acceptedPlatforms = new Set(config.accepted_platforms);
for (const candidate of candidates) {
  const social = normalizeUrl(candidate['社媒链接']);
  const repo = normalizeUrl(candidate['代码仓库'], 'repo');
  const hit = indexes.social.get(social) || indexes.repos.get(repo);
  if (hit) {
    duplicates.push({ name: candidate['案例名称'], existing_record_id: hit.record_id, existing_name: hit['案例名称'] });
    continue;
  }
  const forbidden = fixedRejections.find(item => (repo && repo === normalizeUrl(item.repo_url, 'repo')) || (social && social === normalizeUrl(item.social_url)));
  if (forbidden) {
    rejected.push({ name: candidate['案例名称'], reason: `fixed rejection: ${forbidden.name}: ${forbidden.reason}` });
    continue;
  }
  const issue = reviewIssue(candidate, config.rule_version || '1.3');
  if (issue) {
    rejected.push({ name: candidate['案例名称'], reason: issue });
    continue;
  }
  const required = ['案例名称', '平台', '社媒链接', '代码仓库', '作品类型', '技术标签', '亮点说明', '推荐程度', '核验状态', '质检', '原因'];
  const missing = required.filter((field) => candidate[field] === undefined || candidate[field] === null || candidate[field] === '');
  if (missing.length || !acceptedPlatforms.has(candidate['平台']) || candidate['核验状态'] !== '已核验' || candidate['质检'] !== '通过' || !['推荐', '重点推荐'].includes(candidate['推荐程度'])) {
    rejected.push({ name: candidate['案例名称'] || '(unnamed)', missing, reason: 'candidate does not satisfy the write gate' });
    continue;
  }
  if (!social || !repo) {
    rejected.push({ name: candidate['案例名称'] || '(unnamed)', missing: ['社媒链接或代码仓库'], reason: 'invalid public URL' });
    continue;
  }
  const { _review, ...fields } = candidate;
  unique.push({ ...fields, 备注: withMarker(candidate['备注']) });
  if (social) indexes.social.set(social, { record_id: `local:${unique.length}`, '案例名称': candidate['案例名称'] });
  if (repo) indexes.repos.set(repo, { record_id: `local:${unique.length}`, '案例名称': candidate['案例名称'] });
}

if (dryRun) {
  console.log(JSON.stringify({ run_id: runId, discovered: candidates.length, rejected, duplicates, create_records: unique }, null, 2));
  process.exit(0);
}

if (!unique.length) {
  updateCountFile({ discovered: candidates.length, duplicates: duplicates.length, rejected: rejected.length });
  console.log(JSON.stringify({ run_id: runId, created: [], rejected, duplicates }, null, 2));
  process.exit(0);
}

updateCountFile({ discovered: candidates.length, accepted: unique.length, duplicates: duplicates.length, rejected: rejected.length, tableRecords: records.length });
const recordIds = [];
const fields = readFields();
for (const candidate of unique) {
  // Refresh immediately before each creation. A local lock serializes this computer;
  // cross-computer strong consistency still requires a single shared writer.
  const latestSnapshot = readDedupeSnapshot();
  const latest = latestSnapshot.targetRecords;
  const fresh = makeIndexes(latestSnapshot.allRecords);
  const hit = fresh.social.get(normalizeUrl(candidate['社媒链接'])) || fresh.repos.get(normalizeUrl(candidate['代码仓库'], 'repo'));
  if (hit) {
    duplicates.push({ name: candidate['案例名称'], existing_record_id: hit.record_id });
    updateCountFile({ duplicates: 1, tableRecords: latest.length });
    log({ event: 'duplicate', name: candidate['案例名称'], record_id: hit.record_id });
    continue;
  }
  const payloadName = `.runtime/threejs-create-${process.pid}.json`;
  const payloadPath = path.join(root, payloadName);
  const payload = { create_records: [mapFields(candidate, fields)] };
  fs.writeFileSync(payloadPath, JSON.stringify(payload));
  log({ event: 'create_started', name: candidate['案例名称'], social: candidate['社媒链接'], repo: candidate['代码仓库'] });
  let result;
  try {
    const raw = cli(['base', '+record-batch-create', '--base-token', target.base_token, '--table-id', target.table_id, '--json', `@${payloadName}`, '--as', target.as]);
    result = JSON.parse(raw);
  } finally {
    try { fs.unlinkSync(payloadPath); } catch {}
  }
  const ids = successRecordIds(result);
  log({ event: 'created', name: candidate['案例名称'], record_ids: ids });
  updateCountFile({ recordIds: ids, tableRecords: latest.length + 1 });
  recordIds.push(...ids);
  console.log(JSON.stringify({ event: 'created', name: candidate['案例名称'], record_ids: ids }));
}
console.log(JSON.stringify({ run_id: runId, discovered: candidates.length, accepted: unique.length, rejected, duplicates, record_ids: recordIds }, null, 2));
