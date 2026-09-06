'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const git = require('./git-reader');
const { loadAllUrd } = require('./urd-reader');
const { ensureDir, readText, rel, DEFAULT_DIRS, readJson, writeJson } = require('../store/fs-utils');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function snapshotUrd(opts = {}) {
  const urds = loadAllUrd(opts.urdDir || DEFAULT_DIRS.urd);
  const snapDir = path.join(opts.snapshotsDir || DEFAULT_DIRS.snapshots, 'urd');
  ensureDir(snapDir);
  const result = [];
  for (const urd of urds) {
    const text = urd.raw;
    const hash = sha256(text);
    const stamp = `${urd.id}-v${urd.version}-${hash}`;
    const file = path.join(snapDir, `${stamp}.md`);
    fs.writeFileSync(file, text, 'utf8');
    result.push({
      id: urd.id,
      version: urd.version,
      status: urd.status,
      sourceFile: urd.file,
      snapshotFile: rel(file),
      hash,
      gitSha: git.headSha() || null,
      requirementCount: urd.requirements.length,
      capturedAt: new Date().toISOString(),
    });
  }
  return result;
}

function snapshotUsage(opts = {}) {
  const usageDir = opts.usageDir || DEFAULT_DIRS.usage;
  const snapDir = path.join(opts.snapshotsDir || DEFAULT_DIRS.snapshots, 'usage');
  ensureDir(snapDir);
  const result = [];
  if (!fs.existsSync(usageDir)) return result;
  for (const entry of fs.readdirSync(usageDir, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name) !== '.md') continue;
    const src = path.join(usageDir, entry.name);
    const text = readText(src);
    const hash = sha256(text);
    const file = path.join(snapDir, `${path.basename(entry.name, '.md')}-${hash}.md`);
    fs.writeFileSync(file, text, 'utf8');
    result.push({ file: rel(src), snapshotFile: rel(file), hash, capturedAt: new Date().toISOString() });
  }
  return result;
}

function snapshotSource(opts = {}) {
  return {
    gitSha: git.headSha() || null,
    branch: (git.branches()[0] || '').replace('*', '').trim(),
    capturedAt: new Date().toISOString(),
  };
}

function bumpVersion(current = '0.1.0', kind = 'patch') {
  const parts = current.split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (kind === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (kind === 'minor') { parts[1]++; parts[2] = 0; }
  else parts[2]++;
  return parts.join('.');
}

function snapshotAll(opts = {}) {
  return {
    urd: snapshotUrd(opts),
    usage: snapshotUsage(opts),
    source: snapshotSource(opts),
    capturedAt: new Date().toISOString(),
  };
}

module.exports = { snapshotUrd, snapshotUsage, snapshotSource, snapshotAll, bumpVersion, sha256 };
