import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { normalizeUrl, normalizedUrls, successRecordIds, updateCounts } from './collector-utils.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
test('YouTube identity survives tracking removal and URL variants', () => {
  assert.equal(normalizeUrl('https://youtu.be/abc?si=tracking'), 'https://youtube.com/watch?v=abc');
  assert.equal(normalizeUrl('https://www.youtube.com/watch?v=abc&t=20'), normalizeUrl('https://youtube.com/shorts/abc'));
  assert.notEqual(normalizeUrl('https://youtube.com/watch?v=abc'), normalizeUrl('https://youtube.com/watch?v=def'));
  assert.equal(normalizeUrl('https://youtube.com/@author'), '');
});
test('repository and X aliases merge without merging different works', () => {
  assert.equal(normalizeUrl('https://github.com/Author/Repo.git/', 'repo'), 'https://github.com/author/repo');
  assert.equal(normalizeUrl('https://twitter.com/author/status/123?s=20'), normalizeUrl('https://x.com/i/status/123'));
  assert.equal(normalizeUrl('garbage', 'repo'), '');
});
test('all links in a cell and fixed-commit GitHub URLs share a repo identity', () => {
  assert.deepEqual(normalizedUrls('[a](https://github.com/Owner/Repo/tree/abc) https://github.com/other/work','repo'), ['https://github.com/owner/repo','https://github.com/other/work']);
  assert.equal(normalizeUrl('[https://github.com/QSOLKCB/QNTOY](https://github.com/QSOLKCB/QNTOY)','repo'), 'https://github.com/qsolkcb/qntoy');
  assert.deepEqual(normalizedUrls('[https://github.com/QSOLKCB/QNTOY](https://github.com/QSOLKCB/QNTOY)','repo'), ['https://github.com/qsolkcb/qntoy']);
});
test('failure and unknown creation outcomes cannot increase success count', () => {
  assert.throws(() => successRecordIds({ ok: false, data: { record_id_list: ['recA'] } }));
  assert.throws(() => successRecordIds({ ok: true, data: {} }));
  assert.throws(() => successRecordIds({ record_id_list: ['recA', 'recB'] }));
  assert.deepEqual(successRecordIds({ ok: true, data: { record_id_list: ['recA'] } }), ['recA']);
});
test('incremental ledger preserves counters and counts a record ID only once', () => {
  const original = fs.readFileSync(path.join(project, '统计数量.md'), 'utf8');
  const base = Number(original.match(/\*\*写入飞书成功数量\*\* \| \*\*(\d+)/)[1]);
  const once = updateCounts(original, { discovered: 2, accepted: 1 }, ['recTestUnique'], 'test', '2026-10-19');
  const twice = updateCounts(once, {}, ['recTestUnique'], 'test', '2026-10-19');
  assert.equal(once, twice);
  assert.match(twice, new RegExp(`写入飞书成功数量\\*\\* \\| \\*\\*${base + 1}`));
  const aggregate = updateCounts(twice, { written: base - 1 });
  assert.equal(aggregate, twice);
});

function fixture(t, mode = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'threejs-writer-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'config'));
  for (const file of ['scripts/feishu-sync.mjs', 'scripts/collector-utils.mjs', 'config/collector.json', 'config/rejected-cases.json', '统计数量.md']) {
    fs.copyFileSync(path.join(project, file), path.join(dir, file));
  }
  const candidate = JSON.parse(fs.readFileSync(path.join(project, 'candidates.example.json'), 'utf8'))[0];
  candidate._review = { rule_version:'1.3', publication_kind:'showcase', media_observations:'Offline fixture: complete scene and observed interaction.', checks:Object.fromEntries(Array.from({length:9},(_,i)=>[`R${i+1}`,true])) };
  const input = [1, 2].map((n) => ({ ...candidate, 案例名称: `Work ${n}`, 社媒链接: `https://www.youtube.com/watch?v=work${n}`, 代码仓库: `https://github.com/example/work${n}` }));
  fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify(input));
  const baseline = Number(fs.readFileSync(path.join(dir, '统计数量.md'), 'utf8').match(/\*\*写入飞书成功数量\*\* \| \*\*(\d+)/)[1]);
  const mock = path.join(dir, 'mock-cli.cjs');
  fs.writeFileSync(mock, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const flag = (key) => args[args.indexOf(key) + 1];
const state = fs.existsSync('mock-state.json') ? JSON.parse(fs.readFileSync('mock-state.json')) : { rows: [], reads: 0, creates: 0 };
const save = () => fs.writeFileSync('mock-state.json', JSON.stringify(state));
const mode = process.env.TEST_MODE;
if (mode === 'auth-failure') { console.error('not configured'); process.exit(3); }
if (args.includes('+field-list')) {
  const sample = JSON.parse(fs.readFileSync('input.json'))[0];
  console.log(JSON.stringify({ok:true,data:{fields:Object.keys(sample).map(name=>({name,type:name==='技术标签'?'select':'text'}))}}));
} else if (args.includes('+record-list')) {
  state.reads++;
  let rows = state.rows;
  if(mode==='feedback-duplicate') rows=flag('--table-id')===JSON.parse(fs.readFileSync('config/collector.json')).review_feedback.table_id ? [JSON.parse(fs.readFileSync('input.json'))[0]] : state.rows;
  if (mode === 'late-duplicate' && state.reads > 1) rows = [JSON.parse(fs.readFileSync('input.json'))[0]];
  const offset = Number(flag('--offset'));
  if (mode === 'pagination' && offset === 0) rows = [{record_id:'recOld',案例名称:'Old',社媒链接:'https://youtube.com/watch?v=old',代码仓库:'https://github.com/example/old'}];
  fs.writeFileSync(flag('--output'), rows.map(row=>JSON.stringify(row)).join('\\n'));
  save();
  console.log(JSON.stringify({ok:true,data:{has_more:mode==='pagination'&&offset===0,next_offset:offset+rows.length}}));
} else if (args.includes('+record-batch-create')) {
  const payload=JSON.parse(fs.readFileSync(flag('--json').slice(1)));
  if(payload.create_records.length!==1) throw Error('must create one at a time');
  if('_review' in payload.create_records[0]) throw Error('local audit metadata must not be sent as table fields');
  const ledger=fs.readFileSync('统计数量.md','utf8');
  const count=Number(ledger.match(/\\*\\*写入飞书成功数量\\*\\* \\| \\*\\*(\\d+)/)[1]);
  if(count!==Number(process.env.TEST_BASELINE)+state.creates) throw Error('previous success was not persisted immediately');
  state.creates++;
  state.rows.push({...payload.create_records[0],record_id:'recMock'+state.creates});
  save();
  if(mode==='fail-second'&&state.creates===2){ console.error('field option changed');process.exit(1); }
  console.log(JSON.stringify({ok:true,data:mode==='missing-id'?{}:{record_id_list:['recMock'+state.creates]}}));
} else throw Error('unexpected command');
`);
  fs.chmodSync(mock, 0o755);
  const run = (extra = []) => spawnSync(process.execPath, [path.join(dir, 'scripts/feishu-sync.mjs'), '--input', 'input.json', ...extra], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, THREEJS_LARK_CLI: mock, TEST_MODE: mode, TEST_BASELINE: String(baseline) }
  });
  return { dir, baseline, run, ledger: () => fs.readFileSync(path.join(dir, '统计数量.md'), 'utf8'), state: () => JSON.parse(fs.readFileSync(path.join(dir, 'mock-state.json'))) };
}
test('serial creation persists each success before sending the next record', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.state().creates, 2);
  assert.match(f.ledger(), /recMock1/);
  assert.match(f.ledger(), /recMock2/);
  const retry = f.run();
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(f.state().creates, 2, 'repeated input must not create duplicate records');
});
test('a later write failure preserves the earlier successful ID and stops', (t) => {
  const f = fixture(t, 'fail-second');
  assert.equal(f.run().status, 1);
  assert.match(f.ledger(), /recMock1/);
  assert.doesNotMatch(f.ledger(), /recMock2/);
  assert.match(f.ledger(), /field option changed/);
});
test('a record appearing between initial and final dedupe is skipped', (t) => {
  const f = fixture(t, 'late-duplicate');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.state().creates, 1);
});
test('dedupe reads every page before writing', (t) => {
  const f = fixture(t, 'pagination');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.state().creates, 2);
  assert.ok(f.state().reads >= 6);
});
test('missing record ID stops and does not count an unconfirmed write', (t) => {
  const f = fixture(t, 'missing-id');
  assert.equal(f.run().status, 1);
  assert.equal(f.state().creates, 1);
  assert.match(f.ledger(), /Creation outcome unconfirmed/);
  assert.match(f.ledger(), new RegExp(`写入飞书成功数量\\*\\* \\| \\*\\*${f.baseline}`));
});
test('authentication failure is logged with zero remote writes', (t) => {
  const f = fixture(t, 'auth-failure');
  assert.equal(f.run().status, 1);
  assert.match(f.ledger(), /not configured/);
  assert.match(f.ledger(), new RegExp(`写入飞书成功数量\\*\\* \\| \\*\\*${f.baseline}`));
});
test('dry run previews without writing records or updating the ledger', (t) => {
  const f = fixture(t);
  const before = f.ledger();
  const result = f.run(['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.state().creates, 0);
  assert.equal(f.ledger(), before);
});
test('remote aggregation never counts another computer records as local successes', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'mock-state.json'), JSON.stringify({ rows: [{record_id:'recOtherMachine',备注:'collector:threejs-social-collector; machine:other'}], reads:0, creates:0 }));
  const result = f.run(['--aggregate-only']);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.remote_marked_records, 1);
  assert.equal(summary.local_epoch_records, 0);
  assert.match(f.ledger(), new RegExp(`写入飞书成功数量\\*\\* \\| \\*\\*${f.baseline}`));
});
test('tutorials and stale review versions cannot write despite passed labels', (t) => {
  const f=fixture(t);
  const input=JSON.parse(fs.readFileSync(path.join(f.dir,'input.json')));
  input[0]._review.publication_kind='tutorial';
  input[1]._review.rule_version='1.2';
  fs.writeFileSync(path.join(f.dir,'input.json'),JSON.stringify(input));
  const result=f.run();
  assert.equal(result.status,0,result.stderr);
  assert.equal(f.state().creates,0);
  assert.equal(JSON.parse(result.stdout).rejected.length,2);
});
test('fixed rejected repositories cannot pass by changing the case title', (t) => {
  const f=fixture(t);
  const input=JSON.parse(fs.readFileSync(path.join(f.dir,'input.json')));
  for(const item of input)item['代码仓库']='https://github.com/QSOLKCB/QNTOY/tree/4a9612e3dd';
  fs.writeFileSync(path.join(f.dir,'input.json'),JSON.stringify(input));
  const result=f.run();
  assert.equal(result.status,0,result.stderr);
  assert.equal(f.state().creates,0);
  assert.ok(JSON.parse(result.stdout).rejected.every(row=>row.reason.startsWith('fixed rejection:')));
});
test('duplicates are skipped before quality checks even if metadata is missing', (t) => {
  const f=fixture(t);
  const input=JSON.parse(fs.readFileSync(path.join(f.dir,'input.json')));
  fs.writeFileSync(path.join(f.dir,'mock-state.json'),JSON.stringify({rows:input,reads:0,creates:0}));
  fs.writeFileSync(path.join(f.dir,'input.json'),JSON.stringify(input.map(item=>({'社媒链接':item['社媒链接'],'代码仓库':item['代码仓库']}))));
  const result=f.run();
  assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(result.stdout);
  assert.equal(summary.duplicates.length,2);
  assert.equal(summary.rejected.length,0);
  assert.equal(f.state().creates,0);
});
test('a duplicate found only in the acceptance feedback table is skipped', (t) => {
  const f=fixture(t,'feedback-duplicate');
  const result=f.run();
  assert.equal(result.status,0,result.stderr);
  assert.equal(f.state().creates,1);
  assert.equal(JSON.parse(result.stdout.trim().split('\n').slice(1).join('\n')).duplicates.length,1);
});
