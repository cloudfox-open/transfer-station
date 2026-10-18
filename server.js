const express = require('express');
const path = require('path');
const { DEFAULT_ROOT, MAX_UPLOAD_MB, ensureDirs } = require('./lib/config');
const { getLocalIP, pruneThumbCache } = require('./lib/util');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

ensureDirs();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

require('./routes/browse')(app);
require('./routes/manage')(app);
require('./routes/meta')(app);
require('./routes/drives')(app);

// 启动时清一次缩略图缓存，之后每 6 小时一次
pruneThumbCache();
const pruneTimer = setInterval(() => {
  const r = pruneThumbCache();
  if (r.removed) console.log(`缩略图缓存清理：删除 ${r.removed} 个文件`);
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
    console.log('  单文件上传上限: ' + MAX_UPLOAD_MB + ' MB');
    console.log('  请求超时: ' + (server.requestTimeout === 0 ? '已关闭（大文件可传完为止）' : server.requestTimeout + ' ms'));
    console.log('========================================');
  });

  // Node 默认 requestTimeout 是 5 分钟，传大文件时会在中途被直接掐断。
  // 这是文件传输工具，允许长连接传完为止。
  server.requestTimeout = 0;
}

module.exports = { app };
