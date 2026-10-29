const fs = require('fs');
const path = require('path');
const multer = require('multer');
const {
  safePath, safeRelPath, isProtectedPath, isSameOrSubPath, pathKey,
  copySync, moveSync, purgeThumbCache, purgeThumbCacheMany, uniqueTargetPath
} = require('../lib/util');
const { pushHistory, undoInfo, undoEntry, popHistory } = require('../lib/history');
const { trashPaths, listTrash, restoreBatch, emptyTrash, trashCount } = require('../lib/trash');
const { logOperation } = require('../lib/oplog');

const BAD_NAME = /[\x00-\x1f\\/:*?"<>|]/;

// multer（busboy）默认按 latin1 读取 multipart 的文件名，
// 中文名会变成「ä¸æ–‡」这种乱码，这里尽量还原成 UTF-8。
function decodeUploadName(name) {
  const raw = String(name || '').replace(/\\/g, '/').split('/').pop() || 'file';
  // 已经含有多字节字符，说明解码正常，别再动
  if (/[^\x00-\xff]/.test(raw)) return raw;
  const fixed = Buffer.from(raw, 'latin1').toString('utf8');
  return fixed.includes('\uFFFD') ? raw : fixed;
}

module.exports = function registerManageRoutes(app) {
  // 上传先落到临时文件名，成功后再按原名（或文件夹相对路径）归位，
  // 这样既支持单文件进度，也支持文件夹上传保留目录结构。
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const targetDir = safePath(req.query.path || '/');
        if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
          req._uplDir = targetDir;
          cb(null, targetDir);
        } else {
          cb(new Error('目标目录无效'));
        }
      },
      filename: (req, file, cb) => {
        const ext = path.extname(String(file.originalname || '')).slice(0, 16);
        const name = `.upltmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        // 记下临时文件，客户端中途断开时好清理
        if (!req._uplTemps) req._uplTemps = [];
        if (req._uplDir) req._uplTemps.push(path.join(req._uplDir, name));
        cb(null, name);
      }
    }),
    limits: { files: 20 }
  });

  // 清理本次上传留下的半截临时文件
  // Windows 上文件句柄可能还没释放，删不掉就隔一会儿重试几次
  function dropTemps(req, attempts = 8) {
    const paths = req._uplTemps || [];
    if (!paths.length) return;

    const left = [];
    paths.forEach(p => {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        left.push(p);
      }
    });
    req._uplTemps = left;

    if (left.length && attempts > 0) {
      setTimeout(() => dropTemps(req, attempts - 1), 500);
    } else if (left.length) {
      console.error('临时文件清理失败:', left);
    }
  }

  // 顺手清掉目标目录里一天前的残留（进程崩溃 / 断电留下的）
  function sweepOldTemps(dir) {
    if (!dir) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const n of names) {
      if (!n.startsWith('.upltmp-')) continue;
      const full = path.join(dir, n);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch { /* 忽略 */ }
    }
  }

  // ---------- 新建文件夹 ----------
  app.post('/api/mkdir', (req, res) => {
    const dirPath = safePath(req.body.path);
    const name = String(req.body.name || '').trim();

    if (!name) return res.status(400).json({ error: '文件夹名称不能为空' });
    if (BAD_NAME.test(name)) return res.status(400).json({ error: '文件夹名称不能包含 \\ / : * ? " < > |' });

    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return res.status(400).json({ error: '目标目录无效' });
    }

    const target = path.join(dirPath, name);
    if (fs.existsSync(target)) return res.status(400).json({ error: '已存在同名文件夹或文件' });

    try {
      fs.mkdirSync(target);
      pushHistory({ type: 'mkdir', label: `新建文件夹「${name}」`, items: [{ to: target }] });
      logOperation(req, '新建文件夹', `「${name}」→ ${dirPath}`);
      res.json({ success: true, path: target, history: undoInfo() });
    } catch (err) {
      res.status(500).json({ error: '创建失败: ' + err.message });
    }
  });

  // ---------- 重命名（单个） ----------
  app.post('/api/rename', (req, res) => {
    const src = safePath(req.body.path);
    const name = String(req.body.name || '').trim();

    if (!name) return res.status(400).json({ error: '名称不能为空' });
    if (BAD_NAME.test(name)) return res.status(400).json({ error: '名称不能包含 \\ / : * ? " < > |' });
    if (!fs.existsSync(src)) return res.status(404).json({ error: '对象不存在' });
    if (isProtectedPath(src)) return res.status(403).json({ error: '该位置受保护，不能重命名' });

    const parent = path.dirname(src);
    const target = path.join(parent, name);

    if (pathKey(target) === pathKey(src)) {
      return res.json({ success: true, path: src, unchanged: true, history: undoInfo() });
    }
    if (fs.existsSync(target)) return res.status(400).json({ error: '已存在同名文件或文件夹' });

    try {
      fs.renameSync(src, target);
      purgeThumbCache(src);
      pushHistory({
        type: 'rename',
        label: `重命名「${path.basename(src)}」`,
        items: [{ from: src, to: target }]
      });
      logOperation(req, '重命名', `「${path.basename(src)}」→「${name}」（${parent}）`);
      res.json({ success: true, path: target, history: undoInfo() });
    } catch (err) {
      res.status(500).json({ error: '重命名失败: ' + err.message });
    }
  });

  // ---------- 批量重命名 ----------
  // 两阶段改名：先全部改成临时名，再改成目标名，避免 a→b、b→a 这类互换冲突
  app.post('/api/rename-batch', (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ error: '未指定要重命名的对象' });

    const failed = [];
    const plan = [];

    for (const it of items) {
      const src = safePath(it.path);
      const name = String(it.name || '').trim();
      if (!fs.existsSync(src)) { failed.push({ path: src, error: '对象不存在' }); continue; }
      if (!name) { failed.push({ path: src, error: '名称不能为空' }); continue; }
      if (BAD_NAME.test(name)) { failed.push({ path: src, error: '名称不能包含 \\ / : * ? " < > |' }); continue; }
      if (isProtectedPath(src)) { failed.push({ path: src, error: '该位置受保护，不能重命名' }); continue; }

      const dest = path.join(path.dirname(src), name);
      if (pathKey(dest) === pathKey(src)) continue;   // 名字没变
      plan.push({ from: src, to: dest });
    }

    // 批次内重名 / 与批次外已有文件重名
    const fromKeys = new Set(plan.map(p => pathKey(p.from)));
    const toKeys = new Set();
    const valid = [];
    for (const p of plan) {
      const key = pathKey(p.to);
      if (toKeys.has(key)) { failed.push({ path: p.from, error: '同一批内出现重名：' + path.basename(p.to) }); continue; }
      if (fs.existsSync(p.to) && !fromKeys.has(key)) { failed.push({ path: p.from, error: '已存在同名文件或文件夹' }); continue; }
      toKeys.add(key);
      valid.push(p);
    }

    // 批量操作要么全成功要么不动，避免只改了一半
    if (failed.length > 0 || valid.length === 0) {
      return res.status(500).json({ error: failed[0] ? failed[0].error : '没有可重命名的对象', failed });
    }

    const temps = [];
    const renamed = [];
    try {
      valid.forEach((p, i) => {
        const tmp = path.join(path.dirname(p.from), `.ren-${Date.now().toString(36)}-${i}`);
        fs.renameSync(p.from, tmp);
        temps.push({ ...p, tmp });
      });
      for (const t of temps) {
        fs.renameSync(t.tmp, t.to);
        renamed.push(t);
        purgeThumbCache(t.from);
      }
    } catch (err) {
      // 尽力回滚，别留下半改状态
      for (const t of temps) {
        try { if (fs.existsSync(t.tmp)) fs.renameSync(t.tmp, t.from); } catch { /* 忽略 */ }
      }
      for (const t of renamed) {
        try { if (fs.existsSync(t.to)) fs.renameSync(t.to, t.from); } catch { /* 忽略 */ }
      }
      return res.status(500).json({ error: '批量重命名失败: ' + err.message, failed });
    }

    pushHistory({
      type: 'rename',
      label: `批量重命名 ${renamed.length} 个项目`,
      items: renamed.map(t => ({ from: t.from, to: t.to }))
    });
    logOperation(req, '批量重命名', `${renamed.length} 个项目（${path.dirname(renamed[0].from)}）`, 'ok', {
      items: renamed.map(t => `${path.basename(t.from)} → ${path.basename(t.to)}`)
    });

    res.json({
      success: true,
      renamed: renamed.map(t => ({ from: t.from, to: t.to })),
      failed,
      history: undoInfo()
    });
  });

  // ---------- 上传 ----------
  app.post('/api/upload', (req, res) => {
    // 客户端中途断开时，multer 不会删掉已经写了一半的临时文件
    res.on('close', () => {
      if (!res.writableEnded) dropTemps(req);
    });

    sweepOldTemps(safePath(req.query.path || '/'));

    upload.array('files')(req, res, (err) => {
      const files = req.files || [];
      const cleanup = () => {
        files.forEach(f => { try { fs.unlinkSync(f.path); } catch { /* 忽略 */ } });
        dropTemps(req);
      };

      if (err) {
        cleanup();
        if (/目标目录无效/.test(err.message || '')) {
          return res.status(400).json({ error: '目标目录无效' });
        }
        console.error('上传错误:', err.message);
        return res.status(500).json({ error: '上传失败: ' + err.message });
      }

      const targetDir = safePath(req.query.path || '/');
      if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
        cleanup();
        return res.status(400).json({ error: '目标目录无效' });
      }

      // 文件夹上传时前端会带上 rel，例如 photos/2024/a.jpg
      const rel = safeRelPath(req.body.rel);
      const saved = [];

      for (const file of files) {
        try {
          const original = decodeUploadName(file.originalname);
          const relPath = rel || original;
          const parent = path.dirname(path.join(targetDir, relPath));
          fs.mkdirSync(parent, { recursive: true });
          const dest = uniqueTargetPath(parent, path.basename(relPath));
          fs.renameSync(file.path, dest);
          saved.push({ name: path.basename(dest), path: dest });
        } catch (e) {
          try { fs.unlinkSync(file.path); } catch { /* 忽略 */ }
        }
      }

      const status = saved.length === files.length ? 'ok' : (saved.length ? 'partial' : 'fail');
      logOperation(req, '上传', `${saved.length}/${files.length} 个文件 → ${targetDir}`, status, {
        items: saved.map(s => s.name)
      });

      res.json({ success: true, count: saved.length, files: saved });
    });
  });

  // ---------- 删除（进回收站） ----------
  app.post('/api/delete', (req, res) => {
    const raw = Array.isArray(req.body.paths) ? req.body.paths : [req.body.path];
    const targets = raw.filter(Boolean).map(p => safePath(p));

    if (targets.length === 0) return res.status(400).json({ error: '未指定要删除的对象' });
    for (const target of targets) {
      if (isProtectedPath(target)) {
        return res.status(403).json({ error: '受保护的位置不能删除：' + target });
      }
    }

    const { id, items, failed } = trashPaths(targets);
    if (items.length === 0) {
      logOperation(req, '删除', `${targets.length} 个项目（失败）`, 'fail', {
        items: targets.slice(0, 50)
      });
      return res.status(500).json({ error: failed[0] ? failed[0].error : '删除失败', failed });
    }

    purgeThumbCacheMany(targets);
    pushHistory({
      type: 'trash',
      label: `删除 ${items.length} 个项目`,
      trashId: id,
      items: items.map(it => ({ from: it.originalPath }))
    });
    logOperation(req, '删除', `${items.length} 个项目 → 回收站`, failed.length ? 'partial' : 'ok', {
      items: items.slice(0, 50).map(it => it.originalPath)
    });

    res.json({
      success: true,
      deleted: items.map(it => it.originalPath),
      failed,
      trashId: id,
      history: undoInfo()
    });
  });

  // ---------- 回收站 ----------
  app.get('/api/trash', (req, res) => {
    res.json({ count: trashCount(), batches: listTrash() });
  });

  app.post('/api/trash/restore', (req, res) => {
    const id = String(req.body.id || '');
    if (!id) return res.status(400).json({ error: '未指定要还原的批次' });
    const r = restoreBatch(id);
    if (r.restored.length === 0) {
      logOperation(req, '还原', `批次 ${id}（失败）`, 'fail', {
        items: r.failed.slice(0, 50).map(f => f.path)
      });
      return res.status(500).json({ error: (r.failed[0] && r.failed[0].error) || '还原失败', failed: r.failed });
    }
    logOperation(req, '还原', `${r.restored.length} 个项目`, r.failed.length ? 'partial' : 'ok', {
      items: r.restored.slice(0, 50).map(x => x.to)
    });
    res.json({ success: true, restored: r.restored, failed: r.failed, count: trashCount() });
  });

  app.post('/api/trash/empty', (req, res) => {
    const r = emptyTrash();
    logOperation(req, '清空回收站', `${r.removed} 个批次（永久删除）`);
    res.json({ success: true, removed: r.removed, count: 0 });
  });

  // ---------- 移动 / 复制 ----------
  function handleTransfer(req, res, op) {
    const isCopy = op === 'copy';
    const label = isCopy ? '复制' : '移动';
    const resultKey = isCopy ? 'copied' : 'moved';

    const raw = Array.isArray(req.body.paths) ? req.body.paths : [req.body.path];
    const sources = raw.filter(Boolean).map(p => safePath(p));
    const targetDir = safePath(req.body.target);

    if (sources.length === 0) return res.status(400).json({ error: `未指定要${label}的对象` });
    if (!targetDir || !fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return res.status(400).json({ error: '目标文件夹无效' });
    }

    const items = [];
    const skipped = [];
    const failed = [];

    for (const src of sources) {
      if (!fs.existsSync(src)) { failed.push({ path: src, error: '对象不存在' }); continue; }
      if (isProtectedPath(src)) { failed.push({ path: src, error: `受保护的位置不能${label}` }); continue; }

      let isDir = false;
      try { isDir = fs.statSync(src).isDirectory(); } catch { /* 忽略 */ }

      // 复制到原目录是合法的（生成副本）；移动到原目录则是空操作
      if (!isCopy && pathKey(path.dirname(src)) === pathKey(targetDir)) {
        skipped.push({ path: src, error: '已在目标文件夹中' });
        continue;
      }

      // 不能把文件夹放进它自己或它的子目录
      if (isDir && isSameOrSubPath(targetDir, src)) {
        failed.push({ path: src, error: `不能把文件夹${label}到它自身或其子目录中` });
        continue;
      }

      try {
        const dest = uniqueTargetPath(targetDir, path.basename(src));
        if (isCopy) {
          copySync(src, dest);
        } else {
          moveSync(src, dest);
          purgeThumbCache(src);
        }
        items.push({ from: src, to: dest });
      } catch (err) {
        failed.push({ path: src, error: err.message });
      }
    }

    if (items.length === 0 && skipped.length === 0) {
      logOperation(req, label, `${sources.length} 个项目（失败）`, 'fail', {
        items: failed.slice(0, 50).map(f => f.path)
      });
      return res.status(500).json({ error: failed[0] ? failed[0].error : `${label}失败`, failed });
    }

    if (items.length > 0) {
      pushHistory({
        type: isCopy ? 'copy' : 'move',
        label: `${label} ${items.length} 个项目`,
        items: items.map(i => ({ from: i.from, to: i.to }))
      });
      logOperation(req, label, `${items.length} 个项目 → ${targetDir}`, failed.length ? 'partial' : 'ok', {
        items: items.slice(0, 50).map(i => i.from)
      });
    }

    res.json({ success: true, [resultKey]: items, skipped, failed, history: undoInfo() });
  }

  app.post('/api/move', (req, res) => handleTransfer(req, res, 'move'));
  app.post('/api/copy', (req, res) => handleTransfer(req, res, 'copy'));

  // ---------- 撤销 ----------
  app.get('/api/history', (req, res) => {
    res.json(undoInfo());
  });

  app.post('/api/undo', (req, res) => {
    const entry = popHistory();
    if (!entry) return res.status(400).json({ error: '没有可撤销的操作' });

    const { done, failed, focus } = undoEntry(entry);

    if (done.length === 0) {
      // 一步都没撤销成功就把记录放回去，否则用户会白白丢掉一次撤销机会
      pushHistory(entry);
      logOperation(req, '撤销', `「${entry.label}」（失败）`, 'fail');
      return res.status(500).json({
        error: failed[0] ? failed[0].error : '撤销失败',
        failed,
        history: undoInfo()
      });
    }
    logOperation(req, '撤销', `「${entry.label}」`, failed.length ? 'partial' : 'ok', {
      items: done.slice(0, 50).map(d => d.from || d.to)
    });
    res.json({
      success: true,
      undone: entry.label,
      type: entry.type,
      done,
      failed,
      focus,
      history: undoInfo()
    });
  });
};
