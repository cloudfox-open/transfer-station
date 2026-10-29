const fs = require('fs');
const path = require('path');
const { hashFile } = require('./scanner');

const MAX_FILES = 20;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// 逐块比较两个文件，返回第一个不同字节的偏移（0 基）；完全相同返回 null
async function firstDiffOffset(pathA, pathB) {
  const sa = fs.createReadStream(pathA, { highWaterMark: 64 * 1024 });
  const sb = fs.createReadStream(pathB, { highWaterMark: 64 * 1024 });
  const ia = sa[Symbol.asyncIterator]();
  const ib = sb[Symbol.asyncIterator]();
  let offset = 0;

  try {
    while (true) {
      const [ra, rb] = await Promise.all([ia.next(), ib.next()]);
      if (ra.done || rb.done) return (ra.done && rb.done) ? null : offset;

      const ba = ra.value;
      const bb = rb.value;
      const n = Math.min(ba.length, bb.length);
      for (let i = 0; i < n; i++) {
        if (ba[i] !== bb[i]) return offset + i;
      }
      if (ba.length !== bb.length) return offset + n;
      offset += n;
    }
  } finally {
    sa.destroy();
    sb.destroy();
  }
}

function readHex(file, offset, length = 8) {
  return new Promise((resolve) => {
    fs.open(file, 'r', (err, fd) => {
      if (err) return resolve('');
      const buf = Buffer.alloc(length);
      fs.read(fd, buf, 0, length, offset, (readErr, bytesRead) => {
        fs.close(fd, () => {
          if (readErr) return resolve('');
          resolve(buf.slice(0, bytesRead).toString('hex').replace(/(..)/g, '$1 ').trim());
        });
      });
    });
  });
}

async function compareFiles(inputPaths) {
  const paths = (Array.isArray(inputPaths) ? inputPaths : []).filter(Boolean);
  if (paths.length < 2) throw badRequest('至少选择两个文件');
  if (paths.length > MAX_FILES) throw badRequest(`一次最多对比 ${MAX_FILES} 个文件`);

  const files = [];
  for (const p of paths) {
    let stat;
    try { stat = fs.statSync(p); } catch { throw badRequest('文件不存在：' + p); }
    if (!stat.isFile()) throw badRequest('不是普通文件：' + p);

    const hash = await hashFile(p, 0);
    files.push({
      path: p,
      name: path.basename(p),
      size: stat.size,
      mtime: stat.mtimeMs,
      hash
    });
    // 多个大文件依次哈希，避免同时读盘把响应拖死
    await new Promise(resolve => setImmediate(resolve));
  }

  const byHash = new Map();
  for (const f of files) {
    if (byHash.has(f.hash)) byHash.get(f.hash).push(f);
    else byHash.set(f.hash, [f]);
  }

  const groups = [...byHash.entries()]
    .map(([hash, list]) => ({ hash, size: list[0].size, count: list.length, files: list }))
    .sort((a, b) => b.count - a.count || b.size - a.size);

  const allIdentical = groups.length === 1;
  const uniqueCount = groups.filter(g => g.count === 1).length;

  let firstDiff = null;
  if (files.length === 2 && !allIdentical) {
    const [a, b] = files;
    if (a.size !== b.size) {
      firstDiff = { offset: null, sizeA: a.size, sizeB: b.size, hexA: '', hexB: '' };
    } else {
      try {
        const offset = await firstDiffOffset(a.path, b.path);
        if (offset != null) {
          firstDiff = {
            offset,
            sizeA: a.size,
            sizeB: b.size,
            hexA: await readHex(a.path, offset),
            hexB: await readHex(b.path, offset)
          };
        }
      } catch { /* 读不了就只给哈希结论 */ }
    }
  }

  return { files, groups, allIdentical, uniqueCount, firstDiff };
}

module.exports = { compareFiles, MAX_FILES };
