const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { IS_WINDOWS, DEFAULT_ROOT } = require('./config');

// ========== 磁盘（此电脑） ==========

const DRIVE_TYPE_NAMES = {
  0: '未知设备',
  1: '无根目录',
  2: '可移动磁盘',
  3: '本地磁盘',
  4: '网络驱动器',
  5: '光盘驱动器',
  6: 'RAM 磁盘'
};

let drivesCache = { time: 0, data: null };

// 不该出现在「此电脑」里的伪文件系统
const PSEUDO_FS = new Set([
  'proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'ramfs', 'rootfs', 'cgroup', 'cgroup2',
  'securityfs', 'pstore', 'bpf', 'tracefs', 'debugfs', 'mqueue', 'hugetlbfs', 'configfs',
  'fusectl', 'autofs', 'binfmt_misc', 'rpc_pipefs', 'nsfs', 'squashfs', 'overlay', 'overlayfs',
  'efivarfs', 'selinuxfs', 'fuse.gvfsd-fuse', 'fuse.lxcfs', 'fuse.portal', 'none'
]);

// ------ Windows ------

// 用 PowerShell 读取卷标、文件系统与驱动器类型
function powerShellDrives() {
  return new Promise((resolve, reject) => {
    const script = 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName,FileSystem,Size,FreeSpace | ConvertTo-Json -Compress';
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        const raw = String(stdout).replace(/^\uFEFF/, '').trim();
        if (!raw) return resolve([]);
        try {
          const parsed = JSON.parse(raw);
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch (e) { reject(e); }
      });
  });
}

// 不依赖 PowerShell 的兜底方案：逐个盘符探测容量
function statfsDrives() {
  const drives = [];
  for (let code = 67; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = letter + ':\\';
    try {
      if (!fs.existsSync(root)) continue;
      const s = fs.statfsSync(root);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      drives.push({ DeviceID: letter + ':', DriveType: 3, VolumeName: '', FileSystem: '', Size: total, FreeSpace: free });
    } catch { /* 无法访问的驱动器直接跳过 */ }
  }
  return drives;
}

// ------ Linux / macOS ------

// /proc/mounts 里的空格等字符是八进制转义的
function unescapeMount(s) {
  return s.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function guessTypeCode(mountPoint, fsType) {
  if (/^(nfs|cifs|smb3?|sshfs|fuse\.sshfs|fuse\.rclone|9p)$/i.test(fsType)) return 4;
  if (/^\/(media|run\/media|mnt)(\/|$)/.test(mountPoint)) return 2;
  return 3;
}

// 解析 /proc/mounts 文本，过滤伪文件系统与重复设备
function parseMounts(text) {
  const seen = new Set();
  const out = [];

  for (const line of String(text).split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const device = parts[0];
    const mountPoint = unescapeMount(parts[1]);
    const fsType = parts[2];

    if (PSEUDO_FS.has(fsType) || PSEUDO_FS.has(device) || device === 'none') continue;
    if (seen.has(device)) continue;           // 同一设备的 bind mount 只留第一个
    seen.add(device);

    out.push({ device, mountPoint, fsType });
  }
  return out;
}

// 读 /proc/mounts，再用 statfs 取容量
function procMountsDrives() {
  let text;
  try { text = fs.readFileSync('/proc/mounts', 'utf8'); } catch { return []; }

  const drives = [];
  for (const { mountPoint, fsType } of parseMounts(text)) {
    let stat;
    try { stat = fs.statfsSync(mountPoint); } catch { continue; }
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    if (!total) continue;

    drives.push({
      DeviceID: mountPoint,
      DriveType: guessTypeCode(mountPoint, fsType),
      VolumeName: '',
      FileSystem: fsType,
      Size: total,
      FreeSpace: free
    });
  }
  return drives;
}

// 没有 /proc 时的兜底（如 macOS）：解析 df -P -k
function dfDrives() {
  return new Promise((resolve) => {
    execFile('df', ['-P', '-k'], { timeout: 8000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      const drives = [];
      const lines = String(stdout).split('\n').slice(1);
      for (const line of lines) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 6) continue;
        const totalKb = Number(cols[1]);
        const availKb = Number(cols[3]);
        if (!Number.isFinite(totalKb) || !Number.isFinite(availKb)) continue;
        const mountPoint = cols.slice(5).join(' ');
        if (/^\/(dev|proc|sys|run)(\/|$)/.test(mountPoint)) continue;
        drives.push({
          DeviceID: mountPoint,
          DriveType: guessTypeCode(mountPoint, ''),
          VolumeName: '',
          FileSystem: '',
          Size: totalKb * 1024,
          FreeSpace: availKb * 1024
        });
      }
      resolve(drives);
    });
  });
}

async function posixDrives() {
  const fromProc = procMountsDrives();
  if (fromProc.length > 0) return fromProc;
  return dfDrives();
}

// ------ 统一结构 ------

function normalizeDrive(d) {
  let letter = String(d.DeviceID || '');
  const isWinLetter = /^[A-Za-z]:$/.test(letter);
  let drivePath;

  if (isWinLetter) {
    drivePath = letter + '\\';
  } else {
    // Linux：DeviceID 就是挂载点，如 /、/home
    letter = letter.replace(/[\\/]+$/, '') || '/';
    drivePath = letter;
  }

  const typeCode = Number(d.DriveType);
  const total = Number(d.Size) || 0;
  const free = Number(d.FreeSpace) || 0;
  const used = Math.max(0, total - free);
  return {
    letter,
    path: drivePath,
    volumeName: d.VolumeName ? String(d.VolumeName) : '',
    typeCode: Number.isFinite(typeCode) ? typeCode : 3,
    typeName: DRIVE_TYPE_NAMES[typeCode] || '本地磁盘',
    fileSystem: d.FileSystem ? String(d.FileSystem) : '',
    total,
    free,
    used,
    usedPercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0
  };
}


module.exports = {
  drivesCache, DRIVE_TYPE_NAMES,
  powerShellDrives, statfsDrives,
  parseMounts, unescapeMount, guessTypeCode, procMountsDrives, dfDrives, posixDrives,
  normalizeDrive
};
