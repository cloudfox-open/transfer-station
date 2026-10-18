const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const DEFAULT_ROOT = ROOT;
const CACHE_DIR = path.join(ROOT, '.cache');
const DATA_DIR = path.join(ROOT, '.data');
const TRASH_DIR = path.join(DATA_DIR, 'trash');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
const LIFEZONE_DIR = path.join(DATA_DIR, 'lifezone');
const MEMOS_FILE = path.join(LIFEZONE_DIR, 'memos.json');
const PHOTOS_DIR = path.join(LIFEZONE_DIR, 'photos');

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.svg'];
const VIDEO_EXT = ['.mp4', '.webm', '.ogg', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.m4v', '.ts'];

const IS_WINDOWS = process.platform === 'win32';

// 单个上传文件的大小上限，可用 MAX_UPLOAD_MB 覆盖
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 2048;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
// 缩略图缓存上限，可用 CACHE_MAX_MB 覆盖
const CACHE_MAX_MB = Number(process.env.CACHE_MAX_MB) || 500;

function ensureDirs() {
  for (const dir of [CACHE_DIR, DATA_DIR, TRASH_DIR, LIFEZONE_DIR, PHOTOS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(FAVORITES_FILE)) fs.writeFileSync(FAVORITES_FILE, '[]', 'utf8');
  if (!fs.existsSync(MEMOS_FILE)) fs.writeFileSync(MEMOS_FILE, '[]', 'utf8');
}

module.exports = {
  ROOT,
  DEFAULT_ROOT,
  CACHE_DIR,
  DATA_DIR,
  TRASH_DIR,
  FAVORITES_FILE,
  LIFEZONE_DIR,
  MEMOS_FILE,
  PHOTOS_DIR,
  IMAGE_EXT,
  VIDEO_EXT,
  IS_WINDOWS,
  MAX_UPLOAD_MB,
  MAX_UPLOAD_BYTES,
  CACHE_MAX_MB,
  ensureDirs
};
