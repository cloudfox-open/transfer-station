/* 文件中转站 — 操作：新建/上传/下载、右键菜单、对话框、复制粘贴、撤销 */
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
    setUndoState(data.history);
    refreshView();
  } catch (err) { alert('创建失败: ' + err.message); }
}

let pendingFiles = [];      // [{ file, rel, status, percent }]
let uploadXhr = null;
let uploading = false;
let uploadCancelled = false;
let currentUploadItem = null;

function triggerUpload() {
  if (currentView !== 'files') return alert('请先进入一个文件夹再上传');
  document.getElementById('file-upload').click();
}

function triggerFolderUpload() {
  if (currentView !== 'files') return alert('请先进入一个文件夹再上传');
  document.getElementById('folder-upload').click();
}

function handleFileSelect(files) {
  addPendingFiles(files, false);
  document.getElementById('file-upload').value = '';
}

function handleFolderSelect(files) {
  addPendingFiles(files, true);
  document.getElementById('folder-upload').value = '';
}

function addPendingFiles(files, isFolder) {
  if (!files || !files.length) return;
  if (currentView !== 'files') { alert('请先进入一个文件夹再上传'); return; }

  const all = Array.from(files).map(f => ({
    file: f,
    // 文件夹上传时保留相对路径，服务端会照着建目录
    rel: isFolder ? (f.webkitRelativePath || f.name) : '',
    status: 'pending',
    percent: 0
  }));

  // 超过服务端单文件上限的直接拦下来，不用先传一遍再失败
  const limit = (serverConfig.maxUploadMB || 2048) * 1024 * 1024;
  const over = all.filter(i => i.file.size > limit);
  const list = all.filter(i => i.file.size <= limit);

  if (over.length) {
    alert(`以下文件超过单文件 ${serverConfig.maxUploadMB} MB 上限，已跳过：\n`
      + over.slice(0, 5).map(i => `· ${i.rel || i.file.name}（${formatFileSize(i.file.size)}）`).join('\n')
      + (over.length > 5 ? `\n…共 ${over.length} 个文件超限` : ''));
  }
  if (!list.length) return;

  pendingFiles = pendingFiles.concat(list);
  document.getElementById('upload-title').textContent = isFolder ? '上传文件夹' : '上传文件';
  showUploadPanel();
}

function uploadStatusText(item) {
  if (item.status === 'uploading') return (item.percent || 0) + '%';
  if (item.status === 'done') return '完成';
  if (item.status === 'error') return '失败';
  if (item.status === 'cancelled') return '已取消';
  return formatFileSize(item.file.size);
}

function showUploadPanel() {
  const panel = document.getElementById('upload-panel');
  const list = document.getElementById('upload-file-list');
  document.getElementById('upload-progress-container').style.display = 'none';

  const confirmBtn = document.getElementById('upload-confirm-btn');
  confirmBtn.disabled = uploading;
  confirmBtn.textContent = uploading
    ? '上传中…'
    : (pendingFiles.some(f => f.status === 'error' || f.status === 'cancelled') ? '继续上传' : '开始上传');

  list.innerHTML = pendingFiles.map((item, i) => `
    <div class="upload-file-item">
      <span class="upload-file-icon">${fileIconHtml(item.file.name)}</span>
      <div class="upload-file-info">
        <div class="upload-file-name" title="${escapeHtml(item.rel || item.file.name)}">${escapeHtml(item.rel || item.file.name)}</div>
        <div class="upload-file-size">${formatFileSize(item.file.size)}</div>
      </div>
      <span class="upload-file-status" id="up-status-${i}">${uploadStatusText(item)}</span>
      ${uploading ? '' : `<span class="upload-file-remove" onclick="removeUploadFile(${i})">×</span>`}
    </div>`).join('');

  panel.classList.add('open');
}

function removeUploadFile(index) {
  pendingFiles.splice(index, 1);
  pendingFiles.length === 0 ? closeUploadPanel() : showUploadPanel();
}

function closeUploadPanel() {
  if (uploading) cancelUpload(true);
  document.getElementById('upload-panel').classList.remove('open');
  document.getElementById('upload-cancel-btn').textContent = '取消';
  pendingFiles = [];
}

function cancelUpload(silent) {
  if (!uploading) {
    if (!silent) closeUploadPanel();
    return;
  }
  uploadCancelled = true;
  if (currentUploadItem) currentUploadItem.status = 'cancelled';
  if (uploadXhr) uploadXhr.abort();
}

// 单个文件上传，返回 Promise（进度写回对应行）
function uploadOne(item) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    if (item.rel) form.append('rel', item.rel);
    form.append('files', item.file, item.file.name);

    const idx = pendingFiles.indexOf(item);
    const xhr = new XMLHttpRequest();
    uploadXhr = xhr;
    currentUploadItem = item;

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      item.percent = Math.round((e.loaded / e.total) * 100);
      const el = document.getElementById('up-status-' + idx);
      if (el) el.textContent = item.percent + '%';
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const d = JSON.parse(xhr.responseText);
          if (d.success) return resolve(d);
        } catch { /* 忽略 */ }
      }
      let msg = '上传失败';
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* 忽略 */ }
      reject(new Error(msg));
    });
    xhr.addEventListener('error', () => reject(new Error('网络错误')));
    xhr.addEventListener('abort', () => reject('cancelled'));

    xhr.open('POST', `/api/upload?path=${encodeURIComponent(currentPath)}`);
    xhr.send(form);
  });
}

function setUploadRow(item) {
  const idx = pendingFiles.indexOf(item);
  const el = document.getElementById('up-status-' + idx);
  if (el) el.textContent = uploadStatusText(item);
}

async function confirmUpload() {
  if (uploading || !pendingFiles.length) return;

  const targets = pendingFiles.filter(f => f.status !== 'done');
  if (!targets.length) { closeUploadPanel(); return; }

  uploading = true;
  uploadCancelled = false;

  const confirmBtn = document.getElementById('upload-confirm-btn');
  const cancelBtn = document.getElementById('upload-cancel-btn');
  const progressContainer = document.getElementById('upload-progress-container');
  const progressFill = document.getElementById('upload-progress-fill');
  const progressText = document.getElementById('upload-progress-text');

  confirmBtn.disabled = true;
  confirmBtn.textContent = '上传中…';
  cancelBtn.textContent = '取消上传';
  progressContainer.style.display = 'flex';
  progressFill.style.width = '0%';
  progressText.textContent = `0 / ${targets.length}`;

  let done = 0;

  for (const item of targets) {
    if (uploadCancelled) break;
    item.status = 'uploading';
    item.percent = 0;
    setUploadRow(item);

    try {
      await uploadOne(item);
      item.status = 'done';
      item.percent = 100;
      done++;
    } catch (err) {
      item.status = (err === 'cancelled' || uploadCancelled) ? 'cancelled' : 'error';
      setUploadRow(item);
      if (item.status === 'cancelled') break;
      // 一旦失败就停下，避免刷屏式报错；用户可以点「继续上传」
      if (err && err.message) alert(`「${item.rel || item.file.name}」上传失败：${err.message}`);
      break;
    } finally {
      setUploadRow(item);
      progressFill.style.width = Math.round((done / targets.length) * 100) + '%';
      progressText.textContent = `${done} / ${targets.length}`;
    }
  }

  uploading = false;
  uploadXhr = null;
  currentUploadItem = null;
  cancelBtn.textContent = '取消';

  const allDone = pendingFiles.every(f => f.status === 'done');
  if (allDone) {
    progressText.textContent = '✓ 全部完成';
    setTimeout(() => { closeUploadPanel(); refreshView(); }, 500);
    return;
  }

  confirmBtn.disabled = false;
  confirmBtn.textContent = '继续上传';
  if (uploadCancelled) progressText.textContent = '已取消';
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
// 回收站
// =========================================================
async function openTrashPanel() {
  closeMenu();
  document.getElementById('favorites-panel').classList.remove('open');
  document.getElementById('trash-panel').classList.add('open');
  await loadTrash();
}

function closeTrashPanel() {
  document.getElementById('trash-panel').classList.remove('open');
}

async function loadTrash() {
  const box = document.getElementById('trash-list');
  box.innerHTML = '<div class="nav-empty" style="text-align:center;padding:24px 12px">正在读取…</div>';
  try {
    const res = await fetch('/api/trash');
    const data = await res.json();
    renderTrash(data);
  } catch (err) {
    box.innerHTML = '<div class="nav-empty" style="text-align:center;padding:24px 12px">读取失败</div>';
  }
}

function renderTrash(data) {
  const box = document.getElementById('trash-list');
  const batches = (data && data.batches) || [];
  if (!batches.length) {
    box.innerHTML = '<div class="nav-empty" style="text-align:center;padding:32px 12px">回收站是空的</div>';
    return;
  }
  box.innerHTML = batches.map(b => `
    <div class="trash-batch">
      <div class="trash-batch-head">
        <span>${formatDate(b.at)} · ${b.items.length} 项</span>
        <button class="trash-restore-all" onclick="restoreTrashBatch('${b.id}')">全部还原</button>
      </div>
      ${b.items.map(it => `
        <div class="trash-item${it.exists ? '' : ' missing'}">
          <span class="trash-ico">${fileIconHtml(it.name)}</span>
          <div class="trash-info">
            <div class="trash-name">${escapeHtml(it.name)}${it.isDir ? '（文件夹）' : ''}</div>
            <div class="trash-path" title="${escapeHtml(it.originalPath)}">${escapeHtml(it.originalPath)}</div>
          </div>
        </div>`).join('')}
    </div>`).join('');
}

async function restoreTrashBatch(id) {
  const r = await apiPost('/api/trash/restore', { id });
  if (!r.ok) return alert(r.data.error || '还原失败');
  await loadTrash();
  await refreshView();
  flashStatus(`已还原 ${r.data.restored.length} 个项目`);
}

async function emptyTrashAction() {
  if (!confirm('清空回收站会永久删除其中的所有文件，无法恢复。确定继续？')) return;
  const r = await apiPost('/api/trash/empty', {});
  if (!r.ok) return alert('清空失败');
  await loadTrash();
  flashStatus('回收站已清空');
}

// =========================================================
// 批量重命名
// =========================================================
function openBatchRename() {
  closeContextMenu();
  const items = selectedEntries();
  if (items.length < 2) return flashStatus('请先选择多个项目');

  showModal({
    title: `批量重命名 ${items.length} 个项目`,
    bodyHtml: `
      <div class="br-form">
        <label class="br-row"><span>规则</span>
          <select id="br-mode" onchange="updateBatchRenamePreview()">
            <option value="replace">替换文字</option>
            <option value="prefix">添加前缀</option>
            <option value="suffix">添加后缀</option>
            <option value="sequence">重命名为序号</option>
          </select>
        </label>
        <label class="br-row"><span id="br-label-a">查找</span>
          <input id="br-a" oninput="updateBatchRenamePreview()" placeholder="要替换的文字">
        </label>
        <label class="br-row" id="br-row-b"><span id="br-label-b">替换为</span>
          <input id="br-b" oninput="updateBatchRenamePreview()" placeholder="留空则删除">
        </label>
        <div class="br-preview" id="br-preview"></div>
      </div>`,
    okText: '重命名',
    onOk: applyBatchRename
  });

  updateBatchRenamePreview();
}

// 计算新名字：只改主名，扩展名原样保留
function buildBatchRenamePlan() {
  const items = selectedEntries();
  const modeEl = document.getElementById('br-mode');
  if (!modeEl) return [];
  const mode = modeEl.value;
  const a = document.getElementById('br-a').value;
  const b = document.getElementById('br-b').value;
  const seqStart = Number(b) || 1;

  return items.map((item, i) => {
    const isDir = item.kind === 'folder';
    const dot = item.name.lastIndexOf('.');
    const ext = (!isDir && dot > 0) ? item.name.slice(dot) : '';
    const base = ext ? item.name.slice(0, -ext.length) : item.name;

    let next = base;
    if (mode === 'replace') next = a ? base.split(a).join(b) : base;
    else if (mode === 'prefix') next = a + base;
    else if (mode === 'suffix') next = base + a;
    else if (mode === 'sequence') next = `${a || '文件'}_${String(seqStart + i).padStart(3, '0')}`;

    return { path: item.path, oldName: item.name, name: (next + ext).trim() };
  });
}

function updateBatchRenamePreview() {
  const modeEl = document.getElementById('br-mode');
  if (!modeEl) return;
  const mode = modeEl.value;
  const rowB = document.getElementById('br-row-b');
  const labelA = document.getElementById('br-label-a');
  const labelB = document.getElementById('br-label-b');
  const inputA = document.getElementById('br-a');
  const inputB = document.getElementById('br-b');

  // 按规则切换字段语义
  if (mode === 'replace') {
    rowB.style.display = '';
    labelA.textContent = '查找'; inputA.placeholder = '要替换的文字';
    labelB.textContent = '替换为'; inputB.placeholder = '留空则删除';
    inputB.type = 'text';
  } else if (mode === 'prefix') {
    rowB.style.display = 'none';
    labelA.textContent = '前缀'; inputA.placeholder = '例如 2026_';
  } else if (mode === 'suffix') {
    rowB.style.display = 'none';
    labelA.textContent = '后缀'; inputA.placeholder = '例如 _备份';
  } else {
    rowB.style.display = '';
    labelA.textContent = '名称前缀'; inputA.placeholder = '例如 IMG';
    labelB.textContent = '起始序号'; inputB.placeholder = '1';
    inputB.type = 'number';
  }

  const plan = buildBatchRenamePlan();
  const changed = plan.filter(p => p.name && p.name !== p.oldName);
  const names = changed.map(p => p.name);
  const dup = names.length !== new Set(names.map(n => n.toLowerCase())).size;

  const preview = document.getElementById('br-preview');
  preview.innerHTML = `
    <div class="br-preview-list">${changed.slice(0, 4).map(p =>
      `<div class="br-preview-row"><span>${escapeHtml(p.oldName)}</span><b>→</b><span>${escapeHtml(p.name)}</span></div>`
    ).join('')}${changed.length > 4 ? `<div class="br-preview-more">…共 ${changed.length} 项</div>` : ''}</div>
    ${changed.length === 0 ? '<div class="br-preview-hint">还没有产生变化</div>' : ''}
    ${dup ? '<div class="br-preview-warn">有重名的新名字，确认后会整体取消</div>' : ''}`;
}

async function applyBatchRename() {
  const plan = buildBatchRenamePlan().filter(p => p.name && p.name !== p.oldName);
  if (!plan.length) { alert('没有需要重命名的项目'); return false; }

  const r = await apiPost('/api/rename-batch', {
    items: plan.map(p => ({ path: p.path, name: p.name }))
  });
  if (!r.ok) { alert(r.data.error || '批量重命名失败'); return false; }

  setUndoState(r.data.history);
  await refreshView();
  setSelection((r.data.renamed || []).map(x => x.to));
  flashStatus(`已重命名 ${(r.data.renamed || []).length} 个项目`);
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

function buildContextItems(ctx) {
  if (ctx.kind === 'background') {
    const undoItem = {
      icon: 'undo',
      label: undoState.canUndo ? `撤销 ${undoState.label}` : '撤销',
      hint: 'Ctrl+Z',
      disabled: !undoState.canUndo,
      run: undoLast
    };
    if (currentView !== 'files') {
      return [
        undoItem,
        { sep: true },
        { icon: 'refresh', label: '刷新', hint: 'F5', run: refreshView },
        { icon: 'monitor', label: '此电脑', run: () => openThisPC() }
      ];
    }
    const here = { kind: 'folder', name: currentPath.split(/[\\/]/).filter(Boolean).pop() || currentPath, path: currentPath };
    return [
      undoItem,
      { sep: true },
      { icon: 'upload', label: '上传文件到此处', run: triggerUpload },
      { icon: 'folder-plus', label: '上传文件夹', run: triggerFolderUpload },
      { icon: 'folder-plus', label: '新建文件夹', run: newFolder },
      { icon: 'paste', label: '粘贴', hint: 'Ctrl+V', disabled: !clipboard, run: () => pasteInto(currentPath) },
      { sep: true },
      { icon: 'package', label: '打包下载当前文件夹', run: downloadZip },
      { icon: 'trash', label: '打开回收站', run: openTrashPanel },
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
  // 右键点在已选中的项目上时，操作整个选区；否则只对当前项
  const multi = selectedPaths.length > 1 && isSelected(entry.path);
  const sel = multi ? selectedEntries() : [entry];
  const n = sel.length;
  const single = n === 1;
  const isDir = entry.kind === 'folder';
  const items = [];

  items.push({ icon: isDir ? 'folder-line' : 'open-new', label: '打开', hint: 'Enter', disabled: !single, run: () => openEntry(entry) });
  items.push({ icon: 'open-new', label: '在新标签页中打开', disabled: !single, run: () => openEntryNewTab(entry) });
  if (single && !isDir) {
    items.push({ icon: 'download', label: '下载', run: () => downloadEntry(entry) });
  } else {
    items.push({ icon: 'package', label: single ? '打包下载' : `打包下载所选的 ${n} 项`, run: () => zipSelection(sel) });
  }
  items.push({ sep: true });
  items.push({ icon: 'copy', label: single ? '复制' : `复制 ${n} 个项目`, hint: 'Ctrl+C', run: copySelection });
  items.push({ icon: 'cut', label: single ? '剪切' : `剪切 ${n} 个项目`, hint: 'Ctrl+X', run: cutSelection });
  if (isDir && single && clipboard && !inClipboard(entry.path)) {
    items.push({ icon: 'paste', label: '粘贴到此文件夹', run: () => pasteInto(entry.path) });
  }
  if (single) {
    items.push({ icon: 'rename', label: '重命名', hint: 'F2', run: () => startInlineRename(entry) });
  } else {
    items.push({ icon: 'rename', label: `批量重命名 ${n} 个项目…`, run: openBatchRename });
  }
  items.push({ icon: 'trash', label: single ? '删除' : `删除 ${n} 个项目`, hint: 'Delete', danger: true, run: confirmDeleteSelection });
  items.push({ sep: true });
  items.push({ icon: 'link', label: '复制路径', hint: 'Ctrl+Shift+C', run: () => copySelectionPaths(sel) });
  items.push({ icon: 'info', label: '属性', run: () => showPropertiesSelection(sel) });
  return items;
}

function openContextMenu(x, y, ctx) {
  const menu = document.getElementById('ctx-menu');
  ctxItems = buildContextItems(ctx);

  let title = ctx.drive ? driveDisplayName(ctx.drive) : (ctx.entry ? ctx.entry.name : '');
  if (ctx.entry && selectedPaths.length > 1 && isSelected(ctx.entry.path)) {
    title = `已选择 ${selectedPaths.length} 个项目`;
  }
  let html = title ? `<div class="ctx-head" title="${escapeHtml(title)}">${escapeHtml(title)}</div>` : '';
  html += ctxItems.map((it, i) => it.sep
    ? '<div class="ctx-sep"></div>'
    : `<div class="ctx-item ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}" data-idx="${i}">
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
  const entry = entriesCache.find(x => samePath(x.path, primarySelectedPath()));
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
      // 右键已选中的项目 → 保留整个选区；右键未选中的 → 只选它
      if (!isSelected(ctx.entry.path)) setSelection([ctx.entry.path]);
    }
    openContextMenu(e.clientX, e.clientY, ctx);
  });

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item) return;
    const action = ctxItems[Number(item.dataset.idx)];
    closeContextMenu();
    if (action && !action.disabled && action.run) action.run();
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
        if (!isSelected(ctx.entry.path)) setSelection([ctx.entry.path]);
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

  // 点空白处取消选择
  content.addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil) return;
    if (currentView !== 'files') return;
    if (e.target.closest('[data-path]')) return;
    if (selectedPaths.length) clearSelection();
  });
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
  return { ok: r.ok, error: r.data.error, path: r.data.path, history: r.data.history };
}

async function deletePaths(paths) {
  const r = await apiPost('/api/delete', { paths });
  return { ok: r.ok, error: r.data.error, failed: r.data.failed || [], history: r.data.history, trashId: r.data.trashId };
}

// =========================================================
// 撤销（Ctrl+Z）
// =========================================================
function setUndoState(info) {
  if (!info) return;
  undoState = { canUndo: !!info.canUndo, label: info.label || '' };
  renderUndoEntry();
}

function renderUndoEntry() {
  const label = document.getElementById('undo-menu-label');
  const item = document.getElementById('undo-menu-item');
  if (!label || !item) return;
  label.textContent = undoState.canUndo ? `撤销 ${undoState.label}` : '撤销';
  item.classList.toggle('disabled', !undoState.canUndo);
  item.title = undoState.canUndo ? `撤销「${undoState.label}」` : '没有可撤销的操作';
}

async function loadUndoState() {
  try {
    const res = await fetch('/api/history');
    if (res.ok) setUndoState(await res.json());
  } catch { /* 忽略 */ }
}

async function undoLast() {
  closeMenu();
  closeContextMenu();
  if (!undoState.canUndo) return flashStatus('没有可撤销的操作');

  const r = await apiPost('/api/undo', {});
  setUndoState(r.data.history);
  if (!r.ok) { alert(r.data.error || '撤销失败'); return; }

  const focus = r.data.focus;
  if (focus && currentView === 'files' && !samePath(focus, currentPath)) {
    await loadDirectory(focus);
  } else {
    await refreshView();
  }
  flashStatus(`已撤销：${r.data.undone}`);
}

// =========================================================
// 剪切 / 复制 / 粘贴
// =========================================================
function samePath(a, b) {
  const norm = s => String(s == null ? '' : s).replace(/[\\/]+$/, '').toLowerCase();
  const na = norm(a);
  return na !== '' && na === norm(b);
}

function inClipboard(p) {
  return !!clipboard && clipboard.paths.some(x => samePath(x, p));
}

function baseNameOf(p) {
  return String(p == null ? '' : p).split(/[\\/]/).filter(Boolean).pop() || String(p || '');
}

function dirNameOf(p) {
  const s = String(p == null ? '' : p);
  const d = s.replace(/[\\/][^\\/]*$/, '');
  if (d === '' && s.startsWith('/')) return '/';
  return d;
}

// 状态栏短暂提示，之后恢复常规统计
function flashStatus(text) {
  const left = document.getElementById('status-left');
  if (!left) return;
  left.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(updateStatus, 2800);
}

function setClipboard(op, entries) {
  closeContextMenu();
  const list = (entries || []).filter(Boolean);
  if (!list.length) return;
  clipboard = { op, paths: list.map(e => e.path), names: list.map(e => e.name) };
  applySelection();
  const verb = op === 'cut' ? '剪切' : '复制';
  flashStatus(list.length === 1
    ? `已${verb}「${list[0].name}」，在目标文件夹按 Ctrl+V 粘贴`
    : `已${verb} ${list.length} 个项目，在目标文件夹按 Ctrl+V 粘贴`);
}

function cutEntry(entry) { setClipboard('cut', [entry]); }
function copyEntry(entry) { setClipboard('copy', [entry]); }
function cutSelection() { setClipboard('cut', selectedEntries()); }
function copySelection() { setClipboard('copy', selectedEntries()); }

function clearClipboard() {
  const wasCopy = !!clipboard && clipboard.op === 'copy';
  clipboard = null;
  applySelection();
  flashStatus(wasCopy ? '已取消复制' : '已取消剪切');
}

async function pasteInto(targetDir) {
  closeContextMenu();
  if (!clipboard || !clipboard.paths.length || !targetDir) return;

  const isCopy = clipboard.op === 'copy';
  const verb = isCopy ? '复制' : '移动';

  const r = await apiPost(isCopy ? '/api/copy' : '/api/move', { paths: clipboard.paths, target: targetDir });
  if (!r.ok) { alert(r.data.error || `${verb}失败`); return; }

  const done = (isCopy ? r.data.copied : r.data.moved) || [];
  const failed = r.data.failed || [];

  // 一个都没动（例如已经在目标目录里）：保留剪贴板，方便换个地方再粘
  if (done.length === 0 && failed.length === 0) {
    alert('这些项目已经在当前文件夹中');
    return;
  }
  if (failed.length) {
    alert(`部分项目未能${verb}：\n` + failed.slice(0, 5).map(f => `· ${baseNameOf(f.path)}：${f.error}`).join('\n'));
  }

  // 复制后保留剪贴板，可以连续粘贴多份；移动则清空
  if (!isCopy) clipboard = null;
  setUndoState(r.data.history);

  await refreshView();

  // 粘贴到当前目录时，选中刚生成的项目
  const landed = done.filter(m => samePath(dirNameOf(m.to), currentPath)).map(m => m.to);
  if (landed.length) setSelection(landed);
  flashStatus(`已${verb} ${done.length} 个项目到「${baseNameOf(targetDir) || targetDir}」`);
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
      else {
        setSelection([r.path]);
        setUndoState(r.history);
        if (inClipboard(entry.path)) clipboard = { ...clipboard, paths: [r.path], names: [value] };
      }
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
    else {
      setUndoState(r.history);
      if (inClipboard(entry.path)) clipboard = { ...clipboard, paths: [r.path], names: [value] };
      refreshView();
    }
  });
}

function confirmDelete(entry) {
  if (entry) setSelection([entry.path]);
  confirmDeleteSelection();
}

function confirmDeleteSelection() {
  closeContextMenu();
  const items = selectedEntries();
  if (!items.length) return;

  const n = items.length;
  const dirs = items.filter(e => e.kind === 'folder').length;
  const title = n === 1
    ? '删除' + (items[0].kind === 'folder' ? '文件夹' : '文件')
    : `删除 ${n} 个项目`;
  const body = n === 1
    ? `<div>确定要把${items[0].kind === 'folder' ? '文件夹' : '文件'} <strong>${escapeHtml(items[0].name)}</strong> 移到回收站吗？</div>
       <div style="margin-top:8px">${items[0].kind === 'folder' ? '该文件夹内的全部内容会一起进入回收站，' : ''}之后可以在回收站里还原。</div>`
    : `<div>确定要把选中的 <strong>${n}</strong> 个项目${dirs ? `（含 ${dirs} 个文件夹及其全部内容）` : ''} 移到回收站吗？</div>
       <div class="del-list">${items.slice(0, 6).map(e => escapeHtml(e.name)).join('<br>')}${n > 6 ? `<br>…以及其他 ${n - 6} 项` : ''}</div>
       <div style="margin-top:8px">之后可以在回收站里还原。</div>`;

  showModal({
    title,
    bodyHtml: body,
    okText: n === 1 ? '移到回收站' : `移到回收站（${n} 项）`,
    danger: true,
    onOk: async () => {
      const r = await deletePaths(items.map(e => e.path));
      if (!r.ok) { alert(r.error || '删除失败'); return false; }
      if (r.failed && r.failed.length) alert('部分项目未能删除：\n' + r.failed.slice(0, 5).map(f => `· ${baseNameOf(f.path)}：${f.error}`).join('\n'));
      if (clipboard && items.some(e => inClipboard(e.path))) clipboard = null;
      setUndoState(r.history);
      setSelection([]);
      refreshView();
      flashStatus(`已移到回收站，按 Ctrl+Z 或在回收站中还原`);
    }
  });
}

function showProperties(entry) {
  showPropertiesSelection([entry]);
}

function showPropertiesSelection(items) {
  closeContextMenu();
  const list = (items || []).filter(Boolean);
  if (!list.length) return;

  if (list.length > 1) {
    const files = list.filter(e => e.kind !== 'folder');
    const dirs = list.filter(e => e.kind === 'folder');
    const bytes = files.reduce((s, e) => s + (e.size || 0), 0);
    const parent = list[0].path.replace(/[\\/][^\\/]*$/, '') || list[0].path;
    showModal({
      title: '属性',
      bodyHtml: propRows([
        ['类型', `${list.length} 个项目`],
        ['包含', `${dirs.length} 个文件夹，${files.length} 个文件`],
        ['位置', parent],
        ['大小', dirs.length ? `${formatFileSize(bytes)}（不含文件夹）` : formatFileSize(bytes)],
        ['名称', list.slice(0, 4).map(e => e.name).join('、') + (list.length > 4 ? ' …' : '')]
      ]),
      okText: '确定',
      hideCancel: true
    });
    return;
  }

  const entry = list[0];
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
  const count = String(p).split(/\r?\n/).filter(Boolean).length;
  if (ok) left.textContent = count > 1 ? `已复制 ${count} 条路径` : `已复制路径：${p}`;
  else left.textContent = `复制失败，路径：${p}`;
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

// 打包下载选中的若干项目（文件 + 文件夹混选）
function zipSelection(items) {
  closeContextMenu();
  const list = (items || []).filter(Boolean);
  if (!list.length) return;
  if (list.length === 1) {
    if (list[0].kind === 'folder') return zipFolder(list[0].path);
    return downloadEntry(list[0]);
  }

  const qs = new URLSearchParams();
  list.forEach(e => qs.append('paths', e.path));
  window.location.href = '/api/download/zip?' + qs.toString();
}

function copySelectionPaths(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return;
  copyPath(list.map(e => e.path).join('\r\n'));
}

// =========================================================
// 工具
// =========================================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
