const { readLogs } = require('../lib/oplog');

module.exports = function registerLogRoutes(app) {
  // 操作日志：默认返回最近 200 条，可用 day=YYYY-MM-DD 只看某天
  app.get('/api/logs', (req, res) => {
    res.json(readLogs({
      limit: req.query.limit,
      day: String(req.query.day || '').trim()
    }));
  });
};
