/* 文件中转站 — 面板：收藏夹、备忘录 */
// =========================================================
// 收藏夹
// =========================================================
function toggleFavorites() {
  const panel = document.getElementById('favorites-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    document.getElementById('trash-panel').classList.remove('open');
    document.getElementById('memo-panel').classList.remove('open');
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
// 备忘录
// =========================================================
let currentMemoId = null;
let selectedMemoColor = '#0078d4';
let memoDataCache = [];

function openMemoPanel() {
  document.getElementById('trash-panel').classList.remove('open');
  document.getElementById('favorites-panel').classList.remove('open');
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

