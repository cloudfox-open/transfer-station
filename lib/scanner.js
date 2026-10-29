const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// 扫描任务放在内存里，结果保留 30 分钟；同时最多跑 2 个，避免把磁盘打满
const jobs = new Map();
const MAX_ACTIVE = 2;
const MAX_FILES = 50000;
const MAX_DEPTH = 12;
const MAX_SECONDS = 90;
const TOP_FILES = 200;
const TOP_GROUPS = 100;
const HASH_PART = 256 * 1024;
const JOB_TTL = 30 * 60 * 1000;

function snapshot(job) {
  return {
    id: job.id,
    state: job.state,
    mode: job.mode,
    root: job.root,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    scannedFiles: job.scannedFiles,
    scannedBytes: job.scannedBytes,
    hashedFiles: job.hashedFiles,
    hashCandidates: job.hashCandidates,
    truncated: job.truncated,
    phase: job.phase,
    error: job.error,
    result: job.result
  };
}

function pruneJobs() {
  const cutoff = Date.now() - JOB_TTL;
  for (const [id, job] of jobs) {
    if (job.state !== 'running' && job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}

function startScan({ root, mode, minSize }) {
  const running = [...jobs.values()].filter(j => j.state === 'running').length;
  if (running >= MAX_ACTIVE) return { error: '同时最多运行 2 个扫描任务，请稍后再试' };

  const job = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    state: 'running',
    root,
    mode,
    minSize,
    startedAt: Date.now(),
    finishedAt: 0,
    scannedFiles: 0,
    scannedBytes: 0,
    hashedFiles: 0,
    hashCandidates: 0,
    truncated: false,
    phase: mode === 'duplicate' ? '扫描文件' : '扫描大文件',
    error: '',
    result: null,
    _large: [],
    _bySize: new Map()
  };
  jobs.set(job.id, job);

  pruneJobs();
  run(job).catch(err => {
    job.state = 'error';
    job.error = err.message;
    job.phase = '失败';
    job.finishedAt = Date.now();
  });
  return { job };
}

function getJob(id) {
  pruneJobs();
  const job = jobs.get(String(id));
  return job ? snapshot(job) : null;
}

function cancelJob(id) {
  const job = jobs.get(String(id));
  if (!job) return false;
  if (job.state === 'running') {
    job.state = 'cancelled';
    job.finishedAt = Date.now();
  }
  return true;
}

async function run(job) {
  await walk(job);

  if (job.state === 'cancelled') { job.phase = '已停止'; return; }

  if (job.mode === 'duplicate') {
    job.phase = '校验重复内容';
    await findDuplicates(job);
  } else {
    job.phase = '整理结果';
    buildLargeResult(job);
  }

  job.finishedAt = Date.now();
  if (job.state === 'cancelled') job.phase = '已停止';
  else { job.state = 'done'; job.phase = '完成'; }

  job._large = [];
  job._bySize = null;
}

// 递归遍历目录；跳过隐藏项、符号链接，并有文件数 / 深度 / 时长上限
async function walk(job) {
  const stack = [{ dir: job.root, depth: 0 }];

  while (stack.length) {
    if (!(await canContinue(job))) return;

    const { dir, depth } = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }

    for (const ent of entries) {
      if (job.scannedFiles >= MAX_FILES) { job.truncated = true; return; }
      if (ent.name.startsWith('.')) continue;

      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (depth < MAX_DEPTH) stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!ent.isFile()) continue;

      let st;
      try { st = await fsp.stat(full); } catch { continue; }
      job.scannedFiles++;
      job.scannedBytes += st.size;
      if (st.size < job.minSize) continue;

      if (job.mode === 'large') {
        job._large.push({ name: ent.name, path: full, size: st.size, mtime: st.mtimeMs });
      } else {
        const list = job._bySize.get(st.size);
        if (list) list.push(full);
        else job._bySize.set(st.size, [full]);
      }
    }
  }
}

async function canContinue(job) {
  if (job.state !== 'running') return false;
  if (Date.now() - job.startedAt > MAX_SECONDS * 1000) {
    job.truncated = true;
    return false;
  }
  // 让出事件循环，避免大目录扫描把服务卡住
  await new Promise(resolve => setImmediate(resolve));
  return true;
}

function buildLargeResult(job) {
  const matched = job._large;
  matched.sort((a, b) => b.size - a.size);
  job.result = {
    mode: 'large',
    files: matched.slice(0, TOP_FILES),
    totalCount: matched.length,
    totalBytes: matched.reduce((s, f) => s + f.size, 0),
    truncated: job.truncated
  };
}

function hashFile(file, partBytes) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const opts = partBytes ? { start: 0, end: partBytes - 1 } : undefined;
    const stream = fs.createReadStream(file, opts);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// 重复文件：先按大小分组，再比首块哈希，最后整文件哈希确认
async function findDuplicates(job) {
  const groups = [];
  const sizeGroups = [...job._bySize.entries()].filter(([, list]) => list.length > 1);
  job.hashCandidates = sizeGroups.reduce((s, [, list]) => s + list.length, 0);

  let wasted = 0;
  let duplicateCount = 0;

  for (const [size, files] of sizeGroups) {
    if (!(await canContinue(job))) break;

    const byQuick = new Map();
    for (const file of files) {
      if (!(await canContinue(job))) break;
      try {
        const q = await hashFile(file, HASH_PART);
        job.hashedFiles++;
        if (byQuick.has(q)) byQuick.get(q).push(file);
        else byQuick.set(q, [file]);
      } catch { /* 读不了就跳过 */ }
    }

    for (const quickFiles of byQuick.values()) {
      if (quickFiles.length < 2) continue;
      if (!(await canContinue(job))) break;

      const byFull = new Map();
      for (const file of quickFiles) {
        if (!(await canContinue(job))) break;
        try {
          const h = await hashFile(file, 0);
          job.hashedFiles++;
          if (byFull.has(h)) byFull.get(h).push(file);
          else byFull.set(h, [file]);
        } catch { /* 读不了就跳过 */ }
      }

      for (const [hash, list] of byFull) {
        if (list.length < 2) continue;
        const w = size * (list.length - 1);
        wasted += w;
        duplicateCount += list.length - 1;
        groups.push({ size, hash, count: list.length, wasted: w, files: list });
      }
    }
  }

  groups.sort((a, b) => b.wasted - a.wasted);
  job.result = {
    mode: 'duplicate',
    groups: groups.slice(0, TOP_GROUPS),
    groupCount: groups.length,
    duplicateCount,
    wastedTotal: wasted,
    truncated: job.truncated || job.state === 'cancelled'
  };
}

module.exports = { startScan, getJob, cancelJob, hashFile };
