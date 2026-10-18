const fs = require('fs');
const { IS_WINDOWS, DEFAULT_ROOT } = require('../lib/config');
const driveLib = require('../lib/drives');

module.exports = function registerDriveRoutes(app) {
  const { powerShellDrives, statfsDrives, posixDrives, normalizeDrive } = driveLib;

// API：磁盘列表（名称 / 容量 / 可用空间 / 卷标）
app.get('/api/drives', async (req, res) => {
  if (driveLib.drivesCache.data && Date.now() - driveLib.drivesCache.time < 10000) {
    return res.json(driveLib.drivesCache.data);
  }

  let drives = [];
  try {
    if (IS_WINDOWS) {
      drives = (await powerShellDrives()).map(normalizeDrive);
      if (drives.length === 0) drives = statfsDrives().map(normalizeDrive);
    } else {
      drives = (await posixDrives()).map(normalizeDrive);
    }
  } catch (err) {
    console.error('枚举磁盘失败:', err.message);
    if (IS_WINDOWS) drives = statfsDrives().map(normalizeDrive);
  }

  // 兜底：至少把根目录给出去，避免「此电脑」空白
  if (drives.length === 0) {
    try {
      const root = IS_WINDOWS ? DEFAULT_ROOT : '/';
      const s = fs.statfsSync(root);
      drives = [normalizeDrive({
        DeviceID: IS_WINDOWS ? root.slice(0, 2) : '/',
        DriveType: 3, VolumeName: '', FileSystem: '',
        Size: s.blocks * s.bsize, FreeSpace: s.bavail * s.bsize
      })];
    } catch { /* 忽略 */ }
  }

  drives.sort((a, b) => a.letter.localeCompare(b.letter));
  driveLib.drivesCache = { time: Date.now(), data: drives };
  res.json(drives);
});

};
