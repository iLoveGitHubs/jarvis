'use strict';

const fs = require('fs');
const path = require('path');
const { listFiles, readText, rel, DEFAULT_DIRS } = require('../store/fs-utils');

const CODE_EXTS = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs'];

function extractJsSymbols(text) {
  const symbols = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fn = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (fn) {
      symbols.push({
        kind: 'function',
        name: fn[1],
        params: fn[2].split(',').map((s) => s.trim()).filter(Boolean),
        line: i + 1,
        doc: readJsDoc(lines, i),
      });
      continue;
    }

    const arrow = line.match(/^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
    if (arrow) {
      symbols.push({
        kind: 'function',
        name: arrow[1],
        params: arrow[2].split(',').map((s) => s.trim()).filter(Boolean),
        line: i + 1,
        doc: readJsDoc(lines, i),
      });
      continue;
    }

    const cls = line.match(/^\s*(?:export\s+)?class\s+(\w+)/);
    if (cls) {
      symbols.push({ kind: 'class', name: cls[1], line: i + 1, doc: readJsDoc(lines, i) });
      continue;
    }

    const route = line.match(/^\s*(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (route) {
      symbols.push({
        kind: 'endpoint',
        method: route[1].toUpperCase(),
        path: route[2],
        line: i + 1,
      });
    }
  }
  return symbols;
}

function readJsDoc(lines, idx) {
  let i = idx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0 || !lines[i].includes('*/')) return '';
  const block = [];
  while (i >= 0 && !lines[i].includes('/**')) {
    block.unshift(lines[i].replace(/^\s*\*?\s?/, ''));
    i--;
  }
  return block.join('\n').trim();
}

function extractPySymbols(text) {
  const symbols = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fn = line.match(/^def\s+(\w+)\s*\(([^)]*)\)/);
    if (fn) {
      symbols.push({
        kind: 'function',
        name: fn[1],
        params: fn[2].split(',').map((s) => s.trim()).filter(Boolean),
        line: i + 1,
        doc: readPyDoc(lines, i),
      });
      continue;
    }
    const cls = line.match(/^class\s+(\w+)/);
    if (cls) {
      symbols.push({ kind: 'class', name: cls[1], line: i + 1, doc: readPyDoc(lines, i) });
    }
  }
  return symbols;
}

function readPyDoc(lines, idx) {
  const out = [];
  let i = idx + 1;
  if (lines[i] && lines[i].trim().startsWith('"""')) {
    if (lines[i].trim().endsWith('"""') && lines[i].trim().length > 3) return lines[i].trim().slice(3, -3);
    i++;
    while (i < lines.length && !lines[i].includes('"""')) {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join('\n').trim();
}

function parseFile(file) {
  const ext = path.extname(file);
  if (!CODE_EXTS.includes(ext)) return null;
  const text = readText(file);
  let symbols = [];
  if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) symbols = extractJsSymbols(text);
  else if (ext === '.py') symbols = extractPySymbols(text);
  return {
    file: rel(file),
    ext,
    lang: langForExt(ext),
    lines: text.split(/\r?\n/).length,
    symbols,
  };
}

function langForExt(ext) {
  return {
    '.js': 'JavaScript', '.ts': 'TypeScript', '.jsx': 'JSX', '.tsx': 'TSX',
    '.py': 'Python', '.java': 'Java', '.go': 'Go', '.rs': 'Rust',
  }[ext] || 'Unknown';
}

function scanSource(dir = DEFAULT_DIRS.source) {
  const files = listFiles(dir, CODE_EXTS);
  return files.map(parseFile).filter(Boolean);
}

module.exports = { scanSource, parseFile, CODE_EXTS };
