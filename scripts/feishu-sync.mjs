import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

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

function normalizeUrl(value, kind = '') {
  if (!value) return '';
  let url = String(value).trim();
  const markdownUrl = url.match(/\]\((https?:\/\/[^)]+)\)/i);
  if (markdownUrl) url = markdownUrl[1];
  const rawUrl = url.match(/https?:\/\/\S+/i);
  if (rawUrl) url = rawUrl[0].replace(/[),.;]+$/, '');
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    parsed.search = '';
    url = parsed.toString().replace(/\/$/, '');
  } catch {
    url = url.replace(/[?#].*$/, '').replace(/\/$/, '');
  }
  if (kind === 'repo') url = url.replace(/\.git$/, '');
  return url;
}

function cli(args, options = {}) {
  return execFileSync('lark-cli', ['--profile', target.profile, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe']
  });
}

function readRecords() {
  const outName = `.runtime/threejs-records-${process.pid}.ndjson`;
  const out = path.join(root, outName);
  try {
    cli(['base', '+record-list', '--base-token', target.base_token, '--table-id', target.table_id,
      '--field-id', '案例名称', '--field-id', '社媒链接', '--field-id', '代码仓库', '--field-id', '备注',
      '--limit', '2000', '--format', 'ndjson', '--output', outName, '--as', target.as]);
    return fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } finally {
    try { fs.unlinkSync(out); } catch {}
  }
}

function makeIndexes(records) {
  const social = new Map();
  const repos = new Map();
  for (const row of records) {
    const socialUrl = normalizeUrl(row['社媒链接']);
    const repoUrl = normalizeUrl(row['代码仓库'], 'repo');
    if (socialUrl) social.set(socialUrl, row);
    if (repoUrl) repos.set(repoUrl, row);
  }
  return { social, repos };
}

function withMarker(remark = '') {
  const suffix = `${marker}; run:${runId}`;
  return String(remark).includes(marker) ? String(remark) : `${String(remark).trim()} ${suffix}`.trim();
}

function updateCountFile({ discovered = 0, accepted = 0, duplicates = 0, rejected = 0, written = null, recordIds = [] }) {
  const file = path.join(root, config.count_file);
  let text = fs.readFileSync(file, 'utf8');
  const currentWritten = Number(text.match(/\| \*\*写入飞书成功数量\*\* \| \*\*(\d+)\*\* \|/)?.[1] || 0);
  const totalWritten = written === null ? currentWritten : written;
  const replacements = [
    [/\| 抓取发现数量 \| \d+ \|/, `| 抓取发现数量 | ${discovered} |`],
    [/\| 质检通过数量 \| \d+ \|/, `| 质检通过数量 | ${accepted} |`],
    [/\| 重复跳过数量 \| \d+ \|/, `| 重复跳过数量 | ${duplicates} |`],
    [/\| 淘汰 \/ 待核验数量 \| \d+ \|/, `| 淘汰 / 待核验数量 | ${rejected} |`],
    [/\| \*\*写入飞书成功数量\*\* \| \*\*\d+\*\* \|/, `| **写入飞书成功数量** | **${totalWritten}** |`]
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  if (recordIds.length) text += `\n\n本次运行 ${runId} 成功写入 Record ID：${recordIds.join('、')}。`;
  fs.writeFileSync(file, text);
}

if (aggregateOnly) {
  const records = readRecords();
  const owned = records.filter((row) => String(row['备注'] || '').includes(marker));
  const projectWritten = Number(config.legacy_confirmed_written || 0) + owned.length;
  console.log(JSON.stringify({ run_id: runId, table_records: records.length, project_written_records: projectWritten, marked_records: owned.length, record_ids: owned.map((row) => row.record_id).filter(Boolean) }, null, 2));
  updateCountFile({ written: projectWritten });
  process.exit(0);
}

if (!inputFile) throw new Error('usage: node scripts/feishu-sync.mjs --input candidates.json [--dry-run]');
const candidates = JSON.parse(fs.readFileSync(path.resolve(inputFile), 'utf8'));
if (!Array.isArray(candidates)) throw new Error('input must be a JSON array');
const records = readRecords();
const indexes = makeIndexes(records);
const unique = [];
const duplicates = [];
const rejected = [];
const acceptedPlatforms = new Set(config.accepted_platforms);
for (const candidate of candidates) {
  const required = ['案例名称', '平台', '社媒链接', '代码仓库', '作品类型', '技术标签', '亮点说明', '推荐程度', '核验状态', '质检', '原因'];
  const missing = required.filter((field) => candidate[field] === undefined || candidate[field] === null || candidate[field] === '');
  if (missing.length || !acceptedPlatforms.has(candidate['平台']) || candidate['核验状态'] !== '已核验' || candidate['质检'] !== '通过') {
    rejected.push({ name: candidate['案例名称'] || '(unnamed)', missing, reason: 'candidate does not satisfy the write gate' });
    continue;
  }
  const social = normalizeUrl(candidate['社媒链接']);
  const repo = normalizeUrl(candidate['代码仓库'], 'repo');
  if (!social || !repo) {
    rejected.push({ name: candidate['案例名称'] || '(unnamed)', missing: ['社媒链接或代码仓库'], reason: 'invalid public URL' });
    continue;
  }
  const hit = indexes.social.get(social) || indexes.repos.get(repo);
  if (hit) {
    duplicates.push({ name: candidate['案例名称'], existing_record_id: hit.record_id, existing_name: hit['案例名称'] });
    continue;
  }
  unique.push({ ...candidate, 备注: withMarker(candidate['备注']) });
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

const payloadName = `.runtime/threejs-create-${process.pid}.json`;
const payloadPath = path.join(root, payloadName);
const payload = { create_records: unique };
fs.writeFileSync(payloadPath, JSON.stringify(payload));
let result;
try {
  const raw = cli(['base', '+record-batch-create', '--base-token', target.base_token, '--table-id', target.table_id, '--json', `@${payloadName}`, '--as', target.as]);
  result = JSON.parse(raw);
} finally {
  try { fs.unlinkSync(payloadPath); } catch {}
}
const recordIds = result.record_id_list || result.data?.record_id_list || [];
const priorWritten = Number(fs.readFileSync(path.join(root, config.count_file), 'utf8').match(/\| \*\*写入飞书成功数量\*\* \| \*\*(\d+)\*\* \|/)?.[1] || 0);
updateCountFile({ discovered: candidates.length, accepted: unique.length, duplicates: duplicates.length, rejected: rejected.length, written: priorWritten + recordIds.length, recordIds });
console.log(JSON.stringify({ run_id: runId, discovered: candidates.length, accepted: unique.length, rejected, duplicates, record_ids: recordIds }, null, 2));
