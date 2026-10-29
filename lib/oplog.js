const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const LOG_DIR = path.join(DATA_DIR, 'logs');
const KEEP_DAYS = 30;

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* 忽略 */ }
}

// 日志按本地日期分文件：ops-YYYY-MM-DD.jsonl
function dayKey(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clientIp(req) {
  let ip = String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1' || ip === '') ip = ip === '::1' ? '127.0.0.1' : '未知';
  return ip;
}

// 记录一条文件操作。写日志失败不影响主流程。
function logOperation(req, action, detail, status = 'ok', extra = {}) {
  const entry = { at: Date.now(), ip: clientIp(req), action, detail, status, ...extra };
  ensureLogDir();
  const line = JSON.stringify(entry) + '\n';
  fs.appendFile(path.join(LOG_DIR, `ops-${dayKey()}.jsonl`), line, (err) => {
    if (err) console.error('写操作日志失败:', err.message);
  });
  return entry;
}

function listDays() {
  ensureLogDir();
  let names = [];
  try { names = fs.readdirSync(LOG_DIR); } catch { return []; }
  return names
    .filter(n => /^ops-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
    .map(n => n.slice(4, -6))
    .sort()
    .reverse();
}

function readDay(day, limit) {
  let text;
  try { text = fs.readFileSync(path.join(LOG_DIR, `ops-${day}.jsonl`), 'utf8'); } catch { return []; }

  const lines = text.split('\n');
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* 忽略坏行 */ }
  }
  return out;
}

// 默认从最新的一天往回读，凑够 limit 条
function readLogs({ limit = 200, day = '' } = {}) {
  const max = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const days = listDays();

  if (day) {
    return { days, entries: days.includes(day) ? readDay(day, max) : [] };
  }

  const entries = [];
  for (const d of days) {
    entries.push(...readDay(d, max - entries.length));
    if (entries.length >= max) break;
  }
  return { days, entries };
}

// 只保留最近 KEEP_DAYS 天，避免日志目录无限增长
function pruneLogs(keepDays = KEEP_DAYS) {
  const old = listDays().slice(keepDays);
  let removed = 0;
  for (const d of old) {
    try {
      fs.unlinkSync(path.join(LOG_DIR, `ops-${d}.jsonl`));
      removed++;
    } catch { /* 忽略 */ }
  }
  return removed;
}

module.exports = { LOG_DIR, KEEP_DAYS, logOperation, readLogs, pruneLogs };
