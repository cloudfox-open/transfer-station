const express = require('express');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const os = require('os');
const multer = require('multer');
const archiver = require('archiver');
const { execFile } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const DEFAULT_ROOT = __dirname;
const CACHE_DIR = path.join(DEFAULT_ROOT, '.cache');
const DATA_DIR = path.join(DEFAULT_ROOT, '.data');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
const LIFEZONE_DIR = path.join(DATA_DIR, 'lifezone');
const MEMOS_FILE = path.join(LIFEZONE_DIR, 'memos.json');
const PHOTOS_DIR = path.join(LIFEZONE_DIR, 'photos');

// 确保目录存在
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(FAVORITES_FILE)) fs.writeFileSync(FAVORITES_FILE, '[]', 'utf8');
if (!fs.existsSync(LIFEZONE_DIR)) fs.mkdirSync(LIFEZONE_DIR, { recursive: true });
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
if (!fs.existsSync(MEMOS_FILE)) fs.writeFileSync(MEMOS_FILE, '[]', 'utf8');

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.svg'];
const VIDEO_EXT = ['.mp4', '.webm', '.ogg', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.m4v', '.ts'];

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetDir = safePath(req.query.path || '/');
    if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
      cb(null, targetDir);
    } else {
      cb(new Error('目标目录无效'));
    }
  },
  filename: (req, file, cb) => {
    const originalName = file.originalname;
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    let finalName = originalName;
    let counter = 1;
    const targetDir = safePath(req.query.path || '/');
    while (fs.existsSync(path.join(targetDir, finalName))) {
      finalName = `${baseName}_${counter}${ext}`;
      counter++;
    }
    cb(null, finalName);
  }
});
const upload = multer({ storage });

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function isImage(file) {
  return IMAGE_EXT.includes(path.extname(file).toLowerCase());
}

function isVideo(file) {
  return VIDEO_EXT.includes(path.extname(file).toLowerCase());
}

function safePath(reqPath) {
  if (!reqPath) return DEFAULT_ROOT;
  const decoded = decodeURIComponent(reqPath);
  if (/^[a-zA-Z]:[\\/]/.test(decoded)) {
    return path.normalize(decoded);
  }
  return path.normalize(path.join(DEFAULT_ROOT, decoded));
}

// 排序工具
function sortItems(items, sortBy, order = 'asc') {
  const sorted = [...items];
  if (sortBy === 'name') {
    sorted.sort((a, b) => naturalCollator.compare(a.name, b.name));
  } else if (sortBy === 'time') {
    sorted.sort((a, b) => {
      const statA = fs.statSync(a.path).mtimeMs;
      const statB = fs.statSync(b.path).mtimeMs;
      return statA - statB;
    });
  } else if (sortBy === 'size') {
    sorted.sort((a, b) => {
      const statA = fs.statSync(a.path).size;
      const statB = fs.statSync(b.path).size;
      return statA - statB;
    });
  }
  return order === 'desc' ? sorted.reverse() : sorted;
}

// 收藏夹读写
function readFavorites() {
  try {
    return JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8'));
  } catch { return []; }
}

function writeFavorites(list) {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// API：获取目录列表
app.get('/api/list', (req, res) => {
  const dirPath = safePath(req.query.path);
  const sortBy = req.query.sort || 'name';
  const order = req.query.order || 'asc';
  const search = req.query.search || '';

  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return res.status(404).json({ error: '目录不存在或路径无效' });
  }

  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = {
    currentPath: dirPath,
    parentPath: path.dirname(dirPath),
    folders: [],
    images: [],
    videos: [],
    others: []
  };

  items.forEach(item => {
    if (item.name.startsWith('.')) return;
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return;

    const fullItemPath = path.join(dirPath, item.name);

    let stat;
    try { stat = fs.statSync(fullItemPath); } catch { return; }
    const mtime = stat.mtimeMs;

    if (item.isDirectory()) {
      result.folders.push({ name: item.name, path: fullItemPath, isDir: true, mtime });
    } else if (isImage(item.name)) {
      result.images.push({ name: item.name, path: fullItemPath, type: 'image', isDir: false, size: stat.size, mtime });
    } else if (isVideo(item.name)) {
      result.videos.push({ name: item.name, path: fullItemPath, type: 'video', isDir: false, size: stat.size, mtime });
    } else {
      result.others.push({ name: item.name, path: fullItemPath, type: 'file', isDir: false, size: stat.size, mtime });
    }
  });

  result.folders = sortItems(result.folders, sortBy, order);
  result.images = sortItems(result.images, sortBy, order);
  result.videos = sortItems(result.videos, sortBy, order);

  res.json(result);
});

// API：收藏夹列表
app.get('/api/favorites', (req, res) => {
  res.json(readFavorites());
});

// API：添加收藏
app.post('/api/favorites', (req, res) => {
  const { path: favPath } = req.body;
  if (!favPath) return res.status(400).json({ error: '路径不能为空' });

  const list = readFavorites();
  const normalized = path.normalize(favPath);
  
  if (list.some(f => path.normalize(f.path) === normalized)) {
    return res.status(400).json({ error: '已在收藏夹中' });
  }

  const name = normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
  list.push({ name, path: normalized });
  writeFavorites(list);
  res.json({ success: true });
});

// API：删除收藏
app.delete('/api/favorites/:index', (req, res) => {
  const index = parseInt(req.params.index);
  const list = readFavorites();
  if (index < 0 || index >= list.length) {
    return res.status(404).json({ error: '索引无效' });
  }
  list.splice(index, 1);
  writeFavorites(list);
  res.json({ success: true });
});

// API：图片缩略图
app.get('/api/thumbnail/image', async (req, res) => {
  const filePath = safePath(req.query.path);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('Not Found');

  const ext = path.extname(filePath).toLowerCase();
  const cacheKey = Buffer.from(filePath).toString('base64') + '_thumb.jpg';
  const cachePath = path.join(CACHE_DIR, cacheKey);

  if (fs.existsSync(cachePath)) {
    return res.sendFile(cachePath);
  }

  try {
    if (ext === '.gif' || ext === '.svg') {
      return res.sendFile(filePath);
    }

    await sharp(filePath)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toFile(cachePath);
    
    res.sendFile(cachePath);
  } catch (err) {
    console.error('缩略图生成失败:', err);
    res.sendFile(filePath);
  }
});

// API：视频缩略图
app.get('/api/thumbnail/video', (req, res) => {
  const filePath = safePath(req.query.path);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('Not Found');

  const cacheKey = Buffer.from(filePath).toString('base64') + '_vthumb.jpg';
  const cachePath = path.join(CACHE_DIR, cacheKey);

  if (fs.existsSync(cachePath)) {
    return res.sendFile(cachePath);
  }

  try {
    ffmpeg(filePath)
      .on('end', () => res.sendFile(cachePath))
      .on('error', (err) => {
        console.error('视频缩略图失败:', err.message);
        res.status(500).send('Video thumb failed');
      })
      .screenshots({
        timestamps: ['1%'],
        filename: path.basename(cachePath),
        folder: CACHE_DIR,
        size: '400x?'
      });
  } catch (err) {
    res.status(500).send('Error');
  }
});

// API：原始文件
app.get('/api/file', (req, res) => {
  const filePath = safePath(req.query.path);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('Not Found');
  
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return res.status(400).send('Not a file');

  const fileName = path.basename(filePath);
  
  if (req.query.download === '1') {
    res.download(filePath, fileName);
  } else {
    res.sendFile(filePath);
  }
});

// API：文件上传
app.post('/api/upload', (req, res, next) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      console.error('上传错误:', err.message);
      return res.status(500).json({ error: '上传失败: ' + err.message });
    }
    res.json({ success: true, count: req.files.length });
  });
});

// API：新建文件夹
app.post('/api/mkdir', (req, res) => {
  const dirPath = safePath(req.body.path);
  const name = String(req.body.name || '').trim();

  if (!name) return res.status(400).json({ error: '文件夹名称不能为空' });
  if (/[\\/:*?"<>|]/.test(name)) return res.status(400).json({ error: '文件夹名称不能包含 \\ / : * ? " < > |' });

  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return res.status(400).json({ error: '目标目录无效' });
  }

  const target = path.join(dirPath, name);
  if (fs.existsSync(target)) return res.status(400).json({ error: '已存在同名文件夹或文件' });

  try {
    fs.mkdirSync(target);
    res.json({ success: true, path: target });
  } catch (err) {
    res.status(500).json({ error: '创建失败: ' + err.message });
  }
});

// API：重命名（文件或文件夹）
app.post('/api/rename', (req, res) => {
  const src = safePath(req.body.path);
  const name = String(req.body.name || '').trim();

  if (!name) return res.status(400).json({ error: '名称不能为空' });
  if (/[\\/:*?"<>|]/.test(name)) return res.status(400).json({ error: '名称不能包含 \\ / : * ? " < > |' });
  if (!fs.existsSync(src)) return res.status(404).json({ error: '对象不存在' });
  if (isProtectedPath(src)) return res.status(403).json({ error: '该位置受保护，不能重命名' });

  const parent = path.dirname(src);
  const target = path.join(parent, name);

  if (path.normalize(target).toLowerCase() === path.normalize(src).toLowerCase()) {
    return res.json({ success: true, path: src, unchanged: true });
  }
  if (fs.existsSync(target)) return res.status(400).json({ error: '已存在同名文件或文件夹' });

  try {
    fs.renameSync(src, target);
    purgeThumbCache(src);
    res.json({ success: true, path: target });
  } catch (err) {
    res.status(500).json({ error: '重命名失败: ' + err.message });
  }
});

// API：删除（文件或整个文件夹）
app.post('/api/delete', (req, res) => {
  const raw = Array.isArray(req.body.paths) ? req.body.paths : [req.body.path];
  const targets = raw.filter(Boolean).map(p => safePath(p));

  if (targets.length === 0) return res.status(400).json({ error: '未指定要删除的对象' });

  for (const target of targets) {
    if (isProtectedPath(target)) {
      return res.status(403).json({ error: '受保护的位置不能删除：' + target });
    }
  }

  const done = [];
  const failed = [];
  targets.forEach(target => {
    try {
      if (!fs.existsSync(target)) { failed.push({ path: target, error: '对象不存在' }); return; }
      const stat = fs.statSync(target);
      if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.unlinkSync(target);
      purgeThumbCache(target);
      done.push(target);
    } catch (err) {
      failed.push({ path: target, error: err.message });
    }
  });

  if (done.length === 0) {
    return res.status(500).json({ error: failed[0] ? failed[0].error : '删除失败', failed });
  }
  res.json({ success: true, deleted: done, failed });
});

// 受保护位置：驱动器根目录、服务自身目录
function isProtectedPath(p) {
  const norm = path.normalize(p);
  if (/^[a-zA-Z]:\\?$/.test(norm)) return true;
  const appRoot = path.normalize(DEFAULT_ROOT);
  return norm.toLowerCase() === appRoot.toLowerCase();
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

// API：文件夹打包下载
app.get('/api/download/zip', (req, res) => {
  const dirPath = safePath(req.query.path);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return res.status(404).send('目录不存在');
  }

  const dirName = path.basename(dirPath) || 'download';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(dirName)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.pipe(res);
  archive.directory(dirPath, false);
  archive.finalize();
});

// ========== 磁盘（此电脑） ==========

const DRIVE_TYPE_NAMES = {
  0: '未知设备',
  1: '无根目录',
  2: '可移动磁盘',
  3: '本地磁盘',
  4: '网络驱动器',
  5: '光盘驱动器',
  6: 'RAM 磁盘'
};

let drivesCache = { time: 0, data: null };

// 用 PowerShell 读取卷标、文件系统与驱动器类型
function powerShellDrives() {
  return new Promise((resolve, reject) => {
    const script = 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName,FileSystem,Size,FreeSpace | ConvertTo-Json -Compress';
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        const raw = String(stdout).replace(/^\uFEFF/, '').trim();
        if (!raw) return resolve([]);
        try {
          const parsed = JSON.parse(raw);
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch (e) { reject(e); }
      });
  });
}

// 不依赖 PowerShell 的兜底方案：逐个盘符探测容量
function statfsDrives() {
  const drives = [];
  for (let code = 67; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = letter + ':\\';
    try {
      if (!fs.existsSync(root)) continue;
      const s = fs.statfsSync(root);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      drives.push({ DeviceID: letter + ':', DriveType: 3, VolumeName: '', FileSystem: '', Size: total, FreeSpace: free });
    } catch { /* 无法访问的驱动器直接跳过 */ }
  }
  return drives;
}

function normalizeDrive(d) {
  const letter = String(d.DeviceID || '').replace(/\\$/, '');
  const typeCode = Number(d.DriveType);
  const total = Number(d.Size) || 0;
  const free = Number(d.FreeSpace) || 0;
  const used = Math.max(0, total - free);
  return {
    letter,
    path: letter + '\\',
    volumeName: d.VolumeName ? String(d.VolumeName) : '',
    typeCode: Number.isFinite(typeCode) ? typeCode : 3,
    typeName: DRIVE_TYPE_NAMES[typeCode] || '本地磁盘',
    fileSystem: d.FileSystem ? String(d.FileSystem) : '',
    total,
    free,
    used,
    usedPercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0
  };
}

// API：磁盘列表（名称 / 容量 / 可用空间 / 卷标）
app.get('/api/drives', async (req, res) => {
  if (drivesCache.data && Date.now() - drivesCache.time < 10000) {
    return res.json(drivesCache.data);
  }

  let drives = [];
  try {
    drives = (await powerShellDrives()).map(normalizeDrive);
  } catch (err) {
    console.error('PowerShell 枚举磁盘失败，改用 fs.statfs:', err.message);
  }
  if (drives.length === 0) {
    drives = statfsDrives().map(normalizeDrive);
  }

  drives.sort((a, b) => a.letter.localeCompare(b.letter));
  drivesCache = { time: Date.now(), data: drives };
  res.json(drives);
});

// ========== 生活区 API ==========

// 备忘录读写
function readMemos() {
  try {
    return JSON.parse(fs.readFileSync(MEMOS_FILE, 'utf8'));
  } catch { return []; }
}

function writeMemos(list) {
  fs.writeFileSync(MEMOS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// 获取备忘录列表
app.get('/api/lifezone/memos', (req, res) => {
  res.json(readMemos());
});

// 添加备忘录
app.post('/api/lifezone/memos', (req, res) => {
  const { title, content, color } = req.body;
  if (!title && !content) return res.status(400).json({ error: '内容不能为空' });

  const list = readMemos();
  const memo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: title || '',
    content: content || '',
    color: color || '#6366f1',
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  list.unshift(memo);
  writeMemos(list);
  res.json(memo);
});

// 编辑备忘录
app.put('/api/lifezone/memos/:id', (req, res) => {
  const { id } = req.params;
  const { title, content, color, pinned } = req.body;
  const list = readMemos();
  const index = list.findIndex(m => m.id === id);
  if (index === -1) return res.status(404).json({ error: '备忘录不存在' });

  if (title !== undefined) list[index].title = title;
  if (content !== undefined) list[index].content = content;
  if (color !== undefined) list[index].color = color;
  if (pinned !== undefined) list[index].pinned = pinned;
  list[index].updatedAt = new Date().toISOString();

  // 置顶的排在前面
  list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  writeMemos(list);
  res.json(list[index]);
});

// 删除备忘录
app.delete('/api/lifezone/memos/:id', (req, res) => {
  const { id } = req.params;
  const list = readMemos();
  const filtered = list.filter(m => m.id !== id);
  if (filtered.length === list.length) return res.status(404).json({ error: '备忘录不存在' });
  writeMemos(filtered);
  res.json({ success: true });
});

// 照片上传配置
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PHOTOS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + ext;
      cb(null, name);
    }
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (IMAGE_EXT.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只支持图片文件'));
    }
  }
});

// 获取照片列表
app.get('/api/lifezone/photos', (req, res) => {
  try {
    const files = fs.readdirSync(PHOTOS_DIR);
    const photos = files
      .filter(f => isImage(f))
      .map(f => {
        const fullPath = path.join(PHOTOS_DIR, f);
        const stat = fs.statSync(fullPath);
        return {
          id: path.basename(f, path.extname(f)),
          name: f,
          path: fullPath,
          size: stat.size,
          createdAt: stat.birthtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(photos);
  } catch { res.json([]); }
});

// 上传照片
app.post('/api/lifezone/photos', (req, res, next) => {
  photoUpload.array('photos', 20)(req, res, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, count: req.files.length });
  });
});

// 删除照片
app.delete('/api/lifezone/photos/:id', (req, res) => {
  const { id } = req.params;
  try {
    const files = fs.readdirSync(PHOTOS_DIR);
    const target = files.find(f => path.basename(f, path.extname(f)) === id);
    if (!target) return res.status(404).json({ error: '照片不存在' });
    fs.unlinkSync(path.join(PHOTOS_DIR, target));
    // 删除缩略图缓存
    const cacheKey = Buffer.from(path.join(PHOTOS_DIR, target)).toString('base64') + '_thumb.jpg';
    const cachePath = path.join(CACHE_DIR, cacheKey);
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});

// 启动服务
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('========================================');
  console.log('  文件中转站服务已启动');
  console.log('  电脑本地访问: http://localhost:' + PORT);
  console.log('  手机访问地址: http://' + ip + ':' + PORT);
  console.log('  默认目录: ' + DEFAULT_ROOT);
  console.log('  收藏夹数据已同步到服务端');
  console.log('========================================');
});