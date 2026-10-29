const express = require('express');
const path = require('path');
const { DEFAULT_ROOT, ensureDirs } = require('./lib/config');
const { getLocalIP, pruneThumbCache } = require('./lib/util');
const { pruneLogs } = require('./lib/oplog');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

ensureDirs();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

require('./routes/browse')(app);
require('./routes/manage')(app);
require('./routes/meta')(app);
require('./routes/drives')(app);
require('./routes/logs')(app);
require('./routes/scan')(app);

// 未匹配的 API 返回 JSON，而不是 Express 默认的 HTML 错误页
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在: ' + req.method + ' ' + req.originalUrl });
});

// 统一错误处理：API 一律回 JSON，前端可以直接读 error 字段
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (req.path.startsWith('/api/')) {
    if (status >= 500) console.error('请求处理失败:', err);
    return res.status(status).json({ error: err.message || '服务器内部错误' });
  }
  next(err);
});

// 启动时清一次缩略图缓存，之后每 6 小时一次；操作日志只保留最近 30 天
pruneThumbCache();
pruneLogs();
const pruneTimer = setInterval(() => {
  const r = pruneThumbCache();
  if (r.removed) console.log(`缩略图缓存清理：删除 ${r.removed} 个文件`);
  const logs = pruneLogs();
  if (logs) console.log(`操作日志清理：删除 ${logs} 个旧文件`);
}, 6 * 60 * 60 * 1000);
if (pruneTimer.unref) pruneTimer.unref();

// 启动服务
if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('========================================');
    console.log('  文件中转站服务已启动');
    console.log('  电脑本地访问: http://localhost:' + PORT);
    console.log('  手机访问地址: http://' + ip + ':' + PORT);
    console.log('  默认目录: ' + DEFAULT_ROOT);
    console.log('  平台: ' + process.platform);
    console.log('  请求超时: ' + (server.requestTimeout === 0 ? '已关闭（大文件可传完为止）' : server.requestTimeout + ' ms'));
    console.log('========================================');
  });

  // Node 默认 requestTimeout 是 5 分钟，传大文件时会在中途被直接掐断。
  // 这是文件传输工具，允许长连接传完为止。
  server.requestTimeout = 0;
}

module.exports = { app };
