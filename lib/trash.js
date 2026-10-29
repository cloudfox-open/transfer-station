const fs = require('fs');
const path = require('path');
const { TRASH_DIR, DATA_DIR, IS_WINDOWS } = require('./config');
const { moveSync, uniqueTargetPath, pathKey } = require('./util');

// 跨盘删除如果搬进项目目录所在的盘，只能整份复制，几 GB 就要几十秒。
// 所以每个盘用自己根目录下的隐藏目录做回收站，删除 / 还原都是同盘 rename。
const VOLUME_TRASH_NAME = '.transfer-station-trash';
const ROOTS_FILE = path.join(DATA_DIR, 'trash-roots.json');
const BATCH_ID_RE = /^[A-Za-z0-9_-]+$/;

// 每次删除生成一个批次目录，里面是原封不动搬过来的文件 + meta.json
function newBatchId() {
  const t = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
}

// 已登记过的「同盘回收站」根目录（全局回收站始终在列表里）
function readRoots() {
  try {
    const list = JSON.parse(fs.readFileSync(ROOTS_FILE, 'utf8'));
    return Array.isArray(list) ? list.filter(r => typeof r === 'string' && r) : [];
  } catch { return []; }
}

function registerRoot(root) {
  const list = readRoots();
  if (list.some(r => pathKey(r) === pathKey(root))) return;
  list.push(root);
  try { fs.writeFileSync(ROOTS_FILE, JSON.stringify(list, null, 2), 'utf8'); } catch { /* 忽略 */ }
}

function knownRoots() {
  const roots = new Set([TRASH_DIR]);
  readRoots().forEach(r => {
    try { if (fs.statSync(r).isDirectory()) roots.add(path.normalize(r)); } catch { /* 已不存在 */ }
  });
  // Windows 上顺手扫一遍盘符，登记文件丢了也能找回回收站
  if (IS_WINDOWS) {
    for (let code = 67; code <= 90; code++) {
      const candidate = path.join(String.fromCharCode(code) + ':', VOLUME_TRASH_NAME);
      try { if (fs.statSync(candidate).isDirectory()) roots.add(candidate); } catch { /* 忽略 */ }
    }
  }
  return [...roots];
}

// 一直向上找到目标所在卷的挂载点（Linux 的 /mnt/usb、Windows 的 C:\）
function volumeRootOf(target) {
  let dir = path.resolve(String(target));
  try {
    if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir);
  } catch {
    dir = path.dirname(dir);
  }

  let dev;
  try { dev = fs.statSync(dir).dev; } catch { return path.parse(dir).root; }

  let best = dir;
  let cur = path.dirname(dir);
  while (cur !== dir) {
    try {
      if (fs.statSync(cur).dev !== dev) break;
    } catch { break; }
    best = cur;
    dir = cur;
    cur = path.dirname(dir);
  }
  return best;
}

function sameDevice(a, b) {
  try { return fs.statSync(a).dev === fs.statSync(b).dev; } catch { return false; }
}

// 给这批文件挑一个回收站：同盘优先，盘根不可写时回落到全局 .data/trash
function pickTrashRoot(sample) {
  if (sameDevice(sample, TRASH_DIR)) return TRASH_DIR;

  const root = volumeRootOf(sample);
  const candidate = root ? path.join(root, VOLUME_TRASH_NAME) : null;
  if (!candidate || pathKey(candidate) === pathKey(TRASH_DIR)) return TRASH_DIR;

  try {
    fs.mkdirSync(candidate, { recursive: true });
    return candidate;
  } catch {
    return TRASH_DIR;
  }
}

// 批次目录是刚建的，首次出现的名字一定不冲突，所以不做存在性探测；
// 只有同一批里有重名时才加序号。这样每个文件能少两次同步 stat。
function reserveName(used, name) {
  const key = n => (IS_WINDOWS ? n.toLowerCase() : n);
  if (!used.has(key(name))) { used.add(key(name)); return name; }

  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let i = 1;
  let candidate;
  do {
    candidate = `${base}_${i}${ext}`;
    i++;
  } while (used.has(key(candidate)));
  used.add(key(candidate));
  return candidate;
}

// 把若干路径移入回收站
function trashPaths(paths) {
  // 同一批只用一个回收站根：以第一个真实存在的项目所在盘为准
  const sample = paths.find(p => fs.existsSync(p)) || paths[0];
  const id = newBatchId();

  let root = pickTrashRoot(sample);
  let dir = path.join(root, id);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    // 目标盘的回收站目录在，但当前账户没有写权限 → 退回全局回收站
    if (pathKey(root) === pathKey(TRASH_DIR)) throw err;
    root = TRASH_DIR;
    dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
  }
  if (pathKey(root) !== pathKey(TRASH_DIR)) registerRoot(root);

  const items = [];
  const failed = [];
  // 预留 meta.json：被删的同名文件不能覆盖批次元数据
  const used = new Set(['meta.json']);

  for (const p of paths) {
    try {
      const name = path.basename(p);
      const storedName = reserveName(used, name);
      moveSync(p, path.join(dir, storedName));   // 源不存在时这里抛 ENOENT
      items.push({ name, stored: storedName, originalPath: p, isDir: false, size: 0 });
    } catch (err) {
      failed.push({ path: p, error: err.code === 'ENOENT' ? '对象不存在' : err.message });
    }
  }

  if (items.length === 0) {
    try { fs.rmdirSync(dir); } catch { /* 忽略 */ }
    return { id: null, root, items, failed };
  }

  // 一次 readdir 补齐文件夹标记，避免每个条目再 stat 一次
  try {
    const dirents = fs.readdirSync(dir, { withFileTypes: true });
    const dirNames = new Set(dirents.filter(d => d.isDirectory()).map(d => d.name));
    items.forEach(it => { it.isDir = dirNames.has(it.stored); });
  } catch { /* 忽略 */ }

  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, root, at: Date.now(), items }, null, 2), 'utf8');
  return { id, root, items, failed };
}

function readBatchMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  } catch { return null; }
}

// 按 id 在所有回收站里找批次
function findBatch(id) {
  if (!BATCH_ID_RE.test(String(id))) return null;
  for (const root of knownRoots()) {
    const dir = path.join(root, String(id));
    const meta = readBatchMeta(dir);
    if (meta) return { root, dir, meta };
  }
  return null;
}

// 回收站内容：按时间倒序，附带每条是否还真实存在
function listTrash() {
  const batches = [];

  for (const root of knownRoots()) {
    let ids;
    try { ids = fs.readdirSync(root); } catch { continue; }

    for (const id of ids) {
      if (!BATCH_ID_RE.test(id)) continue;
      const dir = path.join(root, id);
      const meta = readBatchMeta(dir);
      if (!meta) continue;

      // 一次 readdir 判断整个批次里谁还在，别逐个 existsSync
      let present = new Set();
      try { present = new Set(fs.readdirSync(dir)); } catch { /* 忽略 */ }
      const items = (meta.items || []).map(it => ({
        ...it,
        exists: present.has(it.stored)
      }));
      batches.push({ id, at: meta.at || 0, root, items });
    }
  }

  batches.sort((a, b) => b.at - a.at);
  return batches;
}

function trashCount() {
  return listTrash().reduce((s, b) => s + b.items.length, 0);
}

// 还原整个批次；原位置已被占用时自动改名，不覆盖
function restoreBatch(id) {
  const found = findBatch(id);
  if (!found) return { restored: [], failed: [{ path: String(id), error: '回收站批次不存在' }] };

  const { dir, meta } = found;
  const restored = [];
  const failed = [];
  const left = [];
  const items = Array.isArray(meta.items) ? meta.items : [];

  for (const it of items) {
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
      left.push(it);
    }
  }

  if (left.length === 0) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* 忽略 */ }
  } else {
    // 部分失败：只把没还原的条目写回 meta，避免下次重复还原已成功的项目
    meta.items = left;
    try { fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8'); } catch { /* 忽略 */ }
  }

  return { restored, failed };
}

function emptyTrash() {
  let removed = 0;

  for (const root of knownRoots()) {
    let ids;
    try { ids = fs.readdirSync(root); } catch { continue; }
    for (const id of ids) {
      if (!BATCH_ID_RE.test(id)) continue;
      try {
        fs.rmSync(path.join(root, id), { recursive: true, force: true });
        removed++;
      } catch { /* 忽略 */ }
    }
  }

  return { removed };
}

module.exports = { trashPaths, listTrash, trashCount, restoreBatch, emptyTrash };
