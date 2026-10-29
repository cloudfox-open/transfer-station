/* 文件中转站 — 面板：收藏夹、备忘录、生活区照片、操作日志、空间清理 */
// =========================================================
// 收藏夹
// =========================================================
function toggleFavorites() {
  const panel = document.getElementById('favorites-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    document.getElementById('trash-panel').classList.remove('open');
    document.getElementById('memo-panel').classList.remove('open');
    document.getElementById('photos-panel').classList.remove('open');
    document.getElementById('log-panel').classList.remove('open');
    document.getElementById('clean-panel').classList.remove('open');
    loadFavorites();
  }
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
    <div class="nav-item" onclick="loadDirectory('${jsStr(item.path)}')" title="${escapeHtml(item.path)}">
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
// 备忘录
// =========================================================
let currentMemoId = null;
let selectedMemoColor = '#0078d4';
let memoDataCache = [];

function openMemoPanel() {
  document.getElementById('trash-panel').classList.remove('open');
  document.getElementById('favorites-panel').classList.remove('open');
  document.getElementById('photos-panel').classList.remove('open');
  document.getElementById('log-panel').classList.remove('open');
  document.getElementById('clean-panel').classList.remove('open');
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
// 生活区照片
// =========================================================
let photoCache = [];
let photoListBackup = null;

function openPhotosPanel() {
  document.getElementById('trash-panel').classList.remove('open');
  document.getElementById('favorites-panel').classList.remove('open');
  document.getElementById('memo-panel').classList.remove('open');
  document.getElementById('log-panel').classList.remove('open');
  document.getElementById('clean-panel').classList.remove('open');
  document.getElementById('photos-panel').classList.add('open');
  loadPhotos();
}

function closePhotosPanel() {
  document.getElementById('photos-panel').classList.remove('open');
}

async function loadPhotos() {
  const grid = document.getElementById('photo-grid');
  try {
    const res = await fetch('/api/lifezone/photos');
    if (!res.ok) throw new Error('读取失败');
    photoCache = await res.json();
    renderPhotos(photoCache);
  } catch (err) {
    if (grid) grid.innerHTML = '<div class="memo-empty">照片加载失败</div>';
  }
}

function renderPhotos(list) {
  const grid = document.getElementById('photo-grid');
  if (!grid) return;
  if (!list.length) {
    grid.innerHTML = '<div class="memo-empty">还没有照片，点下面按钮上传</div>';
    return;
  }
  grid.innerHTML = list.map((p, i) => `
    <div class="photo-item" title="${escapeHtml(p.name)}">
      <img data-src="/api/thumbnail/image?path=${encodeURIComponent(p.path)}" alt="${escapeHtml(p.name)}" onclick="openPhotoViewer(${i})">
      <button class="photo-del" onclick="event.stopPropagation();deletePhoto('${jsStr(p.id)}')" title="删除">×</button>
    </div>`).join('');
  grid.querySelectorAll('img[data-src]').forEach(img => lazyLoadImage(img));
}

// 借用图片查看器浏览照片；先记下当前目录的图片列表，查看器关闭时还原
function openPhotoViewer(index) {
  if (!photoCache.length) return;
  if (!photoListBackup) photoListBackup = { list: imageList, index: currentImageIndex };
  imageList = photoCache.map(p => ({ name: p.name, path: p.path }));
  openImage(index);
}

function triggerPhotoUpload() {
  document.getElementById('photo-upload').click();
}

async function handlePhotoSelect(files) {
  if (!files || !files.length) return;
  const form = new FormData();
  Array.from(files).forEach(f => form.append('photos', f, f.name));
  document.getElementById('photo-upload').value = '';

  flashStatus(`正在上传 ${files.length} 张照片…`);
  try {
    const res = await fetch('/api/lifezone/photos', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || '上传失败');
    flashStatus(`已上传 ${data.count || files.length} 张照片`);
    loadPhotos();
  } catch (err) {
    alert('上传失败: ' + err.message);
  }
}

async function deletePhoto(id) {
  if (!confirm('确定删除这张照片？')) return;
  try {
    const res = await fetch('/api/lifezone/photos/' + encodeURIComponent(id), { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error || '删除失败');
    loadPhotos();
  } catch { alert('删除失败'); }
}


// =========================================================
// 操作日志
// =========================================================
function openLogPanel() {
  document.getElementById('trash-panel').classList.remove('open');
  document.getElementById('favorites-panel').classList.remove('open');
  document.getElementById('memo-panel').classList.remove('open');
  document.getElementById('photos-panel').classList.remove('open');
  document.getElementById('clean-panel').classList.remove('open');
  document.getElementById('log-panel').classList.add('open');
  loadOperationLogs();
}

function closeLogPanel() {
  document.getElementById('log-panel').classList.remove('open');
}

async function loadOperationLogs() {
  const box = document.getElementById('log-list');
  if (!box) return;
  box.innerHTML = '<div class="memo-empty">正在读取…</div>';
  try {
    const res = await fetch('/api/logs?limit=300');
    const data = await res.json();
    renderOperationLogs(data.entries || []);
  } catch {
    box.innerHTML = '<div class="memo-empty">日志读取失败</div>';
  }
}

function logTimeParts(at) {
  const d = new Date(at);
  const p = n => String(n).padStart(2, '0');
  return {
    day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  };
}

function renderOperationLogs(entries) {
  const box = document.getElementById('log-list');
  if (!box) return;
  if (!entries.length) {
    box.innerHTML = '<div class="memo-empty">还没有操作记录</div>';
    return;
  }

  let lastDay = '';
  box.innerHTML = entries.map(e => {
    const { day, time } = logTimeParts(e.at);
    const head = day !== lastDay ? `<div class="log-day">${day}</div>` : '';
    lastDay = day;

    const statusText = e.status === 'partial' ? '部分失败' : (e.status === 'fail' ? '失败' : '');
    const statusClass = e.status === 'partial' ? 'partial' : (e.status === 'fail' ? 'fail' : '');
    const items = Array.isArray(e.items) ? e.items.filter(Boolean) : [];
    const paths = items.length
      ? `<div class="log-paths" title="${escapeHtml(items.join('\n'))}">${items.slice(0, 4).map(p => escapeHtml(p)).join('<br>')}${items.length > 4 ? `<br>…共 ${items.length} 项` : ''}</div>`
      : '';

    return `${head}
      <div class="log-item ${statusClass}">
        <div class="log-line">
          <span class="log-time">${time}</span>
          <span class="log-action">${escapeHtml(e.action)}</span>
          <span class="log-detail">${escapeHtml(e.detail)}</span>
        </div>
        <div class="log-meta">${escapeHtml(e.ip || '')}${statusText ? ` · <b>${statusText}</b>` : ''}</div>
        ${paths}
      </div>`;
  }).join('');
}


// =========================================================
// 空间清理（大文件 / 重复文件扫描）
// =========================================================
let cleanScanId = null;
let cleanPollTimer = null;
let cleanScanning = false;

function openCleanPanel() {
  document.getElementById('trash-panel').classList.remove('open');
  document.getElementById('favorites-panel').classList.remove('open');
  document.getElementById('memo-panel').classList.remove('open');
  document.getElementById('photos-panel').classList.remove('open');
  document.getElementById('log-panel').classList.remove('open');
  document.getElementById('clean-panel').classList.add('open');

  updateCleanScope();
  setCleanStartLabel(cleanScanning ? '停止' : '开始扫描');
  if (cleanScanning) document.getElementById('clean-progress').style.display = 'flex';
}

function closeCleanPanel() {
  // 扫描继续在后台跑，重新打开面板能看到进度和结果
  document.getElementById('clean-panel').classList.remove('open');
}

function updateCleanScope() {
  const scope = document.getElementById('clean-scope');
  if (!scope) return;
  if (currentView === 'files' && currentPath) {
    const drive = driveForPath(currentPath);
    scope.textContent = `范围：${currentPath}` + (drive ? `（剩余 ${formatFileSize(drive.free)}）` : '');
  } else {
    scope.textContent = '请先进入一个文件夹再扫描';
  }
}

function setCleanStartLabel(text) {
  const btn = document.getElementById('clean-start-btn');
  if (btn) btn.textContent = text;
}

function onCleanModeChange() {
  const min = document.getElementById('clean-min');
  if (!min) return;
  min.value = document.getElementById('clean-mode').value === 'duplicate' ? '1' : '100';
}

function toggleCleanScan() {
  if (cleanScanning) stopCleanScan();
  else startCleanScan();
}

async function startCleanScan() {
  if (currentView !== 'files' || !currentPath) return alert('请先进入一个文件夹再扫描');

  const mode = document.getElementById('clean-mode').value;
  const minSizeMB = Number(document.getElementById('clean-min').value) || (mode === 'duplicate' ? 1 : 100);
  const list = document.getElementById('clean-list');
  const progress = document.getElementById('clean-progress');
  const progressText = document.getElementById('clean-progress-text');

  updateCleanScope();
  list.innerHTML = '';
  progress.style.display = 'flex';
  progressText.textContent = '正在创建扫描任务…';
  cleanScanning = true;
  setCleanStartLabel('停止');

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath, mode, minSizeMB })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '扫描失败');
    cleanScanId = data.id;
    pollCleanScan();
  } catch (err) {
    cleanScanning = false;
    cleanScanId = null;
    setCleanStartLabel('开始扫描');
    progress.style.display = 'none';
    list.innerHTML = `<div class="memo-empty">${escapeHtml(err.message)}</div>`;
  }
}

function pollCleanScan() {
  clearTimeout(cleanPollTimer);
  if (!cleanScanId) return;

  cleanPollTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/scan/' + encodeURIComponent(cleanScanId));
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || '读取扫描任务失败');

      if (job.state === 'running') {
        const text = document.getElementById('clean-progress-text');
        if (text) {
          text.textContent = `${job.phase} · 已扫描 ${job.scannedFiles} 个文件 / ${formatFileSize(job.scannedBytes)}`
            + (job.phase === '校验重复内容' ? ` · 已校验 ${job.hashedFiles} 个` : '');
        }
        pollCleanScan();
        return;
      }

      cleanScanning = false;
      cleanScanId = null;
      setCleanStartLabel('重新扫描');

      if (job.state !== 'done') {
        document.getElementById('clean-progress-text').textContent = job.state === 'cancelled' ? '已停止' : `扫描失败：${job.error || '未知错误'}`;
        setTimeout(() => { document.getElementById('clean-progress').style.display = 'none'; }, 1200);
        return;
      }

      document.getElementById('clean-progress').style.display = 'none';
      renderCleanResult(job);

      if (!document.getElementById('clean-panel').classList.contains('open')) {
        const r = job.result || {};
        flashStatus(job.mode === 'large'
          ? `扫描完成：${r.totalCount || 0} 个大文件`
          : `扫描完成：${r.groupCount || 0} 组重复，可释放 ${formatFileSize(r.wastedTotal || 0)}`);
      }
    } catch (err) {
      cleanScanning = false;
      cleanScanId = null;
      setCleanStartLabel('开始扫描');
      document.getElementById('clean-progress').style.display = 'none';
      document.getElementById('clean-list').innerHTML = `<div class="memo-empty">${escapeHtml(err.message)}</div>`;
    }
  }, 600);
}

async function stopCleanScan() {
  clearTimeout(cleanPollTimer);
  const id = cleanScanId;
  cleanScanId = null;
  cleanScanning = false;
  setCleanStartLabel('开始扫描');
  document.getElementById('clean-progress').style.display = 'none';

  if (id) {
    try { await fetch('/api/scan/' + encodeURIComponent(id), { method: 'DELETE' }); } catch { /* 忽略 */ }
  }
  document.getElementById('clean-list').innerHTML = '<div class="memo-empty">已停止扫描</div>';
}

function renderCleanResult(job) {
  const box = document.getElementById('clean-list');
  if (!box) return;
  const r = job.result || {};

  if (job.mode === 'large') {
    if (!r.files || !r.files.length) {
      box.innerHTML = '<div class="memo-empty">没有符合条件的大文件</div>';
      return;
    }
    box.innerHTML = `
      <div class="clean-summary">找到 ${r.totalCount} 个大文件，共 ${formatFileSize(r.totalBytes)}${r.truncated ? '（已达上限，结果被截断）' : ''}</div>
      ${r.files.map(f => `
        <div class="clean-item" title="${escapeHtml(f.path)}" onclick="openCleanLocation('${jsStr(parentDirOf(f.path))}')">
          <div class="clean-name">${escapeHtml(f.name)}</div>
          <div class="clean-meta">${escapeHtml(parentDirOf(f.path))}</div>
          <span class="clean-size">${formatFileSize(f.size)}</span>
        </div>`).join('')}`;
    return;
  }

  if (!r.groups || !r.groups.length) {
    box.innerHTML = '<div class="memo-empty">没有发现重复文件</div>';
    return;
  }
  box.innerHTML = `
    <div class="clean-summary">发现 ${r.groupCount} 组重复，多出 ${r.duplicateCount} 个副本，可释放 ${formatFileSize(r.wastedTotal)}${r.truncated ? '（已达上限，结果被截断）' : ''}</div>
    ${r.groups.map(g => `
      <div class="clean-group">
        <div class="clean-group-head"><span>${g.count} 份 · 每份 ${formatFileSize(g.size)}</span><b>可释放 ${formatFileSize(g.wasted)}</b></div>
        ${g.files.map((p, i) => `
          <div class="clean-file" title="${escapeHtml(p)}" onclick="openCleanLocation('${jsStr(parentDirOf(p))}')">
            <span class="clean-file-name">${i === 0 ? '保留' : '副本'} · ${escapeHtml(baseNameOf(p))}</span>
            <span class="clean-file-meta">${escapeHtml(parentDirOf(p))}</span>
          </div>`).join('')}
      </div>`).join('')}`;
}

function parentDirOf(p) {
  const s = String(p == null ? '' : p);
  const d = s.replace(/[\\/][^\\/]*$/, '');
  return d || s;
}

function openCleanLocation(dir) {
  closeCleanPanel();
  loadDirectory(dir);
}

