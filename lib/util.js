const fs = require('fs');
const path = require('path');
const os = require('os');
const { DEFAULT_ROOT, IS_WINDOWS, CACHE_DIR, IMAGE_EXT, VIDEO_EXT, CACHE_MAX_MB } = require('./config');

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// 路径比较键：Windows 不区分大小写，类 Unix 区分
function pathKey(p) {
  const n = path.normalize(String(p)).replace(/[\\/]+$/, '');
  return IS_WINDOWS ? n.toLowerCase() : n;
}

function isImage(file) {
  return IMAGE_EXT.includes(path.extname(file).toLowerCase());
}

function isVideo(file) {
  return VIDEO_EXT.includes(path.extname(file).toLowerCase());
}

function safePath(reqPath) {
  if (!reqPath) return DEFAULT_ROOT;
  // Express 已经把 query / JSON 里的路径解码过了，这里再 decodeURIComponent
  // 会把文件名里真实的 "%41" 这类内容误解码，遇到裸 "%" 还会抛 URIError。
  const decoded = String(reqPath);

  if (IS_WINDOWS) {
    // Windows：只有 C:\ 这类盘符路径才算绝对路径；单独的 "/" 仍代表默认目录
    if (/^[a-zA-Z]:[\\/]/.test(decoded)) return path.normalize(decoded);
    return path.normalize(path.join(DEFAULT_ROOT, decoded));
  }
  // Linux / macOS：/ 开头即为绝对路径
  if (path.isAbsolute(decoded)) return path.normalize(decoded);
  return path.normalize(path.join(DEFAULT_ROOT, decoded));
}

// 按已取得的 mtime / size 排序，不再重复 stat（大目录下差别很明显）
function sortItems(items, sortBy, order = 'asc') {
  const sorted = [...items];
  if (sortBy === 'name') {
    sorted.sort((a, b) => naturalCollator.compare(a.name, b.name));
  } else if (sortBy === 'time') {
    sorted.sort((a, b) => (a.mtime || 0) - (b.mtime || 0));
  } else if (sortBy === 'size') {
    // 文件夹没有大小，按 -1 处理让它们靠前
    const sizeOf = it => (it.isDir ? -1 : (it.size || 0));
    sorted.sort((a, b) => sizeOf(a) - sizeOf(b));
  }
  return order === 'desc' ? sorted.reverse() : sorted;
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) candidates.push({ name, address: iface.address });
    }
  }
  // Linux 上常有 docker0 / br-* / veth 等虚拟网卡，优先挑真实局域网地址
  const virtual = /^(docker|br-|veth|virbr|vmnet|tun|tap|zt|wg)/i;
  const preferred = candidates.find(c => !virtual.test(c.name)) || candidates[0];
  return preferred ? preferred.address : 'localhost';
}

// 受保护位置：驱动器 / 根目录、服务自身目录
function isProtectedPath(p) {
  const norm = path.normalize(p);
  if (/^[a-zA-Z]:\\?$/.test(norm)) return true;   // Windows 盘符根，如 C:\
  if (norm === path.sep) return true;             // 类 Unix 根目录 /
  return pathKey(norm) === pathKey(DEFAULT_ROOT);
}

// child 是否等于 parent 或位于其内部
function isSameOrSubPath(child, parent) {
  const c = pathKey(child);
  const p = pathKey(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

// 在目录中找一个不冲突的文件名：a.txt → a_1.txt → a_2.txt
function uniqueTargetPath(dir, name) {
  let candidate = path.join(dir, name);
  if (!fs.existsSync(candidate)) return candidate;

  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let counter = 1;
  do {
    candidate = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
  } while (fs.existsSync(candidate));
  return candidate;
}

// 递归复制，保留修改时间；目标已存在时直接报错，绝不静默覆盖
function copySync(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
}

// 跨盘移动：rename 失败时退化为「复制 + 删除」
// 注意 Windows 上跨卷重命名文件报 EXDEV，重命名整个目录却报 EPERM，
// 两种都要走复制兜底，否则跨盘删除 / 移动文件夹会直接失败。
function moveSync(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (!['EXDEV', 'EPERM', 'EACCES'].includes(err.code)) throw err;
    if (fs.existsSync(dest)) throw err;
    copySync(src, dest);
    fs.rmSync(src, { recursive: true, force: true });
  }
}

// 批量清理缩略图缓存：只读一次缓存目录，避免删除 N 个项目时扫 N 遍
function purgeThumbCacheMany(targets) {
  const wanted = new Set();
  for (const t of targets) wanted.add(pathKey(t));
  if (wanted.size === 0) return;

  let files;
  try { files = fs.readdirSync(CACHE_DIR); } catch { return; }

  for (const f of files) {
    const source = decodeThumbKey(f);
    if (!source) continue;
    // 从缩略图对应的源文件往上找，命中被删目录（含其子孙）就清掉
    let p = pathKey(source);
    let hit = false;
    while (p) {
      if (wanted.has(p)) { hit = true; break; }
      const cut = p.lastIndexOf(path.sep);
      if (cut <= 0) break;
      p = p.slice(0, cut);
    }
    if (hit) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch { /* 忽略 */ }
    }
  }
}

// 清理某个路径（含其子孙）对应的缩略图缓存
function purgeThumbCache(targetPath) {
  const norm = path.normalize(targetPath).toLowerCase();
  const prefix = norm.endsWith(path.sep) ? norm : norm + path.sep;
  let files;
  try { files = fs.readdirSync(CACHE_DIR); } catch { return; }

  files.forEach(f => {
    const tag = f.includes('_vthumb.jpg') ? '_vthumb.jpg' : (f.includes('_thumb.jpg') ? '_thumb.jpg' : null);
    if (!tag) return;
    let decoded;
    try { decoded = Buffer.from(f.slice(0, -tag.length), 'base64').toString('utf8'); } catch { return; }
    const d = path.normalize(decoded).toLowerCase();
    if (d === norm || d.startsWith(prefix)) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch { /* 忽略 */ }
    }
  });
}

const THUMB_SUFFIXES = ['_vthumb.jpg', '_thumb.jpg'];

function decodeThumbKey(fileName) {
  for (const suffix of THUMB_SUFFIXES) {
    if (fileName.endsWith(suffix)) {
      try {
        return Buffer.from(fileName.slice(0, -suffix.length), 'base64').toString('utf8');
      } catch { return null; }
    }
  }
  return null;
}

// 缩略图缓存清理：源文件已删除的条目直接丢掉，再按 LRU 压到上限
function pruneThumbCache(maxBytes = CACHE_MAX_MB * 1024 * 1024) {
  let names;
  try { names = fs.readdirSync(CACHE_DIR); } catch { return { removed: 0, size: 0 }; }

  let removed = 0;
  let total = 0;
  const alive = [];

  for (const name of names) {
    const full = path.join(CACHE_DIR, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isFile()) continue;

    const source = decodeThumbKey(name);
    if (source && !fs.existsSync(source)) {
      try { fs.unlinkSync(full); removed++; } catch { /* 忽略 */ }
      continue;
    }
    total += stat.size;
    alive.push({ full, size: stat.size, atime: stat.atimeMs || stat.mtimeMs });
  }

  if (total > maxBytes) {
    alive.sort((a, b) => a.atime - b.atime);   // 最久未访问的先删
    for (const item of alive) {
      if (total <= maxBytes) break;
      try { fs.unlinkSync(item.full); total -= item.size; removed++; } catch { /* 忽略 */ }
    }
  }
  return { removed, size: total };
}

// zip 内条目重名时加序号，避免覆盖
function uniqueZipEntry(used, name) {
  const key = name.toLowerCase();
  if (!used.has(key)) { used.add(key); return name; }

  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let i = 1;
  let candidate;
  do {
    candidate = `${base}_${i}${ext}`;
    i++;
  } while (used.has(candidate.toLowerCase()));
  used.add(candidate.toLowerCase());
  return candidate;
}

// 上传时的相对路径净化：去掉 .. 与盘符，防止目录穿越
function safeRelPath(rel) {
  const parts = String(rel || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(p => p && p !== '.' && p !== '..' && !/^[a-zA-Z]:$/.test(p));
  return parts.join(path.sep);
}

module.exports = {
  naturalCollator,
  pathKey,
  isImage,
  isVideo,
  safePath,
  safeRelPath,
  sortItems,
  getLocalIP,
  isProtectedPath,
  isSameOrSubPath,
  uniqueTargetPath,
  copySync,
  moveSync,
  purgeThumbCache,
  purgeThumbCacheMany,
  pruneThumbCache,
  uniqueZipEntry
};
