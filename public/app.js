/* =========================================================
   文件中转站 — 前端逻辑（Windows 资源管理器风格）
   ========================================================= */

// ---------- 状态 ----------
const STORAGE_KEY = 'default_media_path';
const THEME_KEY = 'theme';
const COLOR_KEY = 'theme-color';
const VIEW_KEY = 'view-mode';
const TABS_KEY = 'open-tabs';
const COMPACT_KEY = 'compact-mode';
const DRIVE_VIEW = '::this-pc';          // 「此电脑」虚拟路径

let currentPath = '';
let currentView = 'files';               // files | drives
let viewMode = localStorage.getItem(VIEW_KEY) || 'details';   // details | icons

let drivesData = [];
let currentDirData = null;
let entriesCache = [];

let imageList = [];
let videoList = [];
let currentImageIndex = 0;
let currentVideoIndex = 0;
let touchStartX = 0;

let sortBy = 'name';
let sortOrder = 'asc';
let searchTimer = null;

let slideshowTimer = null;
let slideshowSpeed = 5000;
let slideshowActive = false;

let preloadCache = {};
let lazyObserver = null;
let selectedPath = null;

// 标签页
let tabs = [];                 // [{ id, title, view, path, history, hIndex }]
let activeTabId = null;
let tabSeq = 0;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const isTouch = window.matchMedia('(hover: none)').matches;

// =========================================================
// 初始化
// =========================================================
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  loadThemeColor();
  initLazyLoad();
  initDragDrop();
  initCompact();
  initContextMenu();
  initModal();
  applyViewMode();
  updateSortIndicators();
  loadDrives();

  // 支持深链：?path=F:/some/dir&view=details|icons&theme=dark|light
  const params = new URLSearchParams(location.search);
  const paramPath = params.get('path');
  const paramView = params.get('view');
  const paramTheme = params.get('theme');
  if (paramTheme === 'dark' || paramTheme === 'light') {
    document.documentElement.setAttribute('data-theme', paramTheme);
    localStorage.setItem(THEME_KEY, paramTheme);
  }
  if (paramView === 'details' || paramView === 'icons') {
    viewMode = paramView;
    localStorage.setItem(VIEW_KEY, viewMode);
    applyViewMode();
  }

  // 恢复上次的标签页；否则按 ?path / 默认路径 / 此电脑新开一个
  const restored = restoreTabs();
  if (!restored) {
    const t = createTab();
    activeTabId = t.id;
    renderTabs();
    const startPath = paramPath || localStorage.getItem(STORAGE_KEY);
    if (startPath) loadDirectory(startPath).then(ok => { if (!ok) openThisPC(true); });
    else openThisPC(true);
  } else if (paramPath) {
    addTabWith(paramPath);
  } else {
    const tab = activeTab();
    if (tab.view === 'drives') openThisPC(false);
    else loadDirectory(tab.path, { replace: true }).then(ok => { if (!ok) openThisPC(false); });
  }

  // 地址栏
  const pathInput = document.getElementById('path-input');
  pathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitPathInput();
    else if (e.key === 'Escape') cancelEditPath();
  });
  pathInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (!document.getElementById('address-bar').classList.contains('editing')) return;
      cancelEditPath();
    }, 120);
  });

  // 搜索
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (currentView === 'files') loadDirectory(currentPath, { replace: true, keepScroll: true }); }, 300);
  });

  // 关闭下拉菜单
  document.addEventListener('click', (e) => {
    const btn = document.getElementById('fab-btn');
    const menu = document.getElementById('fab-menu');
    if (!btn.contains(e.target) && !menu.contains(e.target)) closeMenu();
  });

  // 快捷键
  document.addEventListener('keydown', handleKeyboard);
  // 手机滑动手势
  const viewerImg = document.getElementById('viewer-img');
  viewerImg.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
  viewerImg.addEventListener('touchend', (e) => {
    const diff = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(diff) > 50) diff > 0 ? prevImage() : nextImage();
  }, { passive: true });
});

function handleKeyboard(e) {
  const imgViewer = document.getElementById('image-viewer');
  const vidViewer = document.getElementById('video-viewer');
  const pdfViewer = document.getElementById('pdf-viewer');
  const editing = document.getElementById('address-bar').classList.contains('editing');
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

  if (e.key === 'Escape') {
    if (isModalOpen()) { closeModal(); return; }
    if (isContextMenuOpen()) { closeContextMenu(); return; }
  }

  if (imgViewer.classList.contains('active')) {
    if (e.key === 'ArrowLeft') prevImage();
    else if (e.key === 'ArrowRight') nextImage();
    else if (e.key === 'Escape') closeImageViewer();
    else if (e.key === ' ') { e.preventDefault(); nextImage(); }
    return;
  }
  if (vidViewer.classList.contains('active')) {
    if (e.key === 'ArrowLeft') prevVideo();
    else if (e.key === 'ArrowRight') nextVideo();
    else if (e.key === 'Escape') closeVideoViewer();
    return;
  }
  if (pdfViewer.classList.contains('active')) {
    if (e.key === 'Escape') closePdfViewer();
    return;
  }
  if (typing || editing) return;

  if ((e.ctrlKey || e.metaKey) && (e.key === 't' || e.key === 'T')) { e.preventDefault(); addTab(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); closeTab(activeTabId); return; }

  // 文件操作快捷键
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
    if (selectedPath) { e.preventDefault(); copyPath(selectedPath); }
    return;
  }
  if (e.key === 'F5') { e.preventDefault(); refreshView(); return; }
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault();
    openContextMenuForSelection();
    return;
  }
  if (selectedPath) {
    const entry = entriesCache.find(x => x.path === selectedPath);
    if (entry) {
      if (e.key === 'F2') { e.preventDefault(); startInlineRename(entry); return; }
      if (e.key === 'Delete') { e.preventDefault(); confirmDelete(entry); return; }
    }
  }

  if (viewMode === 'details' && currentView === 'files') {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      const entry = entriesCache.find(x => x.path === selectedPath);
      if (entry) openEntry(entry);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      goUp();
    }
  }
}

// =========================================================
// 主题
// =========================================================
function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const system = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', stored || system);
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
}

function setThemeColor(color, el) {
  const root = document.documentElement;
  root.style.setProperty('--primary', color);

  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  root.style.setProperty('--primary-hover', `rgb(${Math.max(0, r - 18)},${Math.max(0, g - 18)},${Math.max(0, b - 18)})`);
  root.style.setProperty('--primary-soft', `rgba(${r},${g},${b},0.12)`);
  root.style.setProperty('--primary-glow', `rgba(${r},${g},${b},0.25)`);
  root.style.setProperty('--selected', `rgba(${r},${g},${b},0.16)`);
  root.style.setProperty('--selected-hover', `rgba(${r},${g},${b},0.24)`);
  root.style.setProperty('--drive-bar', color);
  localStorage.setItem(COLOR_KEY, color);

  document.querySelectorAll('.theme-dot').forEach(d => d.classList.remove('active'));
  if (el) el.classList.add('active');
  else document.querySelector(`.theme-dot[data-color="${color}"]`)?.classList.add('active');
}

function loadThemeColor() {
  const saved = localStorage.getItem(COLOR_KEY);
  if (saved) setThemeColor(saved);
}

// =========================================================
// 菜单 / 导航窗格
// =========================================================
function toggleMenu() {
  document.getElementById('fab-btn').classList.toggle('active');
  document.getElementById('fab-menu').classList.toggle('open');
}
function closeMenu() {
  document.getElementById('fab-btn').classList.remove('active');
  document.getElementById('fab-menu').classList.remove('open');
}

function toggleNavPane() {
  document.getElementById('nav-pane').classList.toggle('open');
  document.getElementById('nav-scrim').classList.toggle('active');
}
function closeNavPane() {
  document.getElementById('nav-pane').classList.remove('open');
  document.getElementById('nav-scrim').classList.remove('active');
}

// =========================================================
// 标签页
// =========================================================
function activeTab() {
  return tabs.find(t => t.id === activeTabId) || null;
}

function createTab() {
  const tab = {
    id: 'tab' + (++tabSeq) + Date.now().toString(36),
    title: '此电脑',
    view: 'drives',
    path: DRIVE_VIEW,
    history: [],
    hIndex: -1
  };
  tabs.push(tab);
  return tab;
}

function tabTitleFor(view, path) {
  if (view === 'drives' || !path) return '此电脑';
  const name = String(path).split(/[\\/]/).filter(Boolean).pop();
  return name || path;
}

// 把当前实时状态写回活动标签
function syncTab() {
  const tab = activeTab();
  if (!tab) return;
  // 尚未真正加载出路径时不要写回，避免把标签状态清空
  if (currentView === 'files' && !currentPath) return;
  tab.view = currentView;
  tab.path = currentPath;
  tab.title = tabTitleFor(currentView, currentPath);
  document.getElementById('titlebar-path').textContent = tab.view === 'drives' ? '此电脑' : tab.path;
  renderTabs();
  persistTabs();
}

function renderTabs() {
  const box = document.getElementById('tabs');
  box.innerHTML = tabs.map(tab => `
    <div class="tab ${tab.id === activeTabId ? 'active' : ''}" data-id="${tab.id}"
         onclick="switchTab('${tab.id}')" onauxclick="if(event.button===1){event.preventDefault();closeTab('${tab.id}')}"
         title="${escapeHtml(tab.path === DRIVE_VIEW ? '此电脑' : tab.path)}">
      <svg class="gi"><use href="#${tab.view === 'drives' ? 'i-monitor' : 'i-folder-line'}"/></svg>
      <span class="tab-title">${escapeHtml(tab.title)}</span>
      <button class="tab-close" onclick="event.stopPropagation();closeTab('${tab.id}')" title="关闭标签页">
        <svg class="gi"><use href="#i-close"/></svg>
      </button>
    </div>`).join('');
}

function persistTabs() {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({
      activeTabId,
      tabs: tabs.map(t => ({ id: t.id, title: t.title, view: t.view, path: t.path, history: t.history, hIndex: t.hIndex }))
    }));
  } catch { /* 忽略存储失败 */ }
}

function restoreTabs() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(TABS_KEY) || 'null'); } catch { saved = null; }
  if (!saved || !Array.isArray(saved.tabs) || saved.tabs.length === 0) return false;

  tabs = saved.tabs.map(t => ({
    id: t.id || 'tab' + (++tabSeq),
    title: t.title || '此电脑',
    view: t.view === 'files' ? 'files' : 'drives',
    path: t.path || DRIVE_VIEW,
    history: Array.isArray(t.history) ? t.history : [],
    hIndex: typeof t.hIndex === 'number' ? t.hIndex : (Array.isArray(t.history) ? t.history.length - 1 : -1)
  }));
  activeTabId = tabs.some(t => t.id === saved.activeTabId) ? saved.activeTabId : tabs[0].id;
  renderTabs();
  return true;
}

function addTab() {
  const fromPath = (currentView === 'files' && currentPath) ? currentPath : null;
  if (fromPath) addTabWith(fromPath);
  else {
    const tab = createTab();
    activeTabId = tab.id;
    renderTabs();
    openThisPC(false);
  }
}

function addTabWith(path) {
  syncTab();
  const tab = createTab();
  activeTabId = tab.id;
  renderTabs();
  loadDirectory(path).then(ok => { if (!ok) openThisPC(true); });
}

function switchTab(id) {
  if (id === activeTabId) return;
  syncTab();
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  activeTabId = id;
  renderTabs();
  persistTabs();
  closeMenu();
  if (tab.view === 'drives') openThisPC(false);
  else loadDirectory(tab.path, { replace: true });
}

function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;
  tabs.splice(index, 1);

  if (!tabs.length) {
    const tab = createTab();
    activeTabId = tab.id;
    openThisPC(false);
    return;
  }

  if (activeTabId === id) {
    const next = tabs[Math.min(index, tabs.length - 1)];
    activeTabId = next.id;
    renderTabs();
    if (next.view === 'drives') openThisPC(false);
    else loadDirectory(next.path, { replace: true });
  } else {
    renderTabs();
    persistTabs();
  }
}

// =========================================================
// 窗口：紧凑模式 / 全屏
// =========================================================
function initCompact() {
  document.body.classList.toggle('compact', localStorage.getItem(COMPACT_KEY) === '1');
}

function toggleCompact() {
  const on = document.body.classList.toggle('compact');
  localStorage.setItem(COMPACT_KEY, on ? '1' : '0');
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen().catch(() => {});
}

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
}

function driveDisplayName(d) {
  const base = d.volumeName || d.typeName || '本地磁盘';
  return `${base} (${d.letter})`;
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
    const active = currentView === 'files' && currentPath.toUpperCase().startsWith(d.letter.toUpperCase());
    return `
      <div class="nav-item ${active ? 'active' : ''}" onclick="openDrive('${d.path.replace(/\\/g, '\\\\')}')" title="${escapeHtml(driveDisplayName(d))}">
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
    <div class="drive-card" data-path="${escapeHtml(d.path)}" data-kind="drive" onclick="openDrive('${d.path.replace(/\\/g, '\\\\')}')" title="${escapeHtml(d.typeName)}${d.fileSystem ? ' · ' + d.fileSystem : ''} · 已用 ${formatFileSize(d.used)} · 可用 ${formatFileSize(d.free)}">
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
  currentView = 'drives';
  currentPath = DRIVE_VIEW;
  currentDirData = null;
  entriesCache = [];
  selectedPath = null;
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
    selectedPath = null;

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
  if (currentView === 'drives') loadDrives();
  else loadDirectory(currentPath, { replace: true });
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
  const parent = currentPath.replace(/[\\/][^\\/]+$/, '');
  if (parent === currentPath || !parent || /^[a-zA-Z]:$/.test(parent)) {
    return /^[a-zA-Z]:$/.test(parent) ? openThisPC() : null;
  }
  loadDirectory(parent);
}

function renderBreadcrumbForDrives() {
  document.getElementById('breadcrumb').innerHTML = '<span class="current">此电脑</span>';
  document.getElementById('addr-ico').innerHTML = icon('monitor');
}

function renderBreadcrumb(fullPath) {
  const bc = document.getElementById('breadcrumb');
  document.getElementById('addr-ico').innerHTML = icon('folder-line');
  const parts = fullPath.split(/[\\/]/).filter(Boolean);
  if (!parts.length) { bc.innerHTML = `<span class="current">${escapeHtml(fullPath)}</span>`; return; }

  let html = '<a href="#" onclick="openThisPC();return false;">此电脑</a><span class="sep">›</span>';
  let accum = '';
  parts.forEach((part, i) => {
    if (i === 0 && /^[a-zA-Z]:$/.test(part)) accum = part + '\\';
    else accum = accum ? accum.replace(/\\$/, '') + '\\' + part : part;

    if (i === parts.length - 1) {
      html += `<span class="current">${escapeHtml(part)}</span>`;
    } else {
      html += `<a href="#" onclick="loadDirectory('${accum.replace(/\\/g, '\\\\')}');return false;">${escapeHtml(part)}</a><span class="sep">›</span>`;
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
  updateStatus();
}

function sortSimple(list) {
  const mul = sortOrder === 'desc' ? -1 : 1;
  return [...(list || [])].sort((a, b) => {
    if (sortBy === 'name') return collator.compare(a.name, b.name) * mul;
    if (sortBy === 'time') return ((a.mtime || 0) - (b.mtime || 0)) * mul;
    if (sortBy === 'size') return ((a.size || 0) - (b.size || 0)) * mul;
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
      <div class="col col-name"><span class="ico">${entryIconHtml(entry)}</span><span class="nm">${escapeHtml(entry.name)}</span></div>
      <div class="col col-time">${formatDate(entry.mtime)}</div>
      <div class="col col-type">${escapeHtml(entryTypeName(entry))}</div>
      <div class="col col-size">${entry.kind === 'folder' ? '' : formatFileSize(entry.size)}</div>`;
    row.addEventListener('click', () => selectRow(entry, row));
    row.addEventListener('dblclick', () => openEntry(entry));
    frag.appendChild(row);
  });

  body.appendChild(frag);
  body.querySelectorAll('img[data-src]').forEach(img => lazyLoadImage(img));
}

function selectRow(entry, row) {
  selectedPath = entry.path;
  highlightRow(row);
  updateStatus();
  if (isTouch && Date.now() > suppressClickUntil) openEntry(entry);
}

function moveSelection(delta) {
  const rows = [...document.querySelectorAll('.d-row')];
  if (!rows.length) return;
  let idx = rows.findIndex(r => r.dataset.path === selectedPath);
  idx = idx === -1 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, idx + delta));
  const row = rows[idx];
  const entry = entriesCache.find(e => e.path === row.dataset.path);
  if (!entry) return;
  selectRow(entry, row);
  row.scrollIntoView({ block: 'nearest' });
}

// =========================================================
// 打开条目
// =========================================================
function openEntry(entry) {
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
    <div class="folder-item" data-path="${escapeHtml(f.path)}" data-kind="folder" onclick="loadDirectory('${f.path.replace(/\\/g, '\\\\')}')">
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
    <div class="media-item" data-path="${escapeHtml(img.path)}" data-kind="image" onclick="openImage(${index})" title="${escapeHtml(img.name)}">
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
    <div class="media-item" data-path="${escapeHtml(v.path)}" data-kind="video" onclick="openVideo(${index})" title="${escapeHtml(v.name)}">
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
         ondblclick="openFile('${f.path.replace(/\\/g, '\\\\')}')" onclick="selectOther(this,'${f.path.replace(/\\/g, '\\\\')}')">
      <div class="other-icon">${fileIconHtml(f.name)}</div>
      <div class="other-info">
        <div class="other-name">${escapeHtml(f.name)}</div>
        <div class="other-size">${formatDate(f.mtime)} · ${formatFileSize(f.size)}</div>
      </div>
      <a class="other-download" href="/api/file?path=${encodeURIComponent(f.path)}&download=1" onclick="event.stopPropagation()" title="下载">${icon('download')}</a>
    </div>`).join('');
}

function selectOther(el, path) {
  selectedPath = path;
  document.querySelectorAll('.other-item.selected').forEach(x => x.classList.remove('selected'));
  el.classList.add('selected');
  updateStatus();
  if (isTouch) openFile(path);
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
  if (selectedPath) {
    const sel = entriesCache.find(e => e.path === selectedPath);
    left.textContent = sel ? `已选择 1 个项目：${sel.name}` : `已选择 1 个项目`;
  } else {
    left.textContent = `共 ${count} 个项目${folders ? `（${folders} 个文件夹）` : ''}`;
  }

  const drive = drivesData.find(d => currentPath.toUpperCase().startsWith(d.letter.toUpperCase()));
  right.textContent = drive ? `${drive.letter} ${formatFileSize(drive.free)} 可用，共 ${formatFileSize(drive.total)}` : '';
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

// =========================================================
// 收藏夹
// =========================================================
function toggleFavorites() {
  const panel = document.getElementById('favorites-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) loadFavorites();
}

async function loadFavorites() {
  try {
    const res = await fetch('/api/favorites');
    const list = await res.json();
    renderFavorites(list);
    renderNavFavorites(list);
  } catch (err) { console.error('加载收藏夹失败:', err); }
}

function renderFavorites(list) {
  const container = document.getElementById('favorites-list');
  if (!list.length) {
    container.innerHTML = '<div class="nav-empty" style="text-align:center;padding:32px 12px">暂无收藏目录</div>';
    return;
  }
  container.innerHTML = '';
  list.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'favorite-item';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'favorite-name';
    nameDiv.textContent = item.name;
    nameDiv.title = item.path;
    nameDiv.addEventListener('click', () => { loadDirectory(item.path); toggleFavorites(); });
    const delSpan = document.createElement('span');
    delSpan.className = 'favorite-delete';
    delSpan.innerHTML = icon('close');
    delSpan.addEventListener('click', (e) => deleteFavorite(i, e));
    div.append(nameDiv, delSpan);
    container.appendChild(div);
  });
}

function renderNavFavorites(list) {
  const box = document.getElementById('nav-favorites');
  const items = list || window.__favoritesCache || [];
  window.__favoritesCache = items;
  if (!items.length) {
    box.innerHTML = '<div class="nav-empty">暂无收藏，可在 ⋯ 菜单中添加</div>';
    return;
  }
  box.innerHTML = items.map((item, i) => `
    <div class="nav-item" onclick="loadDirectory('${item.path.replace(/\\/g, '\\\\')}')" title="${escapeHtml(item.path)}">
      <span class="nav-ico">${icon('star')}</span>
      <span class="nav-text">${escapeHtml(item.name)}</span>
      <span class="nav-del" onclick="event.stopPropagation();deleteFavorite(${i}, event)" title="移除">${icon('close')}</span>
    </div>`).join('');
}

async function addCurrentToFavorites() {
  if (currentView !== 'files' || !currentPath) return alert('请先打开一个文件夹');
  try {
    const res = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath })
    });
    if (!res.ok) { const err = await res.json(); return alert(err.error || '添加失败'); }
    loadFavorites();
  } catch (err) { alert('添加失败: ' + err.message); }
}

async function deleteFavorite(index, event) {
  event.stopPropagation();
  if (!confirm('确定删除此收藏？')) return;
  try { await fetch(`/api/favorites/${index}`, { method: 'DELETE' }); loadFavorites(); }
  catch { alert('删除失败'); }
}

// =========================================================
// 新建文件夹 / 上传 / 打包下载
// =========================================================
async function newFolder() {
  if (currentView !== 'files') return alert('请先进入某个文件夹');
  const name = prompt('新建文件夹名称：', '新建文件夹');
  if (!name || !name.trim()) return;
  try {
    const res = await fetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath, name: name.trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || '创建失败');
    refreshView();
  } catch (err) { alert('创建失败: ' + err.message); }
}

let pendingFiles = [];

function triggerUpload() { document.getElementById('file-upload').click(); }

function handleFileSelect(files) {
  if (!files || !files.length) return;
  if (currentView !== 'files') { alert('请先进入一个文件夹再上传'); return; }
  pendingFiles = Array.from(files);
  showUploadPanel();
  document.getElementById('file-upload').value = '';
}

function showUploadPanel() {
  const panel = document.getElementById('upload-panel');
  const list = document.getElementById('upload-file-list');
  document.getElementById('upload-progress-container').style.display = 'none';
  const confirmBtn = document.getElementById('upload-confirm-btn');
  confirmBtn.disabled = false;
  confirmBtn.textContent = '开始上传';
  list.innerHTML = pendingFiles.map((f, i) => `
    <div class="upload-file-item">
      <span class="upload-file-icon">${fileIconHtml(f.name)}</span>
      <div class="upload-file-info">
        <div class="upload-file-name">${escapeHtml(f.name)}</div>
        <div class="upload-file-size">${formatFileSize(f.size)}</div>
      </div>
      <span class="upload-file-remove" onclick="removeUploadFile(${i})">×</span>
    </div>`).join('');
  panel.classList.add('open');
}

function removeUploadFile(index) {
  pendingFiles.splice(index, 1);
  pendingFiles.length === 0 ? closeUploadPanel() : showUploadPanel();
}

function closeUploadPanel() {
  document.getElementById('upload-panel').classList.remove('open');
  pendingFiles = [];
}

function confirmUpload() {
  if (!pendingFiles.length) return;
  const confirmBtn = document.getElementById('upload-confirm-btn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '上传中...';

  const formData = new FormData();
  pendingFiles.forEach(f => formData.append('files', f));

  const xhr = new XMLHttpRequest();
  const progressContainer = document.getElementById('upload-progress-container');
  const progressFill = document.getElementById('upload-progress-fill');
  const progressText = document.getElementById('upload-progress-text');
  progressContainer.style.display = 'flex';
  progressFill.style.width = '0%';
  progressText.textContent = '0%';

  xhr.upload.addEventListener('progress', (e) => {
    if (!e.lengthComputable) return;
    const percent = Math.round((e.loaded / e.total) * 100);
    progressFill.style.width = percent + '%';
    progressText.textContent = percent + '%';
  });

  xhr.addEventListener('load', () => {
    if (xhr.status === 200) {
      const data = JSON.parse(xhr.responseText);
      if (data.success) {
        progressText.textContent = '✓';
        setTimeout(() => { closeUploadPanel(); refreshView(); }, 600);
        return;
      }
    }
    progressText.textContent = '✗';
    confirmBtn.disabled = false;
    confirmBtn.textContent = '重试';
  });
  xhr.addEventListener('error', () => {
    progressText.textContent = '✗';
    confirmBtn.disabled = false;
    confirmBtn.textContent = '重试';
  });

  xhr.open('POST', `/api/upload?path=${encodeURIComponent(currentPath)}`);
  xhr.send(formData);
}

function initDragDrop() {
  const overlay = document.getElementById('drop-overlay');
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (currentView !== 'files') return;
    dragCounter++;
    if (dragCounter === 1) overlay.classList.add('active');
  });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; overlay.classList.remove('active'); }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('active');
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files);
  });
}

function downloadZip() {
  if (currentView !== 'files' || !currentPath) return alert('请先进入一个文件夹');
  if (!confirm('确定要打包下载整个目录吗？')) return;
  window.location.href = `/api/download/zip?path=${encodeURIComponent(currentPath)}`;
}

// =========================================================
// 图片查看器
// =========================================================
function openImage(index) {
  if (!imageList.length) return;
  currentImageIndex = index;
  updateImageViewer();
  preloadNeighbors();
  document.getElementById('image-viewer').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function updateImageViewer() {
  const img = imageList[currentImageIndex];
  if (!img) return;
  document.getElementById('viewer-img').src = '/api/file?path=' + encodeURIComponent(img.path);
  document.getElementById('viewer-name').textContent = img.name;
  document.getElementById('viewer-download').href = '/api/file?path=' + encodeURIComponent(img.path) + '&download=1';
  document.getElementById('image-counter').textContent = `${currentImageIndex + 1} / ${imageList.length}`;
}

function preloadNeighbors() {
  if (imageList.length < 2) return;
  const next = (currentImageIndex + 1) % imageList.length;
  const prev = (currentImageIndex - 1 + imageList.length) % imageList.length;
  [prev, next].forEach(i => {
    const item = imageList[i];
    if (item && !preloadCache[item.path]) {
      new Image().src = '/api/file?path=' + encodeURIComponent(item.path);
      preloadCache[item.path] = true;
    }
  });
}

function prevImage() {
  if (imageList.length <= 1) return;
  currentImageIndex = (currentImageIndex - 1 + imageList.length) % imageList.length;
  updateImageViewer(); preloadNeighbors(); resetSlideshow();
}

function nextImage() {
  if (imageList.length <= 1) return;
  currentImageIndex = (currentImageIndex + 1) % imageList.length;
  updateImageViewer(); preloadNeighbors(); resetSlideshow();
}

function closeImageViewer() {
  document.getElementById('image-viewer').classList.remove('active');
  document.body.style.overflow = '';
  stopSlideshow();
}

// 幻灯片
function toggleSlideshow() { slideshowActive ? stopSlideshow() : startSlideshow(); }

function startSlideshow() {
  slideshowActive = true;
  document.getElementById('slideshow-btn').textContent = '⏸ 暂停';
  slideshowTimer = setInterval(nextImage, slideshowSpeed);
}

function stopSlideshow() {
  slideshowActive = false;
  document.getElementById('slideshow-btn').textContent = '▶ 自动播放';
  if (slideshowTimer) { clearInterval(slideshowTimer); slideshowTimer = null; }
}

function resetSlideshow() {
  if (slideshowActive) { clearInterval(slideshowTimer); slideshowTimer = setInterval(nextImage, slideshowSpeed); }
}

function changeSlideshowSpeed() {
  slideshowSpeed = parseInt(document.getElementById('slideshow-speed').value);
  if (slideshowActive) { clearInterval(slideshowTimer); slideshowTimer = setInterval(nextImage, slideshowSpeed); }
}

// =========================================================
// 视频
// =========================================================
function openVideo(index) {
  if (!videoList.length) return;
  currentVideoIndex = index;
  updateVideoViewer();
  document.getElementById('video-viewer').classList.add('active');
  document.getElementById('viewer-video').play().catch(() => {});
  document.body.style.overflow = 'hidden';
}

function updateVideoViewer() {
  const v = videoList[currentVideoIndex];
  if (!v) return;
  const video = document.getElementById('viewer-video');
  video.src = '/api/file?path=' + encodeURIComponent(v.path);
  video.playbackRate = parseFloat(document.getElementById('video-speed').value);
  document.getElementById('video-name').textContent = v.name;
  document.getElementById('video-download').href = '/api/file?path=' + encodeURIComponent(v.path) + '&download=1';
  document.getElementById('video-counter').textContent = `${currentVideoIndex + 1} / ${videoList.length}`;
}

function prevVideo() {
  if (videoList.length <= 1) return;
  currentVideoIndex = (currentVideoIndex - 1 + videoList.length) % videoList.length;
  updateVideoViewer();
  document.getElementById('viewer-video').play().catch(() => {});
}

function nextVideo() {
  if (videoList.length <= 1) return;
  currentVideoIndex = (currentVideoIndex + 1) % videoList.length;
  updateVideoViewer();
  document.getElementById('viewer-video').play().catch(() => {});
}

function closeVideoViewer() {
  document.getElementById('video-viewer').classList.remove('active');
  const video = document.getElementById('viewer-video');
  video.pause(); video.src = '';
  document.body.style.overflow = '';
}

function changeVideoSpeed() {
  document.getElementById('viewer-video').playbackRate = parseFloat(document.getElementById('video-speed').value);
}

// =========================================================
// PDF
// =========================================================
function openPdfViewer(filePath) {
  document.getElementById('pdf-name').textContent = filePath.split(/[\\/]/).pop();
  document.getElementById('pdf-download').href = '/api/file?path=' + encodeURIComponent(filePath) + '&download=1';
  document.getElementById('pdf-frame').src = '/api/file?path=' + encodeURIComponent(filePath);
  document.getElementById('pdf-viewer').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closePdfViewer() {
  document.getElementById('pdf-viewer').classList.remove('active');
  document.getElementById('pdf-frame').src = '';
  document.body.style.overflow = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function togglePdfFullscreen() {
  if (!document.fullscreenElement) document.getElementById('pdf-viewer').requestFullscreen().catch(() => {});
  else document.exitFullscreen().catch(() => {});
}

// =========================================================
// 备忘录
// =========================================================
let currentMemoId = null;
let selectedMemoColor = '#0078d4';
let memoDataCache = [];

function openMemoPanel() {
  document.getElementById('memo-panel').classList.add('open');
  loadMemos();
}
function closeMemoPanel() {
  document.getElementById('memo-panel').classList.remove('open');
}

async function loadMemos() {
  try {
    const res = await fetch('/api/lifezone/memos');
    memoDataCache = await res.json();
    renderMemos(memoDataCache);
  } catch (err) { console.error('加载备忘录失败:', err); }
}

function renderMemos(memos) {
  const list = document.getElementById('memo-list');
  if (!memos.length) { list.innerHTML = '<div class="memo-empty">暂无备忘录</div>'; return; }
  list.innerHTML = memos.map(memo => `
    <div class="memo-item ${memo.pinned ? 'pinned' : ''}" style="border-left-color: ${escapeHtml(memo.color)}" data-id="${memo.id}">
      ${memo.title ? `<div class="memo-item-title">${escapeHtml(memo.title)}</div>` : ''}
      <div class="memo-item-content">${escapeHtml(memo.content).replace(/\n/g, '<br>')}</div>
      <div class="memo-item-time">${formatTime(memo.updatedAt)}</div>
      <div class="memo-item-actions">
        <button class="memo-item-btn" onclick="editMemo('${memo.id}')">编辑</button>
        <button class="memo-item-btn" onclick="togglePinMemo('${memo.id}', ${!memo.pinned})">${memo.pinned ? '取消置顶' : '置顶'}</button>
        <button class="memo-item-btn delete" onclick="deleteMemo('${memo.id}')">删除</button>
      </div>
    </div>`).join('');
}

function formatTime(iso) {
  const d = new Date(iso), now = new Date(), diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return d.toLocaleDateString('zh-CN');
}

function showMemoEditor(id) {
  currentMemoId = id || null;
  const overlay = document.getElementById('memo-editor-overlay');
  const titleInput = document.getElementById('memo-title-input');
  const contentInput = document.getElementById('memo-content-input');

  if (id) {
    document.getElementById('memo-editor-title').textContent = '编辑备忘录';
    const memo = memoDataCache.find(m => m.id === id);
    if (memo) {
      titleInput.value = memo.title || '';
      contentInput.value = memo.content || '';
      selectedMemoColor = memo.color || '#0078d4';
    }
  } else {
    document.getElementById('memo-editor-title').textContent = '新建备忘录';
    titleInput.value = '';
    contentInput.value = '';
    selectedMemoColor = '#0078d4';
  }

  document.querySelectorAll('.memo-color-dot').forEach(d => {
    d.classList.toggle('selected', rgbToHex(d.style.background) === selectedMemoColor.toLowerCase());
  });

  overlay.classList.add('active');
  titleInput.focus();
}

function closeMemoEditor() {
  document.getElementById('memo-editor-overlay').classList.remove('active');
  currentMemoId = null;
}

function rgbToHex(rgb) {
  if (!rgb) return '';
  if (rgb.startsWith('#')) return rgb.toLowerCase();
  const match = rgb.match(/\d+/g);
  if (!match) return rgb;
  return '#' + match.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
}

function selectMemoColor(color, el) {
  selectedMemoColor = color;
  document.querySelectorAll('.memo-color-dot').forEach(d => d.classList.remove('selected'));
  if (el) el.classList.add('selected');
}

async function saveMemo() {
  const title = document.getElementById('memo-title-input').value.trim();
  const content = document.getElementById('memo-content-input').value.trim();
  if (!title && !content) return alert('请输入内容');
  const data = { title, content, color: selectedMemoColor };
  try {
    if (currentMemoId) {
      await fetch(`/api/lifezone/memos/${currentMemoId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    } else {
      await fetch('/api/lifezone/memos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    }
    closeMemoEditor();
    loadMemos();
  } catch (err) { alert('保存失败: ' + err.message); }
}

function editMemo(id) { showMemoEditor(id); }

async function togglePinMemo(id, pinned) {
  try {
    await fetch(`/api/lifezone/memos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned }) });
    loadMemos();
  } catch { alert('操作失败'); }
}

async function deleteMemo(id) {
  if (!confirm('确定删除此备忘录？')) return;
  try { await fetch(`/api/lifezone/memos/${id}`, { method: 'DELETE' }); loadMemos(); }
  catch { alert('删除失败'); }
}

// =========================================================
// 右键 / 长按 上下文菜单
// =========================================================
let suppressClickUntil = 0;
let ctxItems = [];

function resolveContextFromEvent(target) {
  const el = target.closest('[data-path]');
  if (!el) return { kind: 'background' };

  const p = el.dataset.path;
  const entry = entriesCache.find(x => x.path === p);
  if (entry) return { kind: entry.kind, entry };

  const drive = drivesData.find(d => d.path === p);
  if (drive) return { kind: 'drive', drive };

  const kind = el.dataset.kind || 'file';
  const name = String(p).split(/[\\/]/).filter(Boolean).pop() || p;
  return { kind, entry: { path: p, name, kind } };
}

function findRowEl(path) {
  let found = null;
  document.querySelectorAll('.d-row').forEach(r => { if (r.dataset.path === path) found = r; });
  return found;
}

function highlightRow(row) {
  document.querySelectorAll('.d-row.selected').forEach(el => el.classList.remove('selected'));
  if (row) row.classList.add('selected');
}

function buildContextItems(ctx) {
  if (ctx.kind === 'background') {
    if (currentView !== 'files') {
      return [
        { icon: 'refresh', label: '刷新', hint: 'F5', run: refreshView },
        { icon: 'monitor', label: '此电脑', run: () => openThisPC() }
      ];
    }
    const here = { kind: 'folder', name: currentPath.split(/[\\/]/).filter(Boolean).pop() || currentPath, path: currentPath };
    return [
      { icon: 'upload', label: '上传到此处', run: triggerUpload },
      { icon: 'folder-plus', label: '新建文件夹', run: newFolder },
      { sep: true },
      { icon: 'package', label: '打包下载当前文件夹', run: downloadZip },
      { icon: 'refresh', label: '刷新', hint: 'F5', run: refreshView },
      { icon: 'save', label: '保存为默认路径', run: saveDefaultPath },
      { sep: true },
      { icon: 'info', label: '当前文件夹属性', run: () => showProperties(here) }
    ];
  }

  if (ctx.kind === 'drive') {
    const d = ctx.drive;
    return [
      { icon: 'folder-line', label: '打开', hint: 'Enter', run: () => openDrive(d.path) },
      { sep: true },
      { icon: 'info', label: '属性', run: () => showDriveProperties(d) }
    ];
  }

  const entry = ctx.entry;
  const isDir = entry.kind === 'folder';
  const items = [];

  items.push({ icon: isDir ? 'folder-line' : 'open-new', label: '打开', hint: 'Enter', run: () => openEntry(entry) });
  items.push({ icon: 'open-new', label: '在新标签页中打开', run: () => openEntryNewTab(entry) });
  if (isDir) items.push({ icon: 'package', label: '打包下载', run: () => zipFolder(entry.path) });
  else items.push({ icon: 'download', label: '下载', run: () => downloadEntry(entry) });
  items.push({ sep: true });
  items.push({ icon: 'rename', label: '重命名', hint: 'F2', run: () => startInlineRename(entry) });
  items.push({ icon: 'trash', label: '删除', hint: 'Delete', danger: true, run: () => confirmDelete(entry) });
  items.push({ sep: true });
  items.push({ icon: 'copy', label: '复制路径', hint: 'Ctrl+Shift+C', run: () => copyPath(entry.path) });
  items.push({ icon: 'info', label: '属性', run: () => showProperties(entry) });
  return items;
}

function openContextMenu(x, y, ctx) {
  const menu = document.getElementById('ctx-menu');
  ctxItems = buildContextItems(ctx);

  const title = ctx.drive ? driveDisplayName(ctx.drive) : (ctx.entry ? ctx.entry.name : '');
  let html = title ? `<div class="ctx-head" title="${escapeHtml(title)}">${escapeHtml(title)}</div>` : '';
  html += ctxItems.map((it, i) => it.sep
    ? '<div class="ctx-sep"></div>'
    : `<div class="ctx-item ${it.danger ? 'danger' : ''}" data-idx="${i}">
         ${icon(it.icon)}<span class="ctx-label">${escapeHtml(it.label)}</span>
         ${it.hint ? `<span class="ctx-hint">${escapeHtml(it.hint)}</span>` : ''}
       </div>`).join('');

  menu.innerHTML = html;
  menu.classList.add('open');
  menu.setAttribute('aria-hidden', 'false');

  // 先量尺寸再定位，避免超出窗口
  menu.style.left = '0px';
  menu.style.top = '0px';
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 6)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 6)) + 'px';
}

function closeContextMenu() {
  const menu = document.getElementById('ctx-menu');
  if (!menu.classList.contains('open')) return;
  menu.classList.remove('open');
  menu.setAttribute('aria-hidden', 'true');
  menu.innerHTML = '';
  ctxItems = [];
}

function isContextMenuOpen() {
  return document.getElementById('ctx-menu').classList.contains('open');
}

function openContextMenuForSelection() {
  const entry = entriesCache.find(x => x.path === selectedPath);
  if (!entry) return;
  const row = findRowEl(entry.path);
  const rect = row ? row.getBoundingClientRect() : { left: 200, bottom: 200 };
  openContextMenu(rect.left + 20, rect.bottom, { kind: entry.kind, entry });
}

function initContextMenu() {
  const content = document.getElementById('content');
  const menu = document.getElementById('ctx-menu');

  content.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const ctx = resolveContextFromEvent(e.target);
    if (ctx.entry && ctx.kind !== 'drive') {
      const row = findRowEl(ctx.entry.path);
      if (row) { selectedPath = ctx.entry.path; highlightRow(row); updateStatus(); }
    }
    openContextMenu(e.clientX, e.clientY, ctx);
  });

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item) return;
    const action = ctxItems[Number(item.dataset.idx)];
    closeContextMenu();
    if (action && action.run) action.run();
  });

  document.addEventListener('click', (e) => { if (!e.target.closest('#ctx-menu')) closeContextMenu(); });
  document.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('resize', closeContextMenu);
  window.addEventListener('blur', closeContextMenu);

  // 手机：长按弹出同一套菜单
  let pressTimer = null;
  let pressPoint = null;
  content.addEventListener('touchstart', (e) => {
    const ctx = resolveContextFromEvent(e.target);
    if (ctx.kind === 'background') return;
    pressPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      suppressClickUntil = Date.now() + 800;
      if (ctx.entry && ctx.kind !== 'drive') {
        const row = findRowEl(ctx.entry.path);
        if (row) { selectedPath = ctx.entry.path; highlightRow(row); updateStatus(); }
      }
      openContextMenu(pressPoint.x, pressPoint.y, ctx);
    }, 480);
  }, { passive: true });

  ['touchend', 'touchmove', 'touchcancel'].forEach(ev =>
    content.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true }));

  // 长按后紧接着的那次点击不再触发打开
  content.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
      suppressClickUntil = 0;
    }
  }, true);
}

// =========================================================
// 对话框（删除确认 / 属性）
// =========================================================
let modalOnOk = null;

function initModal() {
  const overlay = document.getElementById('modal-overlay');
  const okBtn = document.getElementById('modal-ok');

  okBtn.addEventListener('click', async () => {
    const fn = modalOnOk;
    if (!fn) return closeModal();
    okBtn.disabled = true;
    try {
      const result = await fn();
      if (result !== false) closeModal();
    } finally {
      okBtn.disabled = false;
    }
  });

  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
}

function showModal(opts) {
  document.getElementById('modal-title').textContent = opts.title || '';
  document.getElementById('modal-body').innerHTML = opts.bodyHtml || '';

  const okBtn = document.getElementById('modal-ok');
  const cancelBtn = document.getElementById('modal-cancel');
  okBtn.textContent = opts.okText || '确定';
  okBtn.className = 'modal-btn ' + (opts.danger ? 'danger' : 'primary');
  cancelBtn.textContent = opts.cancelText || '取消';
  cancelBtn.style.display = opts.hideCancel ? 'none' : '';

  modalOnOk = opts.onOk || null;
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => okBtn.focus(), 30);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  modalOnOk = null;
}

function isModalOpen() {
  return document.getElementById('modal-overlay').classList.contains('open');
}

function propRows(rows) {
  return rows.map(([k, v]) => `<div class="prop-row"><span class="prop-key">${escapeHtml(k)}</span><span class="prop-val">${escapeHtml(v == null ? '—' : String(v))}</span></div>`).join('');
}

// =========================================================
// 文件操作：重命名 / 删除 / 属性 / 复制路径
// =========================================================
async function apiPost(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data = {};
    try { data = await res.json(); } catch { /* 空响应 */ }
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, data: { error: err.message } };
  }
}

async function renamePath(path, name) {
  const r = await apiPost('/api/rename', { path, name });
  return { ok: r.ok, error: r.data.error, path: r.data.path };
}

async function deletePaths(paths) {
  const r = await apiPost('/api/delete', { paths });
  return { ok: r.ok, error: r.data.error, failed: r.data.failed || [] };
}

function startInlineRename(entry) {
  closeContextMenu();
  const row = findRowEl(entry.path);
  if (!row) return promptRename(entry);

  const nameEl = row.querySelector('.nm');
  if (!nameEl) return promptRename(entry);

  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = entry.name;
  input.spellcheck = false;
  nameEl.replaceWith(input);
  input.focus();
  const dot = entry.kind === 'folder' ? -1 : entry.name.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : entry.name.length);

  let finished = false;
  const finish = async (commit) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (commit && value && value !== entry.name) {
      const r = await renamePath(entry.path, value);
      if (!r.ok) alert(r.error || '重命名失败');
      else selectedPath = r.path;
    }
    refreshView();
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
}

function promptRename(entry) {
  closeContextMenu();
  const next = prompt(`重命名「${entry.name}」为：`, entry.name);
  if (next === null) return;
  const value = next.trim();
  if (!value || value === entry.name) return;
  renamePath(entry.path, value).then(r => {
    if (!r.ok) alert(r.error || '重命名失败');
    else refreshView();
  });
}

function confirmDelete(entry) {
  closeContextMenu();
  const isDir = entry.kind === 'folder';
  showModal({
    title: '删除' + (isDir ? '文件夹' : '文件'),
    bodyHtml: `<div>确定要永久删除${isDir ? '文件夹' : '文件'} <strong>${escapeHtml(entry.name)}</strong> 吗？</div>
               <div style="margin-top:8px">${isDir ? '该文件夹内的全部内容都会被删除，' : ''}此操作无法撤销。</div>`,
    okText: '删除',
    danger: true,
    onOk: async () => {
      const r = await deletePaths([entry.path]);
      if (!r.ok) { alert(r.error || '删除失败'); return false; }
      selectedPath = null;
      refreshView();
    }
  });
}

function showProperties(entry) {
  closeContextMenu();
  const isDir = entry.kind === 'folder';
  const parent = entry.path.replace(/[\\/][^\\/]*$/, '') || entry.path;
  showModal({
    title: '属性',
    bodyHtml: propRows([
      ['名称', entry.name],
      ['类型', entryTypeName(entry)],
      ['位置', parent],
      ['大小', isDir ? '（文件夹）' : formatFileSize(entry.size)],
      ['修改时间', formatDate(entry.mtime)],
      ['完整路径', entry.path]
    ]),
    okText: '确定',
    hideCancel: true
  });
}

function showDriveProperties(d) {
  closeContextMenu();
  showModal({
    title: '驱动器属性',
    bodyHtml: propRows([
      ['名称', driveDisplayName(d)],
      ['类型', d.typeName],
      ['文件系统', d.fileSystem || '—'],
      ['总容量', formatFileSize(d.total)],
      ['已用空间', `${formatFileSize(d.used)}（${d.usedPercent}%）`],
      ['可用空间', formatFileSize(d.free)]
    ]),
    okText: '确定',
    hideCancel: true
  });
}

async function copyPath(p) {
  closeContextMenu();
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(p);
      ok = true;
    }
  } catch { ok = false; }

  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = p;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    } catch { ok = false; }
  }

  const left = document.getElementById('status-left');
  const old = left.textContent;
  left.textContent = ok ? `已复制路径：${p}` : `复制失败，路径：${p}`;
  setTimeout(() => { if (left.textContent !== old) updateStatus(); }, 2500);
}

function openEntryNewTab(entry) {
  closeContextMenu();
  if (entry.kind === 'folder') addTabWith(entry.path);
  else window.open('/api/file?path=' + encodeURIComponent(entry.path), '_blank');
}

function downloadEntry(entry) {
  closeContextMenu();
  const a = document.createElement('a');
  a.href = '/api/file?path=' + encodeURIComponent(entry.path) + '&download=1';
  a.download = entry.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function zipFolder(p) {
  closeContextMenu();
  window.location.href = '/api/download/zip?path=' + encodeURIComponent(p);
}

// =========================================================
// 工具
// =========================================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
