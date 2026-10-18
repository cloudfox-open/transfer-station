const fs = require('fs');
const path = require('path');
const { TRASH_DIR } = require('./config');
const { moveSync, uniqueTargetPath } = require('./util');

// 每次删除生成一个批次目录，里面是原封不动搬过来的文件 + meta.json
function newBatchId() {
  const t = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

function batchDir(id) {
  return path.join(TRASH_DIR, id);
}

// 把若干路径移入回收站
function trashPaths(paths) {
  const id = newBatchId();
  const dir = batchDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const items = [];
  const failed = [];

  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) throw new Error('对象不存在');
      const name = path.basename(p);
      const stored = uniqueTargetPath(dir, name);
      const isDir = fs.statSync(p).isDirectory();
      moveSync(p, stored);
      items.push({
        name,
        stored: path.basename(stored),
        originalPath: p,
        isDir,
        size: isDir ? 0 : (fs.statSync(stored).size || 0)
      });
    } catch (err) {
      failed.push({ path: p, error: err.message });
    }
  }

  if (items.length === 0) {
    try { fs.rmdirSync(dir); } catch { /* 忽略 */ }
    return { id: null, items, failed };
  }

  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, at: Date.now(), items }, null, 2), 'utf8');
  return { id, items, failed };
}

function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(batchDir(id), 'meta.json'), 'utf8'));
  } catch { return null; }
}

// 回收站内容：按时间倒序，附带每条是否还真实存在
function listTrash() {
  let ids;
  try { ids = fs.readdirSync(TRASH_DIR); } catch { return []; }

  const batches = [];
  for (const id of ids) {
    const meta = readMeta(id);
    if (!meta) continue;
    const items = (meta.items || []).map(it => ({
      ...it,
      exists: fs.existsSync(path.join(batchDir(id), it.stored))
    }));
    batches.push({ id, at: meta.at || 0, items });
  }
  batches.sort((a, b) => b.at - a.at);
  return batches;
}

function trashCount() {
  return listTrash().reduce((s, b) => s + b.items.length, 0);
}

// 还原整个批次；原位置已被占用时自动改名，不覆盖
function restoreBatch(id) {
  const meta = readMeta(id);
  if (!meta) return { restored: [], failed: [{ path: id, error: '回收站批次不存在' }] };

  const dir = batchDir(id);
  const restored = [];
  const failed = [];

  for (const it of meta.items) {
    const src = path.join(dir, it.stored);
    try {
      if (!fs.existsSync(src)) throw new Error('回收站中的文件已丢失');
      const parent = path.dirname(it.originalPath);
      fs.mkdirSync(parent, { recursive: true });
      const dest = uniqueTargetPath(parent, it.name);
      moveSync(src, dest);
      restored.push({ from: src, to: dest });
    } catch (err) {
      failed.push({ path: it.originalPath, error: err.message });
    }
  }

  if (failed.length === 0) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* 忽略 */ }
  } else {
    // 部分失败：把还留在批次里的条目写回 meta，避免误删
    try { fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8'); } catch { /* 忽略 */ }
  }

  return { restored, failed };
}

function emptyTrash() {
  let ids;
  try { ids = fs.readdirSync(TRASH_DIR); } catch { return { removed: 0 }; }
  let removed = 0;
  for (const id of ids) {
    try {
      fs.rmSync(path.join(TRASH_DIR, id), { recursive: true, force: true });
      removed++;
    } catch { /* 忽略 */ }
  }
  return { removed };
}

module.exports = { trashPaths, listTrash, trashCount, restoreBatch, emptyTrash };
