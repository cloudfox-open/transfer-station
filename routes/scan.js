const fs = require('fs');
const { safePath } = require('../lib/util');
const { startScan, getJob, cancelJob } = require('../lib/scanner');

module.exports = function registerScanRoutes(app) {
  // 启动扫描任务：mode=large 大文件 / duplicate 重复文件
  app.post('/api/scan', (req, res) => {
    if (!req.body || !req.body.path) return res.status(400).json({ error: '未指定扫描目录' });
    const root = safePath(req.body.path);
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return res.status(400).json({ error: '目录不存在或路径无效' });
    }

    const mode = req.body.mode === 'duplicate' ? 'duplicate' : 'large';
    const defMB = mode === 'duplicate' ? 1 : 100;
    const minMB = Math.min(Math.max(Number(req.body.minSizeMB) || defMB, 1), 10240);

    const { job, error } = startScan({ root, mode, minSize: minMB * 1024 * 1024 });
    if (error) return res.status(429).json({ error });

    res.json({ id: job.id, mode: job.mode, root: job.root });
  });

  // 查询进度 / 结果
  app.get('/api/scan/:id', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: '扫描任务不存在或已过期' });
    res.json(job);
  });

  // 停止扫描
  app.delete('/api/scan/:id', (req, res) => {
    if (!cancelJob(req.params.id)) return res.status(404).json({ error: '扫描任务不存在' });
    res.json({ success: true });
  });
};
