/* 文件中转站 — 浏览：磁盘、目录、导航、渲染、选择、懒加载 */
// =========================================================
// 磁盘（此电脑）
// =========================================================
async function loadDrives() {
  try {
    const res = await fetch('/api/drives');
    drivesData = await res.json();
  } catch (err) {
    console.error('读取磁盘失败:', err);
    drivesData = [];
  }
  renderNavDrives();
  if (currentView === 'drives') renderDriveGrid();
  updateStatus();
  checkLowDiskSpace();
}

// 剩余空间低于「总容量 5% 或 1 GB」就在状态栏提醒一次
let warnedLowDrives = new Set();

function checkLowDiskSpace() {
  const low = drivesData.filter(d => d.total > 0 && d.free >= 0 && d.free < Math.max(1024 * 1024 * 1024, d.total * 0.05));
  if (!low.length) return;

  const fresh = low.filter(d => !warnedLowDrives.has(d.letter || d.path));
  if (!fresh.length) return;
  fresh.forEach(d => warnedLowDrives.add(d.letter || d.path));

  flashStatus('⚠ 磁盘空间不足：' + fresh.map(d => `${driveShortName(d)} 仅剩 ${formatFileSize(d.free)}`).join('，'));
}

// Windows 是「卷标 (C:)」，类 Unix 直接用挂载点
function driveDisplayName(d) {
  const base = d.volumeName || d.typeName || '本地磁盘';
  if (/^[A-Za-z]:$/.test(d.letter || '')) return `${base} (${d.letter})`;
  return d.volumeName ? `${d.volumeName} (${d.path})` : (d.path || d.letter);
}

// 状态栏里的短标签
function driveShortName(d) {
  return /^[A-Za-z]:$/.test(d.letter || '') ? d.letter : (d.path || d.letter);
}

function normMount(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return s === '' ? '/' : s;
}

// 找出路径所属的驱动器：取「最长前缀」的那一个（Linux 上 /、/home、/mnt/usb 会互相包含）
function driveForPath(p) {
  const target = normMount(p);
  let best = null;
  let bestLen = -1;
  drivesData.forEach(d => {
    const dp = normMount(d.path);
    const hit = dp === '/' ? target.startsWith('/') : (target === dp || target.startsWith(dp + '/'));
    if (hit && dp.length > bestLen) { best = d; bestLen = dp.length; }
  });
  return best;
}

function driveSvg(extraClass = '') {
  return `<svg class="drive-svg ${extraClass}" viewBox="0 0 44 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="2.5" y="9.5" width="39" height="21" rx="3" fill="#e3e3e3" stroke="#b3b3b3" stroke-width="1.2"/>
    <path d="M2.5 12.5a3 3 0 0 1 3-3h33a3 3 0 0 1 3 3v6h-39z" fill="#f6f6f6" stroke="#b3b3b3" stroke-width="1.2"/>
    <circle cx="11" cy="25" r="2.6" fill="#4cd964"/>
    <rect x="24" y="22.8" width="13" height="4.4" rx="2.2" fill="#c9c9c9"/>
  </svg>`;
}

function folderSvg() {
  return `<svg class="folder-svg" viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M3 9.5A3.5 3.5 0 0 1 6.5 6h11.1c1 0 1.9.4 2.5 1.2L22 9.6h19.5A3.5 3.5 0 0 1 45 13.1v18A3.5 3.5 0 0 1 41.5 34.6h-35A3.5 3.5 0 0 1 3 31.1z" fill="#e2a63a"/>
    <path d="M3 13.4h42v17.7a3.5 3.5 0 0 1-3.5 3.5h-35A3.5 3.5 0 0 1 3 31.1z" fill="#ffd15c"/>
  </svg>`;
}

function renderNavDrives() {
  const box = document.getElementById('nav-drives');
  if (!drivesData.length) {
    box.innerHTML = '<div class="nav-empty">未检测到驱动器</div>';
    return;
  }
  box.innerHTML = drivesData.map(d => {
    const active = currentView === 'files' && driveForPath(currentPath) === d;
    return `
      <div class="nav-item ${active ? 'active' : ''}" onclick="openDrive('${jsStr(d.path)}')" title="${escapeHtml(driveDisplayName(d))}">
        <span class="nav-ico">${icon('drive')}</span>
        <div class="nav-text">
          <span>${escapeHtml(driveDisplayName(d))}</span>
          <span class="nav-sub">${formatFileSize(d.free)} 可用，共 ${formatFileSize(d.total)}</span>
          <div class="nav-drive-bar"><i class="${d.usedPercent > 90 ? 'low' : ''}" style="width:${d.usedPercent}%"></i></div>
        </div>
      </div>`;
  }).join('');
}

function renderDriveGrid() {
  const grid = document.getElementById('drive-grid');
  if (!drivesData.length) {
    grid.innerHTML = '<div class="nav-empty">未检测到驱动器</div>';
    return;
  }
  grid.innerHTML = drivesData.map(d => `
    <div class="drive-card" data-path="${escapeHtml(d.path)}" data-kind="drive" onclick="openDrive('${jsStr(d.path)}')" title="${escapeHtml(d.typeName)}${d.fileSystem ? ' · ' + d.fileSystem : ''} · 已用 ${formatFileSize(d.used)} · 可用 ${formatFileSize(d.free)}">
      ${driveSvg()}
      <div class="drive-body">
        <div class="drive-name">${escapeHtml(driveDisplayName(d))}</div>
        <div class="drive-bar"><i class="${d.usedPercent > 90 ? 'low' : ''}" style="width:${d.usedPercent}%"></i></div>
        <div class="drive-meta">${formatFileSize(d.free)} 可用，共 ${formatFileSize(d.total)}</div>
      </div>
    </div>`).join('');
}

function openDrive(rootPath) {
  closeNavPane();
  loadDirectory(rootPath);
}

function openThisPC(pushState = true) {
  resetSearchState(true);
  currentView = 'drives';
  currentPath = DRIVE_VIEW;
  currentDirData = null;
  entriesCache = [];
  selectedPaths = [];
  selectionAnchor = null;
  document.getElementById('path-input').value = '此电脑';
  renderBreadcrumbForDrives();
  document.getElementById('drives-view').style.display = 'block';
  document.getElementById('details-view').style.display = 'none';
  document.getElementById('icons-view').style.display = 'none';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('loading-bar').style.display = 'none';
  showSkeleton(false);
  renderDriveGrid();
  renderNavDrives();
  renderNavFavorites();
  updateStatus();
  updateNavButtons();
  document.title = '此电脑';
  if (pushState) pushHistory(DRIVE_VIEW);
  syncTab();
  closeNavPane();
}

// =========================================================
// 目录加载
// =========================================================
async function loadDirectory(dirPath, opts = {}) {
  if (dirPath === DRIVE_VIEW || dirPath === '此电脑') return openThisPC(!opts.replace);

  resetSearchState(true);

  const search = document.getElementById('search-input').value;
  showLoading(true);
  // 只有真的慢（>140ms）才出现骨架屏，本地快目录不会闪
  const skeletonTimer = setTimeout(() => {
    if (viewMode === 'details' && currentView !== 'drives') showSkeleton(true, 8);
  }, 140);

  try {
    const url = `/api/list?path=${encodeURIComponent(dirPath)}&sort=${sortBy}&order=${sortOrder}&search=${encodeURIComponent(search)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('打开失败：' + (err.error || '路径无效'));
      return false;
    }
    const data = await res.json();

    currentView = 'files';
    currentPath = data.currentPath;
    currentDirData = data;

    document.getElementById('path-input').value = data.currentPath;
    renderBreadcrumb(data.currentPath);

    document.getElementById('drives-view').style.display = 'none';

    // 两种视图都渲染：图片/视频查看器在任意视图下都可用
    renderFolders(data.folders);
    renderImages(data.images);
    renderVideos(data.videos);
    renderOthers(data.others);

    entriesCache = buildEntries(data);
    renderDetails(entriesCache);
    // 刷新时保留仍然存在的选中项，切换目录时自然清空
    selectedPaths = selectedPaths.filter(p => entriesCache.some(e => samePath(e.path, p)));
    if (selectionAnchor && !entriesCache.some(e => samePath(e.path, selectionAnchor))) selectionAnchor = null;
    applySelection();

    document.getElementById('details-view').style.display = viewMode === 'details' ? 'flex' : 'none';
    document.getElementById('icons-view').style.display = viewMode === 'icons' ? 'block' : 'none';

    const hasContent = entriesCache.length > 0;
    document.getElementById('empty-state').style.display = hasContent ? 'none' : 'block';

    renderNavDrives();
    updateStatus();
    document.title = data.currentPath;
    if (!opts.replace) pushHistory(data.currentPath);
    updateNavButtons();
    syncTab();
    closeNavPane();
    return true;
  } catch (err) {
    alert('打开失败: ' + err.message);
    return false;
  } finally {
    clearTimeout(skeletonTimer);
    showSkeleton(false);
    showLoading(false);
  }
}

function buildEntries(data) {
  const list = [];
  (data.folders || []).forEach(f => list.push({ ...f, kind: 'folder' }));
  (data.images || []).forEach(f => list.push({ ...f, kind: 'image' }));
  (data.videos || []).forEach(f => list.push({ ...f, kind: 'video' }));
  (data.others || []).forEach(f => list.push({ ...f, kind: 'file' }));
  return sortEntries(list);
}

function sortEntries(list) {
  const sorted = [...list];
  if (sortBy === 'name') {
    sorted.sort((a, b) => collator.compare(a.name, b.name));
  } else if (sortBy === 'time') {
    sorted.sort((a, b) => (a.mtime || 0) - (b.mtime || 0));
  } else if (sortBy === 'size') {
    sorted.sort((a, b) => (a.kind === 'folder' ? -1 : (a.size || 0)) - (b.kind === 'folder' ? -1 : (b.size || 0)));
  } else if (sortBy === 'type') {
    sorted.sort((a, b) => collator.compare(entryTypeName(a), entryTypeName(b)) || collator.compare(a.name, b.name));
  }
  return sortOrder === 'desc' ? sorted.reverse() : sorted;
}

function refreshView() {
  if (currentView === 'drives') return loadDrives();
  if (searchMode) return runRecursiveSearch(document.getElementById('search-input').value.trim());
  return loadDirectory(currentPath, { replace: true });
}

// =========================================================
// 搜索（当前目录过滤 / 递归搜索）
// =========================================================
function resetSearchState(clearInput) {
  if (!searchMode) return;
  searchMode = false;
  document.body.classList.remove('searching');
  const banner = document.getElementById('search-banner');
  if (banner) banner.style.display = 'none';
  if (clearInput) document.getElementById('search-input').value = '';
}

function toggleSearchRecursive() {
  searchRecursive = !searchRecursive;
  localStorage.setItem(SEARCH_SUB_KEY, searchRecursive ? '1' : '0');
  const btn = document.getElementById('search-sub-btn');
  if (btn) btn.classList.toggle('active', searchRecursive);
  onSearchInput();
}

function onSearchInput() {
  clearTimeout(searchTimer);
  const q = document.getElementById('search-input').value.trim();

  if (!q) {
    if (searchMode) return exitSearch();
    if (currentView === 'files') loadDirectory(currentPath, { replace: true, keepScroll: true });
    return;
  }

  if (!searchRecursive) {
    if (searchMode) exitSearch();
    searchTimer = setTimeout(() => {
      if (currentView === 'files') loadDirectory(currentPath, { replace: true, keepScroll: true });
    }, 300);
    return;
  }

  searchTimer = setTimeout(() => runRecursiveSearch(q), 320);
}

async function runRecursiveSearch(q) {
  if (currentView !== 'files' || !currentPath || !q) return;

  showLoading(true);
  try {
    const res = await fetch(`/api/search?path=${encodeURIComponent(currentPath)}&q=${encodeURIComponent(q)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error || '搜索失败'); return; }

    const items = (data.items || []).map(it => ({ ...it, displayName: it.rel }));
    searchMode = true;
    document.body.classList.add('searching');
    selectedPaths = [];
    selectionAnchor = null;

    document.getElementById('drives-view').style.display = 'none';
    document.getElementById('icons-view').style.display = 'none';
    document.getElementById('details-view').style.display = 'flex';
    document.getElementById('empty-state').style.display = items.length ? 'none' : 'block';
    document.getElementById('details-skeleton').style.display = 'none';

    entriesCache = items;
    renderDetails(items);
    applySelection();
    updateStatus();
    updateSearchBanner(data);
  } catch (err) {
    alert('搜索失败: ' + err.message);
  } finally {
    showLoading(false);
  }
}

function updateSearchBanner(info) {
  const el = document.getElementById('search-banner');
  const txt = document.getElementById('search-banner-text');
  if (!el || !txt) return;
  const base = currentPath.split(/[\\/]/).filter(Boolean).pop() || currentPath;
  txt.textContent = `在「${base}」及其子文件夹中找到 ${info.total || 0} 个结果`
    + (info.truncated ? '（结果较多，仅显示前一部分）' : '');
  el.style.display = 'flex';
}

function exitSearch() {
  resetSearchState(true);
  if (currentView === 'files') loadDirectory(currentPath, { replace: true });
}

function showLoading(show) {
  document.getElementById('loading-bar').style.display = show ? 'block' : 'none';
}

// 骨架屏：真实占位，替换原来的假进度条
function showSkeleton(show, rows) {
  const box = document.getElementById('details-skeleton');
  if (!box) return;
  if (!show) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  const count = rows || 6;
  let html = '';
  for (let i = 0; i < count; i++) {
    const w = ['w-80', 'w-60', 'w-40'][i % 3];
    html += `<div class="sk-row">
      <div class="sk-cell ${w}"></div>
      <div class="sk-cell w-60"></div>
      <div class="sk-cell w-40"></div>
      <div class="sk-cell w-40"></div>
    </div>`;
  }
  box.innerHTML = html;
  box.style.display = 'block';
}

// =========================================================
// 历史（前进 / 后退）
// =========================================================
function pushHistory(p) {
  const tab = activeTab();
  if (!tab) return;
  if (tab.history[tab.hIndex] === p) return updateNavButtons();
  tab.history = tab.history.slice(0, tab.hIndex + 1);
  tab.history.push(p);
  tab.hIndex = tab.history.length - 1;
  updateNavButtons();
  persistTabs();
}

function goBack() {
  const tab = activeTab();
  if (!tab || tab.hIndex <= 0) return;
  tab.hIndex--;
  navigateHistory();
}
function goForward() {
  const tab = activeTab();
  if (!tab || tab.hIndex >= tab.history.length - 1) return;
  tab.hIndex++;
  navigateHistory();
}
function navigateHistory() {
  const tab = activeTab();
  if (!tab) return;
  const p = tab.history[tab.hIndex];
  if (p === DRIVE_VIEW) openThisPC(false);
  else loadDirectory(p, { replace: true });
  updateNavButtons();
  persistTabs();
}
function updateNavButtons() {
  const tab = activeTab();
  const hIndex = tab ? tab.hIndex : -1;
  const len = tab ? tab.history.length : 0;
  document.getElementById('nav-back').disabled = hIndex <= 0;
  document.getElementById('nav-forward').disabled = hIndex >= len - 1;
}

// =========================================================
// 地址栏 / 路径
// =========================================================
function startEditPath() {
  const bar = document.getElementById('address-bar');
  bar.classList.add('editing');
  const input = document.getElementById('path-input');
  input.value = currentView === 'drives' ? '' : currentPath;
  input.focus();
  input.select();
}

function cancelEditPath() {
  document.getElementById('address-bar').classList.remove('editing');
  document.getElementById('path-input').value = currentView === 'drives' ? '此电脑' : currentPath;
}

function commitPathInput() {
  const value = document.getElementById('path-input').value.trim();
  document.getElementById('address-bar').classList.remove('editing');
  if (!value) return;
  if (value === '此电脑' || value.toLowerCase() === 'this pc' || value === 'drives') return openThisPC();
  loadDirectory(value);
}

function saveDefaultPath() {
  if (currentView !== 'files' || !currentPath) return alert('请先打开一个文件夹');
  localStorage.setItem(STORAGE_KEY, currentPath);
  alert('已保存为默认路径');
}

function goUp() {
  if (currentView === 'drives') return;
  if (!currentPath) return;
  if (/^[a-zA-Z]:\\?$/.test(currentPath)) return openThisPC();   // 盘符根目录 → 此电脑
  if (currentPath === '/' || currentPath === '\\') return openThisPC();  // 类 Unix 根目录

  const parent = currentPath.replace(/[\\/][^\\/]+$/, '');
  if (parent === currentPath || /^[a-zA-Z]:$/.test(parent)) return openThisPC();
  // 类 Unix 上 /home 的上一级是 /（正则裁掉后为空串）
  if (!parent) return currentPath.startsWith('/') ? loadDirectory('/') : openThisPC();
  loadDirectory(parent);
}

function renderBreadcrumbForDrives() {
  document.getElementById('breadcrumb').innerHTML = '<span class="current">此电脑</span>';
  document.getElementById('addr-ico').innerHTML = icon('monitor');
}

function renderBreadcrumb(fullPath) {
  const bc = document.getElementById('breadcrumb');
  document.getElementById('addr-ico').innerHTML = icon('folder-line');
  const sep = fullPath.includes('\\') ? '\\' : '/';
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  if (!parts.length) {
    bc.innerHTML = `<a href="#" onclick="openThisPC();return false;">此电脑</a><span class="sep">›</span><span class="current">${escapeHtml(fullPath)}</span>`;
    return;
  }

  let html = '<a href="#" onclick="openThisPC();return false;">此电脑</a><span class="sep">›</span>';
  let accum = '';
  parts.forEach((part, i) => {
    if (i === 0 && /^[a-zA-Z]:$/.test(part)) accum = part + sep;   // C:
    else if (i === 0 && sep === '/') accum = '/' + part;           // /home
    else accum = accum.replace(/[\\/]$/, '') + sep + part;

    if (i === parts.length - 1) {
      html += `<span class="current">${escapeHtml(part)}</span>`;
    } else {
      html += `<a href="#" onclick="loadDirectory('${jsStr(accum)}');return false;">${escapeHtml(part)}</a><span class="sep">›</span>`;
    }
  });
  bc.innerHTML = html;
}

// =========================================================
// 排序 / 视图
// =========================================================
function changeSort() {
  const val = document.getElementById('sort-select').value;
  [sortBy, sortOrder] = val.split('-');
  updateSortIndicators();
  if (currentView === 'files') loadDirectory(currentPath, { replace: true });
}

function sortByColumn(col) {
  if (sortBy === col) sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
  else { sortBy = col; sortOrder = 'asc'; }

  const select = document.getElementById('sort-select');
  const option = [...select.options].find(o => o.value === `${sortBy}-${sortOrder}`);
  if (option) select.value = option.value;

  updateSortIndicators();
  if (searchMode) {
    // 搜索结果直接就地排序
    entriesCache = sortSimple(entriesCache);
    renderDetails(entriesCache);
    applySelection();
    updateStatus();
    return;
  }
  if (currentView !== 'files' || !currentDirData) return;

  // 本地重排（不重新请求）
  currentDirData.folders = sortSimple(currentDirData.folders);
  currentDirData.images = sortSimple(currentDirData.images);
  currentDirData.videos = sortSimple(currentDirData.videos);
  currentDirData.others = sortSimple(currentDirData.others);

  entriesCache = buildEntries(currentDirData);
  renderFolders(currentDirData.folders);
  renderImages(currentDirData.images);
  renderVideos(currentDirData.videos);
  renderOthers(currentDirData.others);
  renderDetails(entriesCache);
  applySelection();
  updateStatus();
}

function sortSimple(list) {
  const mul = sortOrder === 'desc' ? -1 : 1;
  return [...(list || [])].sort((a, b) => {
    if (sortBy === 'name') return collator.compare(a.name, b.name) * mul;
    if (sortBy === 'time') return ((a.mtime || 0) - (b.mtime || 0)) * mul;
    if (sortBy === 'size') return ((a.size || 0) - (b.size || 0)) * mul;
    if (sortBy === 'type') return collator.compare(entryTypeName(a), entryTypeName(b)) * mul;
    return 0;
  });
}

function updateSortIndicators() {
  document.querySelectorAll('.details-head .col').forEach(el => {
    const match = el.dataset.col === sortBy;
    el.classList.toggle('sorted', match);
    el.classList.toggle('desc', match && sortOrder === 'desc');
  });
}

function toggleViewMode() {
  viewMode = viewMode === 'details' ? 'icons' : 'details';
  localStorage.setItem(VIEW_KEY, viewMode);
  applyViewMode();
}

function applyViewMode() {
  const btn = document.getElementById('view-toggle-btn');
  if (viewMode === 'details') {
    btn.innerHTML = icon('view-details') + '<span class="cmd-txt">详细信息</span>';
    if (currentView === 'files') {
      document.getElementById('details-view').style.display = 'flex';
      document.getElementById('icons-view').style.display = 'none';
    }
  } else {
    btn.innerHTML = icon('view-icons') + '<span class="cmd-txt">图标</span>';
    if (currentView === 'files') {
      document.getElementById('details-view').style.display = 'none';
      document.getElementById('icons-view').style.display = 'block';
    }
  }
}

// =========================================================
// 名称 / 类型 / 大小 工具
// =========================================================
function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function entryTypeName(entry) {
  if (entry.kind === 'folder') return '文件夹';
  const ext = extOf(entry.name);
  const names = {
    jpg: 'JPG 图片', jpeg: 'JPEG 图片', png: 'PNG 图片', gif: 'GIF 图片', webp: 'WEBP 图片',
    bmp: 'BMP 图片', svg: 'SVG 图片', tif: 'TIF 图片', tiff: 'TIFF 图片',
    mp4: 'MP4 视频', mkv: 'MKV 视频', avi: 'AVI 视频', mov: 'MOV 视频', webm: 'WEBM 视频',
    flv: 'FLV 视频', wmv: 'WMV 视频', m4v: 'M4V 视频', ts: 'TS 视频',
    pdf: 'PDF 文档', doc: 'Word 文档', docx: 'Word 文档', xls: 'Excel 工作表', xlsx: 'Excel 工作表',
    ppt: 'PowerPoint', pptx: 'PowerPoint', txt: '文本文档', md: 'Markdown', json: 'JSON 文件',
    zip: '压缩文件', rar: '压缩文件', '7z': '压缩文件', exe: '应用程序', js: 'JS 文件',
    py: 'Python 文件', html: 'HTML 文件', css: 'CSS 文件', mp3: 'MP3 音频', wav: 'WAV 音频'
  };
  return names[ext] || (ext ? ext.toUpperCase() + ' 文件' : '文件');
}

// 统一的矢量图标引用
function icon(name, cls = '') {
  return `<svg class="gi ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// 彩色文件图标：白色页面 + 折角 + 类型色带 + 白色小图案
const FILE_ICON_TYPES = {
  image: { color: '#0f7b0f', mark: '<circle cx="10.5" cy="16.5" r="1" fill="#fff"/><path d="M8.3 20.3l2.5-2.7 1.7 1.7 1.4-1.4 1.9 2.4" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>' },
  video: { color: '#c2410c', mark: '<path d="M10.1 15.4l5 2.9-5 2.9z" fill="#fff"/>' },
  audio: { color: '#7c3aed', mark: '<path d="M11.2 20.4v-4.6l3.9-1v4.4" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/><circle cx="10.3" cy="20.4" r="1.35" fill="#fff"/><circle cx="14.2" cy="19.2" r="1.35" fill="#fff"/>' },
  pdf: { color: '#c4314b', mark: '<path d="M9 16.3h6M9 18.5h6M9 20.7h4" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>' },
  doc: { color: '#2b579a', mark: '<path d="M9 16.3h6M9 18.5h6M9 20.7h4" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>' },
  sheet: { color: '#107c41', mark: '<rect x="8.9" y="15.1" width="6.4" height="5.9" rx="1" fill="none" stroke="#fff" stroke-width="1.05"/><path d="M12.1 15.1v5.9M8.9 18.05h6.4" stroke="#fff" stroke-width="1.05"/>' },
  slide: { color: '#c43e1c', mark: '<rect x="9" y="15.3" width="6.3" height="4.3" rx="1" fill="#fff"/><path d="M11 21.1h2.3" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>' },
  archive: { color: '#a1662f', mark: '<path d="M12.1 14.9v6.4" stroke="#fff" stroke-width="1.1"/><path d="M10.7 16.3h2.8M10.7 17.7h2.8M10.7 19.1h2.8" stroke="#fff" stroke-width="1.05"/>' },
  code: { color: '#0f6cbd', mark: '<path d="M10.7 16.3l-1.8 1.9 1.8 1.9M13.5 16.3l1.8 1.9-1.8 1.9" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  exe: { color: '#4b5563', mark: '<rect x="9.3" y="15.3" width="5.6" height="5.6" rx="1.3" fill="none" stroke="#fff" stroke-width="1.15"/><circle cx="12.1" cy="18.1" r="1.25" fill="#fff"/>' },
  text: { color: '#6b6b6b', mark: '<path d="M9 16.3h6M9 18.5h6M9 20.7h4" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>' },
  file: { color: '#8a8a8a', mark: '<path d="M9 16.3h6M9 18.5h4" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>' }
};

const EXT_TYPE_MAP = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image', tif: 'image', tiff: 'image', heic: 'image', ico: 'image',
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', webm: 'video', flv: 'video', wmv: 'video', m4v: 'video', ts: 'video', mpg: 'video', mpeg: 'video', rmvb: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', m4a: 'audio', ogg: 'audio', wma: 'audio',
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', rtf: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet',
  ppt: 'slide', pptx: 'slide',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive', iso: 'archive',
  js: 'code', mjs: 'code', cjs: 'code', ts: 'code', jsx: 'code', tsx: 'code', py: 'code', java: 'code', c: 'code', h: 'code',
  cpp: 'code', cs: 'code', go: 'code', rs: 'code', rb: 'code', php: 'code', html: 'code', htm: 'code', css: 'code',
  scss: 'code', less: 'code', json: 'code', xml: 'code', yml: 'code', yaml: 'code', sh: 'code', ps1: 'code', sql: 'code', vue: 'code',
  exe: 'exe', msi: 'exe', bat: 'exe', cmd: 'exe', com: 'exe', dll: 'exe', apk: 'exe',
  txt: 'text', md: 'text', log: 'text', ini: 'text', conf: 'text', cfg: 'text', properties: 'text'
};

function fileIconHtml(name) {
  const t = FILE_ICON_TYPES[EXT_TYPE_MAP[extOf(name)]] || FILE_ICON_TYPES.file;
  return `<svg class="fi" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5.2 4.2A1.6 1.6 0 0 1 6.8 2.6h6.9l5.1 5.1v12.5a1.6 1.6 0 0 1-1.6 1.6H6.8a1.6 1.6 0 0 1-1.6-1.6z" fill="#ffffff" stroke="#b9b9b9" stroke-width="1.05"/>
    <path d="M13.7 2.6l5.1 5.1h-3.5a1.6 1.6 0 0 1-1.6-1.6z" fill="#ebebeb" stroke="#b9b9b9" stroke-width="1.05"/>
    <path d="M5.2 13.9h13.6v6.3a1.6 1.6 0 0 1-1.6 1.6H6.8a1.6 1.6 0 0 1-1.6-1.6z" fill="${t.color}"/>
    ${t.mark}
  </svg>`;
}

function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}

function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function entryIconHtml(entry) {
  if (entry.kind === 'folder') return folderSvg();
  if (entry.kind === 'image') return `<img class="thumb" data-src="/api/thumbnail/image?path=${encodeURIComponent(entry.path)}" alt="">`;
  if (entry.kind === 'video') return `<img class="thumb" data-src="/api/thumbnail/video?path=${encodeURIComponent(entry.path)}" alt="">`;
  return `<span>${fileIconHtml(entry.name)}</span>`;
}

// =========================================================
// 渲染：详细信息
// =========================================================
function renderDetails(entries) {
  const body = document.getElementById('details-body');
  body.innerHTML = '';
  const frag = document.createDocumentFragment();

  entries.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'd-row';
    row.dataset.path = entry.path;
    row.dataset.kind = entry.kind;
    row.innerHTML = `
      <div class="col col-name"><span class="ico">${entryIconHtml(entry)}</span><span class="nm${entry.displayName ? ' nm-rel' : ''}">${escapeHtml(entry.displayName || entry.name)}</span></div>
      <div class="col col-time">${formatDate(entry.mtime)}</div>
      <div class="col col-type">${escapeHtml(entryTypeName(entry))}</div>
      <div class="col col-size">${entry.kind === 'folder' ? '' : formatFileSize(entry.size)}</div>`;
    row.addEventListener('click', (e) => handleEntryClick(e, entry));
    row.addEventListener('dblclick', () => openEntry(entry));
    frag.appendChild(row);
  });

  body.appendChild(frag);
  body.querySelectorAll('img[data-src]').forEach(img => lazyLoadImage(img));
}

// =========================================================
// 选择（单选 / Ctrl 多选 / Shift 连选）
// =========================================================
function isSelected(p) {
  return selectedPaths.some(x => samePath(x, p));
}

function primarySelectedPath() {
  return selectedPaths.length ? selectedPaths[selectedPaths.length - 1] : null;
}

function selectedEntries() {
  return entriesCache.filter(e => isSelected(e.path));
}

// 把选中态与剪切态一起刷到 DOM 上（两种视图共用一套 data-path）
function applySelection() {
  const cutting = !!clipboard && clipboard.op === 'cut';
  document.querySelectorAll('[data-path]').forEach(el => {
    const p = el.dataset.path;
    el.classList.toggle('selected', isSelected(p));
    el.classList.toggle('cut', cutting && inClipboard(p));
  });
}

function setSelection(paths, opts = {}) {
  const seen = new Set();
  selectedPaths = paths.filter(p => {
    const k = selKey(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (opts.anchor !== false) selectionAnchor = selectedPaths[selectedPaths.length - 1] || null;
  applySelection();
  updateStatus();
  updateSelectBar();
}

function selKey(p) {
  return String(p == null ? '' : p).replace(/[\\/]+$/, '');
}

function toggleSelection(p) {
  if (isSelected(p)) {
    const idx = selectedPaths.findIndex(x => samePath(x, p));
    const next = selectedPaths.slice();
    next.splice(idx, 1);
    setSelection(next);
    selectionAnchor = selectionAnchor && samePath(selectionAnchor, p) ? (next[next.length - 1] || null) : selectionAnchor;
  } else {
    setSelection([...selectedPaths, p], { anchor: false });
    selectionAnchor = p;
  }
}

function clearSelection() {
  setSelection([]);
  selectionAnchor = null;
}

// Shift 连选：按列表顺序从锚点选到目标
function selectRangeTo(p) {
  const all = entriesCache.map(e => e.path);
  const target = all.find(x => samePath(x, p));
  if (!target) return setSelection([p]);

  const anchor = selectionAnchor && all.some(x => samePath(x, selectionAnchor)) ? selectionAnchor : target;
  const i = all.findIndex(x => samePath(x, anchor));
  const j = all.findIndex(x => samePath(x, target));
  const [a, b] = i <= j ? [i, j] : [j, i];
  setSelection(all.slice(a, b + 1), { anchor: false });
}

function selectAllEntries() {
  if (currentView !== 'files') return;
  setSelection(entriesCache.map(e => e.path));
}

// 行点击：Ctrl 切换、Shift 连选、普通单选（触屏上普通点击直接打开）
function handleEntryClick(e, entry) {
  if (selectionMode) return toggleSelection(entry.path);
  if (e.ctrlKey || e.metaKey) return toggleSelection(entry.path);
  if (e.shiftKey) return selectRangeTo(entry.path);
  setSelection([entry.path]);
  if (isTouch && Date.now() > suppressClickUntil) openEntry(entry);
}

// 图标视图里由内联 onclick 调用
function iconClick(ev, p) {
  if (selectionMode) return toggleSelection(p);
  if (ev.ctrlKey || ev.metaKey) return toggleSelection(p);
  if (ev.shiftKey) return selectRangeTo(p);
  setSelection([p]);
  if (isTouch && Date.now() > suppressClickUntil) openEntryPath(p);
}

// ---------- 手机端选择模式 ----------
function toggleSelectionMode(force) {
  selectionMode = typeof force === 'boolean' ? force : !selectionMode;
  document.body.classList.toggle('selection-mode', selectionMode);
  const btn = document.getElementById('select-mode-btn');
  if (btn) btn.classList.toggle('active', selectionMode);
  updateSelectBar();
  if (!selectionMode) clearSelection();
}

function exitSelectionMode() {
  toggleSelectionMode(false);
}

function updateSelectBar() {
  const bar = document.getElementById('select-bar');
  if (!bar) return;
  bar.classList.toggle('active', selectionMode);
  const count = document.getElementById('select-count');
  if (count) count.textContent = `已选 ${selectedPaths.length} 项`;
}

function toggleSelectAllMobile() {
  if (entriesCache.length && selectedPaths.length === entriesCache.length) setSelection([]);
  else setSelection(entriesCache.map(e => e.path));
  updateSelectBar();
}

function zipSelectedMobile() {
  const items = selectedEntries();
  if (!items.length) return flashStatus('请先选择项目');
  zipSelection(items);
}

function openEntryPath(p) {
  const entry = entriesCache.find(e => samePath(e.path, p));
  if (entry) openEntry(entry);
}

function moveSelection(delta, extend) {
  const rows = [...document.querySelectorAll('.d-row')];
  if (!rows.length) return;
  const primary = primarySelectedPath();
  let idx = rows.findIndex(r => samePath(r.dataset.path, primary));
  idx = idx === -1 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, idx + delta));
  const row = rows[idx];
  const entry = entriesCache.find(e => samePath(e.path, row.dataset.path));
  if (!entry) return;

  if (extend && selectionAnchor) selectRangeTo(entry.path);
  else setSelection([entry.path]);
  row.scrollIntoView({ block: 'nearest' });
}

// =========================================================
// 打开条目
// =========================================================
function openEntry(entry) {
  if (selectionMode) return;   // 选择模式下点击只勾选，不打开
  if (entry.kind === 'folder') return loadDirectory(entry.path);
  if (entry.kind === 'image') {
    const idx = imageList.findIndex(i => i.path === entry.path);
    return openImage(idx === -1 ? 0 : idx);
  }
  if (entry.kind === 'video') {
    const idx = videoList.findIndex(v => v.path === entry.path);
    return openVideo(idx === -1 ? 0 : idx);
  }
  openFile(entry.path);
}

function openFile(filePath) {
  if (extOf(filePath) === 'pdf') openPdfViewer(filePath);
  else window.open('/api/file?path=' + encodeURIComponent(filePath), '_blank');
}

// =========================================================
// 渲染：图标视图
// =========================================================
function renderFolders(folders) {
  const section = document.getElementById('folders-section');
  const grid = document.getElementById('folder-grid');
  if (!folders.length) { section.style.display = 'none'; grid.innerHTML = ''; return; }
  section.style.display = 'block';
  grid.innerHTML = folders.map(f => `
    <div class="folder-item" data-path="${escapeHtml(f.path)}" data-kind="folder"
         onclick="iconClick(event,'${jsStr(f.path)}')"
         ondblclick="openEntryPath('${jsStr(f.path)}')">
      ${folderSvg()}
      <div class="folder-name">${escapeHtml(f.name)}</div>
    </div>`).join('');
}

function renderImages(images) {
  const section = document.getElementById('images-section');
  const grid = document.getElementById('image-grid');
  imageList = images; currentImageIndex = 0; preloadCache = {};
  if (!images.length) { section.style.display = 'none'; grid.innerHTML = ''; return; }
  section.style.display = 'block';
  grid.innerHTML = images.map((img, index) => `
    <div class="media-item" data-path="${escapeHtml(img.path)}" data-kind="image" title="${escapeHtml(img.name)}"
         onclick="iconClick(event,'${jsStr(img.path)}')"
         ondblclick="openImage(${index})">
      <img data-src="/api/thumbnail/image?path=${encodeURIComponent(img.path)}" alt="${escapeHtml(img.name)}">
    </div>`).join('');
  grid.querySelectorAll('img[data-src]').forEach(img => lazyLoadImage(img));
}

function renderVideos(videos) {
  const section = document.getElementById('videos-section');
  const grid = document.getElementById('video-grid');
  videoList = videos; currentVideoIndex = 0;
  if (!videos.length) { section.style.display = 'none'; grid.innerHTML = ''; return; }
  section.style.display = 'block';
  grid.innerHTML = videos.map((v, index) => `
    <div class="media-item" data-path="${escapeHtml(v.path)}" data-kind="video" title="${escapeHtml(v.name)}"
         onclick="iconClick(event,'${jsStr(v.path)}')"
         ondblclick="openVideo(${index})">
      <img data-src="/api/thumbnail/video?path=${encodeURIComponent(v.path)}" alt="${escapeHtml(v.name)}">
      <div class="video-badge">▶</div>
    </div>`).join('');
  grid.querySelectorAll('img[data-src]').forEach(img => lazyLoadImage(img));
}

function renderOthers(others) {
  const section = document.getElementById('others-section');
  const grid = document.getElementById('others-grid');
  if (!others || !others.length) { section.style.display = 'none'; grid.innerHTML = ''; return; }
  section.style.display = 'block';
  grid.innerHTML = others.map(f => `
    <div class="other-item" data-path="${escapeHtml(f.path)}" data-kind="file"
         onclick="iconClick(event,'${jsStr(f.path)}')"
         ondblclick="openEntryPath('${jsStr(f.path)}')">
      <div class="other-icon">${fileIconHtml(f.name)}</div>
      <div class="other-info">
        <div class="other-name">${escapeHtml(f.name)}</div>
        <div class="other-size">${formatDate(f.mtime)} · ${formatFileSize(f.size)}</div>
      </div>
      <a class="other-download" href="/api/file?path=${encodeURIComponent(f.path)}&download=1" onclick="event.stopPropagation()" title="下载">${icon('download')}</a>
    </div>`).join('');
}

// =========================================================
// 状态栏
// =========================================================
function updateStatus() {
  const left = document.getElementById('status-left');
  const right = document.getElementById('status-right');

  if (currentView === 'drives') {
    left.textContent = `${drivesData.length} 个驱动器`;
    const totalFree = drivesData.reduce((s, d) => s + d.free, 0);
    const totalAll = drivesData.reduce((s, d) => s + d.total, 0);
    right.textContent = totalAll ? `所有磁盘 ${formatFileSize(totalFree)} 可用，共 ${formatFileSize(totalAll)}` : '';
    return;
  }

  const count = entriesCache.length;
  const folders = entriesCache.filter(e => e.kind === 'folder').length;
  const sel = selectedEntries();
  if (sel.length > 1) {
    const bytes = sel.reduce((s, e) => s + (e.kind === 'folder' ? 0 : (e.size || 0)), 0);
    const dirs = sel.filter(e => e.kind === 'folder').length;
    left.textContent = `已选择 ${sel.length} 个项目`
      + (dirs ? `（${dirs} 个文件夹）` : '')
      + (bytes ? `，共 ${formatFileSize(bytes)}` : '');
  } else if (sel.length === 1) {
    left.textContent = `已选择 1 个项目：${sel[0].name}`;
  } else {
    left.textContent = `共 ${count} 个项目${folders ? `（${folders} 个文件夹）` : ''}`;
  }

  const drive = driveForPath(currentPath);
  right.textContent = drive ? `${driveShortName(drive)} ${formatFileSize(drive.free)} 可用，共 ${formatFileSize(drive.total)}` : '';

  if (clipboard) {
    const verb = clipboard.op === 'copy' ? '复制' : '剪切';
    left.textContent += ` · 已${verb} ${clipboard.paths.length} 个项目，Ctrl+V 粘贴`;
  }
}

// =========================================================
// 懒加载
// =========================================================
function initLazyLoad() {
  if ('IntersectionObserver' in window) {
    lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.onload = () => {
            img.classList.add('loaded');
            const cell = img.closest('.media-item');
            if (cell) cell.classList.add('loaded');
          };
          img.removeAttribute('data-src');
        }
        lazyObserver.unobserve(img);
      });
    }, { rootMargin: '300px' });
  }
}

function lazyLoadImage(img) {
  const settle = () => {
    img.classList.add('loaded');
    const cell = img.closest('.media-item');
    if (cell) cell.classList.add('loaded');
  };
  if (!lazyObserver) {
    img.src = img.dataset.src;
    img.onload = settle;
    img.onerror = settle;
    img.removeAttribute('data-src');
    return;
  }
  img.addEventListener('load', settle, { once: true });
  img.addEventListener('error', settle, { once: true });
  lazyObserver.observe(img);
}

