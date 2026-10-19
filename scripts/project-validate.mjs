import fs from 'node:fs';

const required = ['rule.md', '抓取规范.md', '统计数量.md', 'config/collector.json', 'candidates.example.json'];
for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`missing required project file: ${file}`);
}
const config = JSON.parse(fs.readFileSync('config/collector.json', 'utf8'));
if (config.feishu.profile !== 'codex-base-writer') throw new Error('unexpected Feishu profile');
if (!config.feishu.base_token || !config.feishu.table_id) throw new Error('missing Feishu target');
if (!config.dedupe.remark_marker) throw new Error('missing cross-machine marker');
const candidates = JSON.parse(fs.readFileSync('candidates.example.json', 'utf8'));
if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('example candidates must be a non-empty array');
console.log('project validation passed');
