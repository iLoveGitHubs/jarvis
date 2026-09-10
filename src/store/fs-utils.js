'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DIRS = {
  urd: path.join(ROOT, 'docs', 'urd'),
  usage: path.join(ROOT, 'docs', 'usage'),
  source: path.join(ROOT, 'src'),
  data: path.join(ROOT, 'data'),
  registry: path.join(ROOT, 'data', 'registry.json'),
  snapshots: path.join(ROOT, 'data', 'snapshots'),
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_e) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return '';
  }
}

function listFiles(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'target', 'dist', '.angular', 'build', '__pycache__'].includes(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!exts || exts.includes(path.extname(entry.name))) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

module.exports = { ROOT, DEFAULT_DIRS, ensureDir, readJson, writeJson, readText, listFiles, rel };
