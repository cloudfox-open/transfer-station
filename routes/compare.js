const { safePath } = require('../lib/util');
const { compareFiles } = require('../lib/compare');

module.exports = function registerCompareRoutes(app) {
  // 精确对比：2 个文件给出是否相同 / 首个差异位置，多个文件按内容哈希分组
  app.post('/api/compare', async (req, res) => {
    const raw = Array.isArray(req.body.paths) ? req.body.paths : [];
    const paths = raw.filter(Boolean).map(p => safePath(p));

    try {
      res.json(await compareFiles(paths));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || '对比失败' });
    }
  });
};
