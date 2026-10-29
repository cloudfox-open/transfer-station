const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const { BACKGROUND_FILE } = require('../lib/config');

const MAX_BG_MB = 20;

module.exports = function registerBackgroundRoutes(app) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BG_MB * 1024 * 1024, files: 1 }
  });

  // 是否存在背景图 + 版本号（用修改时间做缓存键）
  app.get('/api/background/meta', (req, res) => {
    try {
      const st = fs.statSync(BACKGROUND_FILE);
      res.json({ exists: true, version: Math.round(st.mtimeMs), size: st.size });
    } catch {
      res.json({ exists: false, version: 0 });
    }
  });

  // 背景图本体；URL 带 ?v=<version> 时可以长期缓存
  app.get('/api/background', (req, res) => {
    if (!fs.existsSync(BACKGROUND_FILE)) return res.status(404).send('Not Found');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(BACKGROUND_FILE);
  });

  // 上传并压缩后存到服务端 .data/background.jpg，所有设备共用
  app.post('/api/background', (req, res) => {
    upload.single('image')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `图片超过 ${MAX_BG_MB} MB 上限` });
        }
        return res.status(400).json({ error: '上传失败：' + err.message });
      }
      if (!req.file) return res.status(400).json({ error: '没有收到图片' });

      const tmp = BACKGROUND_FILE + '.tmp';
      try {
        await sharp(req.file.buffer)
          .rotate()
          .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85, mozjpeg: true })
          .toFile(tmp);

        // Windows 上 rename 覆盖已有文件可能失败，先删旧的
        try { fs.rmSync(BACKGROUND_FILE, { force: true }); } catch { /* 忽略 */ }
        fs.renameSync(tmp, BACKGROUND_FILE);

        const st = fs.statSync(BACKGROUND_FILE);
        res.json({ success: true, version: Math.round(st.mtimeMs), size: st.size });
      } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* 忽略 */ }
        res.status(400).json({ error: '图片处理失败，请换一张常见格式的图片' });
      }
    });
  });

  app.delete('/api/background', (req, res) => {
    try { fs.rmSync(BACKGROUND_FILE, { force: true }); } catch { /* 忽略 */ }
    res.json({ success: true });
  });
};
