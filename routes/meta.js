const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { FAVORITES_FILE, MEMOS_FILE, PHOTOS_DIR, CACHE_DIR, IMAGE_EXT } = require('../lib/config');
const { isImage } = require('../lib/util');

module.exports = function registerMetaRoutes(app) {

function readFavorites() {
  try {
    const list = JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeFavorites(list) {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(list, null, 2), 'utf8');
}

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


// ========== 生活区 API ==========

// 备忘录读写
function readMemos() {
  try {
    const list = JSON.parse(fs.readFileSync(MEMOS_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
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

  // 排序后 list[index] 指向别的备忘录，所以先留一份引用
  const memo = list[index];

  // 置顶的排在前面
  list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  writeMemos(list);
  res.json(memo);
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
  },
  limits: { files: 20 }
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
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ success: true, count: (req.files || []).length });
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


};
