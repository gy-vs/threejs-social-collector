export function normalizeUrl(value, kind = '') {
  if (value && typeof value === 'object') value = value.link || value.url || value.text || '';
  const text = String(value || '').replace(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, '$1');
  const raw = text.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.;]+$/, '');
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { return ''; }
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  if (kind === 'repo') {
    url.search = '';
    url.pathname = url.pathname.replace(/\/$/, '').replace(/\.git$/, '');
    if (url.hostname === 'github.com') url.pathname = '/' + url.pathname.split('/').filter(Boolean).slice(0, 2).join('/').toLowerCase();
  } else if (['youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) {
    const id = url.hostname === 'youtu.be' ? url.pathname.split('/')[1]
      : url.pathname === '/watch' ? url.searchParams.get('v')
      : /^\/(shorts|live|embed)\//.test(url.pathname) ? url.pathname.split('/')[2] : null;
    if (!id) return '';
    return `https://youtube.com/watch?v=${encodeURIComponent(id)}`;
  } else {
    if (['twitter.com', 'mobile.twitter.com', 'mobile.x.com'].includes(url.hostname)) url.hostname = 'x.com';
    if (url.hostname === 'x.com') {
      const id = url.pathname.match(/\/status\/(\d+)/)?.[1];
      if (!id) return '';
      return `https://x.com/i/status/${id}`;
    }
    url.search = '';
  }
  url.protocol = 'https:';
  return url.toString().replace(/\/$/, '');
}

export function normalizedUrls(value, kind = '') {
  if (Array.isArray(value)) return [...new Set(value.flatMap(item => normalizedUrls(item, kind)))];
  if (value && typeof value === 'object') return normalizedUrls(value.link || value.url || value.text || '', kind);
  const text = String(value || '').replace(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, '$1');
  return [...new Set((text.match(/https?:\/\/[^\s<>]+/gi) || []).map(url => normalizeUrl(url, kind)).filter(Boolean))];
}

export function reviewIssue(candidate, requiredVersion = '1.3') {
  const review = candidate._review;
  if (!review || review.rule_version !== requiredVersion) return `requires human review under rule ${requiredVersion}`;
  if (review.publication_kind !== 'showcase') return 'tutorial/course/technical walkthrough is not an accepted showcase submission';
  if (!review.media_observations?.trim()) return 'actual media observations are required';
  if (!Array.from({ length: 9 }, (_, i) => `R${i + 1}`).every(rule => review.checks?.[rule] === true)) return 'R1-R9 are not all passed';
  return null;
}

export function successRecordIds(result) {
  if (result.ok === false || (result.code !== undefined && result.code !== 0)) throw new Error('Feishu rejected record creation');
  const ids = result.record_id_list || result.data?.record_id_list;
  if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== 'string' || !ids[0].trim()) {
    throw new Error('Creation outcome unconfirmed: expected exactly one record_id; do not retry blindly');
  }
  return ids;
}

export function updateCounts(text, delta = {}, recordIds = [], runId = '', timestamp = '') {
  const fields = { discovered: '抓取发现数量', accepted: '质检通过数量', duplicates: '重复跳过数量', rejected: '淘汰 / 待核验数量' };
  for (const [key, label] of Object.entries(fields)) {
    if (delta[key] === undefined) continue;
    const pattern = new RegExp(`\\| ${label} \\| (\\d+) \\|`);
    if (!pattern.test(text)) throw new Error(`Missing count row: ${label}`);
    text = text.replace(pattern, (_, previous) => `| ${label} | ${Number(previous) + delta[key]} |`);
  }
  const writtenPattern = /\| \*\*写入飞书成功数量\*\* \| \*\*(\d+)\*\* \|/;
  if (!writtenPattern.test(text)) throw new Error('Missing successful-write count row');
  const seen = new Set(text.match(/\brec[A-Za-z0-9]+\b/g) || []);
  const fresh = [...new Set(recordIds)].filter((id) => !seen.has(id));
  const previous = Number(text.match(writtenPattern)[1]);
  const total = delta.written === undefined ? previous + fresh.length : Math.max(previous, delta.written);
  text = text.replace(writtenPattern, `| **写入飞书成功数量** | **${total}** |`);
  if (delta.tableRecords !== undefined) text = text.replace(/\| 飞书表当前总记录数 \| \d+ \|/, `| 飞书表当前总记录数 | ${delta.tableRecords} |`);
  if (fresh.length) text += `\n\n${timestamp} 运行 ${runId} 成功写入 Record ID：${fresh.join('、')}。`;
  return text;
}
