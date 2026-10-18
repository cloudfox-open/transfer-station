const fs = require('fs');
const path = require('path');
const { moveSync, purgeThumbCache, isProtectedPath, pathKey } = require('./util');
const { restoreBatch } = require('./trash');

const HISTORY_MAX = 50;
const history = [];

function pushHistory(entry) {
  history.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now(),
    ...entry
  });
  if (history.length > HISTORY_MAX) history.shift();
}

function undoInfo() {
  const top = history[history.length - 1];
  return {
    canUndo: !!top,
    label: top ? top.label : '',
    count: history.length,
    type: top ? top.type : ''
  };
}

function popHistory() {
  return history.pop() || null;
}

// 撤销一条记录，返回 { done, failed, focus }
function undoEntry(entry) {
  const done = [];
  const failed = [];

  if (entry.type === 'trash') {
    const r = restoreBatch(entry.trashId);
    const first = r.restored[0];
    return {
      done: r.restored,
      failed: r.failed,
      focus: first ? path.dirname(first.to) : null
    };
  }

  // 重命名同样要两阶段，否则 a→b、b→a 这种互换在撤销时会互相占用名字
  if (entry.type === 'rename') {
    // 批量改名互换时，from 很可能正被同批的另一个对象占用，这类不算冲突
    const fromKeys = new Set(entry.items.map(i => pathKey(i.from)));
    const batch = [];
    for (const it of entry.items) {
      try {
        if (!fs.existsSync(it.to)) throw new Error('对象已不存在');
        if (fs.existsSync(it.from) && !fromKeys.has(pathKey(it.from))) throw new Error('原名称已被占用');
        batch.push(it);
      } catch (err) {
        failed.push({ path: it.from, error: err.message });
      }
    }

    const temps = [];
    const renamed = [];
    try {
      batch.forEach((it, i) => {
        const tmp = path.join(path.dirname(it.to), `.undo-${Date.now().toString(36)}-${i}`);
        fs.renameSync(it.to, tmp);
        temps.push({ it, tmp });
      });
      for (const t of temps) {
        fs.renameSync(t.tmp, t.it.from);
        renamed.push(t.it);
        done.push(t.it);
        purgeThumbCache(t.it.to);
      }
    } catch (err) {
      for (const t of temps) {
        try { if (fs.existsSync(t.tmp)) fs.renameSync(t.tmp, t.it.to); } catch { /* 忽略 */ }
      }
      for (const it of renamed) {
        try { if (fs.existsSync(it.from)) fs.renameSync(it.from, it.to); } catch { /* 忽略 */ }
      }
      done.length = 0;
      failed.push({ path: entry.items[0].from, error: '撤销重命名失败: ' + err.message });
    }

    const first = done[0];
    return { done: [...done], failed, focus: first ? path.dirname(first.from) : null };
  }

  // 逆序回放，批量操作时先撤后发生的那个
  for (const it of [...entry.items].reverse()) {
    try {
      if (entry.type === 'move') {
        if (!fs.existsSync(it.to)) throw new Error('对象已不在原目标位置');
        if (fs.existsSync(it.from)) throw new Error('原位置已有同名对象');
        fs.mkdirSync(path.dirname(it.from), { recursive: true });
        moveSync(it.to, it.from);
        purgeThumbCache(it.to);
      } else if (entry.type === 'copy') {
        if (!fs.existsSync(it.to)) throw new Error('副本已不存在');
        if (isProtectedPath(it.to)) throw new Error('受保护的位置不能删除');
        fs.rmSync(it.to, { recursive: true, force: true });
        purgeThumbCache(it.to);
      } else if (entry.type === 'mkdir') {
        if (fs.existsSync(it.to)) {
          if (fs.readdirSync(it.to).length > 0) throw new Error('文件夹里已有内容，无法撤销');
          fs.rmdirSync(it.to);
        }
      }
      done.push(it);
    } catch (err) {
      failed.push({ path: it.from || it.to, error: err.message });
    }
  }

  const first = done[0];
  return {
    done,
    failed,
    focus: first ? path.dirname(first.from || first.to) : null
  };
}

module.exports = { HISTORY_MAX, pushHistory, undoInfo, undoEntry, popHistory, history };
