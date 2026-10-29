const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const archiver = require('archiver');
const { CACHE_DIR } = require('../lib/config');
const {
  naturalCollator, safePath, isImage, isVideo, sortItems, uniqueZipEntry
} = require('../lib/util');

module.exports = function registerBrowseRoutes(app) {
  // 中文文件名用 RFC 5987 的 filename* 传，避免浏览器把百分号编码直接显示出来
  function zipAttachment(name) {
    const safe = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    return `attachment; filename="download.zip"; filename*=UTF-8''${safe}`;
  }

  // ---------- 目录列表 ----------
  app.get('/api/list', (req, res) => {
    const dirPath = safePath(req.query.path);
    const sortBy = req.query.sort || 'name';
    const order = req.query.order || 'asc';
    const search = req.query.search || '';

    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return res.status(404).json({ error: '目录不存在或路径无效' });
    }

    const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    const result = {
      currentPath: dirPath,
      parentPath: path.dirname(dirPath),
      folders: [],
      images: [],
      videos: [],
      others: []
    };

    // 每个条目只 stat 一次，排序直接用取到的 mtime / size
    for (const item of dirents) {
      if (item.name.startsWith('.')) continue;
      if (search && !item.name.toLowerCase().includes(search.toLowerCase())) continue;

      const fullItemPath = path.join(dirPath, item.name);
      let stat;
      try { stat = fs.statSync(fullItemPath); } catch { continue; }

      const base = { name: item.name, path: fullItemPath, size: stat.size, mtime: stat.mtimeMs };

      if (item.isDirectory()) {
        result.folders.push({ ...base, isDir: true, size: 0 });
      } else if (isImage(item.name)) {
        result.images.push({ ...base, type: 'image', isDir: false });
      } else if (isVideo(item.name)) {
        result.videos.push({ ...base, type: 'video', isDir: false });
      } else {
        result.others.push({ ...base, type: 'file', isDir: false });
      }
    }

    result.folders = sortItems(result.folders, sortBy, order);
    result.images = sortItems(result.images, sortBy, order);
    result.videos = sortItems(result.videos, sortBy, order);
    result.others = sortItems(result.others, sortBy, order);

    res.json(result);
  });

  // ---------- 递归搜索 ----------
  // 只搜文件名，不跟随符号链接（避免环），深度与结果数都有上限
  app.get('/api/search', (req, res) => {
    const root = safePath(req.query.path);
    const q = String(req.query.q || '').trim();

    if (!q) return res.json({ root, query: '', total: 0, truncated: false, items: [] });
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return res.status(404).json({ error: '目录不存在' });
    }

    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const maxDepth = Math.min(Number(req.query.depth) || 6, 12);
    const needle = q.toLowerCase();
    const items = [];
    let truncated = false;

    function walk(dir, depth) {
      if (truncated) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

      for (const ent of entries) {
        if (items.length >= limit) { truncated = true; return; }
        if (ent.name.startsWith('.')) continue;

        const full = path.join(dir, ent.name);
        const isDir = ent.isDirectory();

        if (isDir && depth < maxDepth) walk(full, depth + 1);

        if (!ent.name.toLowerCase().includes(needle)) continue;
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }

        items.push({
          name: ent.name,
          path: full,
          isDir,
          kind: isDir ? 'folder' : (isImage(ent.name) ? 'image' : (isVideo(ent.name) ? 'video' : 'file')),
          size: isDir ? 0 : stat.size,
          mtime: stat.mtimeMs,
          rel: path.relative(root, full)
        });
      }
    }

    walk(root, 0);
    items.sort((a, b) => naturalCollator.compare(a.rel, b.rel));

    res.json({ root, query: q, total: items.length, truncated, items });
  });

  // ---------- 缩略图 ----------
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

  // ---------- 原始文件 ----------
  app.get('/api/file', (req, res) => {
    const filePath = safePath(req.query.path);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('Not Found');

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return res.status(400).send('Not a file');

    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // HTML / SVG 内联执行会拿到与本应用同源的脚本权限，一律强制下载
    const inlineUnsafe = ['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs'].includes(ext);

    if (req.query.download === '1' || inlineUnsafe) {
      res.download(filePath, fileName);
    } else {
      res.sendFile(filePath);
    }
  });

  // ---------- 打包下载 ----------
  app.get('/api/download/zip', (req, res) => {
    const rawPaths = Array.isArray(req.query.paths) ? req.query.paths : (req.query.paths ? [req.query.paths] : []);
    const multi = rawPaths.filter(Boolean).map(p => safePath(p)).filter(p => fs.existsSync(p));

    if (multi.length > 0) {
      const parents = new Set(multi.map(p => path.dirname(p)));
      const zipName = parents.size === 1 ? (path.basename([...parents][0]) || 'download') : 'download';
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', zipAttachment(zipName + '.zip'));

      const used = new Set();
      const archive = archiver('zip', { zlib: { level: 5 } });
      archive.on('error', (err) => {
        console.error('打包失败:', err.message);
        res.destroy();
      });
      archive.pipe(res);

      multi.forEach(p => {
        const entryName = uniqueZipEntry(used, path.basename(p) || 'item');
        try {
          if (fs.statSync(p).isDirectory()) archive.directory(p, entryName);
          else archive.file(p, { name: entryName });
        } catch (err) {
          console.error('打包跳过:', p, err.message);
        }
      });
      archive.finalize();
      return;
    }

    const dirPath = safePath(req.query.path);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return res.status(404).send('目录不存在');
    }

    const dirName = path.basename(dirPath) || 'download';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', zipAttachment(dirName + '.zip'));

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => {
      console.error('打包失败:', err.message);
      res.destroy();
    });
    archive.pipe(res);
    archive.directory(dirPath, false);
    archive.finalize();
  });
};
