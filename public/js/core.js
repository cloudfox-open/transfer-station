/* 文件中转站 — 核心：状态、启动、快捷键、主题、标签页 */
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
const SEARCH_SUB_KEY = 'search-subfolders';
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
let searchMode = false;
let searchRecursive = localStorage.getItem(SEARCH_SUB_KEY) === '1';

// 手机端：选择模式（点条目 = 勾选）
let selectionMode = false;

let slideshowTimer = null;
let slideshowSpeed = 5000;
let slideshowActive = false;

let preloadCache = {};
let lazyObserver = null;

// 多选：selectedPaths 保持点击顺序，最后一个算「主选项」
let selectedPaths = [];
let selectionAnchor = null;    // Shift 连选的锚点

// 剪贴板：只做「剪切 / 粘贴」（移动）
let clipboard = null;          // { op: 'cut' | 'copy', paths: [...] }
let statusTimer = null;
let undoState = { canUndo: false, label: '' };

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
  initBackground();
  initLazyLoad();
  initDragDrop();
  initCompact();
  initContextMenu();
  initModal();
  applyViewMode();
  updateSortIndicators();
  loadDrives();
  loadUndoState();

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
  document.getElementById('search-input').addEventListener('input', onSearchInput);
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; onSearchInput(); }
  });
  // 恢复「搜索子目录」开关
  const subBtn = document.getElementById('search-sub-btn');
  if (subBtn) subBtn.classList.toggle('active', searchRecursive);

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
  const cmpViewer = document.getElementById('cmp-viewer');
  const editing = document.getElementById('address-bar').classList.contains('editing');
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

  // 对比媒体查看器在最上层，先处理它的键盘
  if (cmpViewer && cmpViewer.classList.contains('active')) {
    if (e.key === 'ArrowLeft') prevCompareMedia();
    else if (e.key === 'ArrowRight') nextCompareMedia();
    else if (e.key === 'Escape') closeCompareViewer();
    return;
  }

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
    const items = selectedEntries();
    if (items.length) { e.preventDefault(); copySelectionPaths(items); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    selectAllEntries();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undoLast();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
    if (selectedPaths.length) { e.preventDefault(); copySelection(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'x' || e.key === 'X')) {
    if (selectedPaths.length) { e.preventDefault(); cutSelection(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
    if (clipboard && currentView === 'files' && currentPath) {
      e.preventDefault();
      pasteInto(currentPath);
    }
    return;
  }
  if (e.key === 'Escape') {
    if (searchMode) { exitSearch(); return; }
    if (selectionMode) { exitSelectionMode(); return; }
    if (clipboard) { clearClipboard(); return; }
    if (selectedPaths.length) { clearSelection(); return; }
  }
  if (e.key === 'F5') { e.preventDefault(); refreshView(); return; }
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault();
    openContextMenuForSelection();
    return;
  }
  if (selectedPaths.length) {
    if (e.key === 'F2' && selectedPaths.length === 1) {
      e.preventDefault();
      const entry = entriesCache.find(x => samePath(x.path, selectedPaths[0]));
      if (entry) return startInlineRename(entry);
    }
    if (e.key === 'Delete') { e.preventDefault(); confirmDeleteSelection(); return; }
  }

  if (viewMode === 'details' && currentView === 'files') {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
    } else if (e.key === 'Enter') {
      const entry = entriesCache.find(x => samePath(x.path, primarySelectedPath()));
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
// 自定义界面背景（上传到服务端，所有设备共用）
// =========================================================
let bgVersion = 0;

function bgUrl(version) {
  return version ? `/api/background?v=${version}` : '';
}

function initBackground() {
  // 清掉旧版本存在浏览器里的背景，统一改走服务端
  try { localStorage.removeItem('bg-image'); } catch { /* 忽略 */ }

  fetch('/api/background/meta')
    .then(r => (r.ok ? r.json() : { exists: false }))
    .then(meta => {
      bgVersion = meta && meta.exists ? meta.version : 0;
      applyBackground(bgVersion);
    })
    .catch(() => applyBackground(0));
}

function applyBackground(version) {
  const root = document.documentElement;
  if (version) {
    document.body.classList.add('has-bg');
    root.style.setProperty('--bg-image', `url("${bgUrl(version)}")`);
  } else {
    document.body.classList.remove('has-bg');
    root.style.removeProperty('--bg-image');
  }
}

function openBackgroundDialog() {
  showModal({
    title: '界面背景',
    wide: true,
    okText: '关闭',
    hideCancel: true,
    bodyHtml: `
      <div class="bg-dialog">
        <div class="bg-preview" id="bg-preview"></div>
        <div class="bg-actions">
          <button class="modal-btn primary" onclick="chooseBackground()">选择图片</button>
          <button class="modal-btn" onclick="removeBackground()">恢复默认</button>
        </div>
        <div class="bg-hint">图片会上传到服务器（<code>.data/background.jpg</code>）并压缩到最长边 1920px，所有设备共用；深色模式会自动加暗色蒙层。</div>
      </div>`
  });
  updateBackgroundPreview(bgVersion);
}

function chooseBackground() {
  const input = document.getElementById('bg-input');
  if (input) input.click();
}

async function handleBackgroundFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (!/^image\//.test(file.type)) return alert('请选择图片文件');

  const form = new FormData();
  form.append('image', file, file.name);

  try {
    const res = await fetch('/api/background', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '上传失败');

    bgVersion = data.version || Date.now();
    applyBackground(bgVersion);
    updateBackgroundPreview(bgVersion);
    flashStatus('背景图已保存到服务器');
  } catch (err) {
    alert('设置背景失败：' + err.message);
  }
}

async function removeBackground() {
  try { await fetch('/api/background', { method: 'DELETE' }); } catch { /* 忽略 */ }
  bgVersion = 0;
  applyBackground(0);
  updateBackgroundPreview(0);
  flashStatus('已恢复默认背景');
}

function updateBackgroundPreview(version) {
  const preview = document.getElementById('bg-preview');
  if (!preview) return;
  preview.classList.toggle('has', !!version);
  preview.style.backgroundImage = version ? `url("${bgUrl(version)}")` : '';
}

// =========================================================
// 菜单 / 导航窗格
// =========================================================
function toggleMenu() {
  const btn = document.getElementById('fab-btn');
  const menu = document.getElementById('fab-menu');
  if (!btn || !menu) return;

  const open = !menu.classList.contains('open');
  btn.classList.toggle('active', open);
  menu.classList.toggle('open', open);
  if (!open) return;

  // 命令栏是 overflow-x:auto，会裁剪绝对定位子元素，所以打开时把菜单挂到 body 上
  if (menu.parentElement !== document.body) document.body.appendChild(menu);

  const r = btn.getBoundingClientRect();
  menu.style.top = Math.round(r.bottom + 4) + 'px';
  menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
  menu.style.left = 'auto';
}
function closeMenu() {
  const btn = document.getElementById('fab-btn');
  const menu = document.getElementById('fab-menu');
  if (btn) btn.classList.remove('active');
  if (menu) menu.classList.remove('open');
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

