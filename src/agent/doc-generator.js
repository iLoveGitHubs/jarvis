'use strict';

const fs = require('fs');
const path = require('path');
const { scanSource } = require('./source-reader');
const { ensureDir, readText, rel, DEFAULT_DIRS } = require('../store/fs-utils');

function generateModuleDoc(mod) {
  const lines = [];
  lines.push(`# ${mod.file}`);
  lines.push('');
  lines.push(`- **Language:** ${mod.lang}`);
  lines.push(`- **Lines:** ${mod.lines}`);
  lines.push(`- **Symbols:** ${mod.symbols.length}`);
  lines.push('');

  const endpoints = mod.symbols.filter((s) => s.kind === 'endpoint');
  const functions = mod.symbols.filter((s) => s.kind === 'function');
  const classes = mod.symbols.filter((s) => s.kind === 'class');

  if (endpoints.length) {
    lines.push('## Endpoints');
    lines.push('');
    lines.push('| Method | Path | Line |');
    lines.push('|--------|------|------|');
    for (const e of endpoints) lines.push(`| \`${e.method}\` | \`${e.path}\` | ${e.line} |`);
    lines.push('');
  }

  if (functions.length) {
    lines.push('## Functions');
    lines.push('');
    for (const fn of functions) {
      lines.push(`### \`${fn.name}(${fn.params.join(', ')})\``);
      lines.push(`> Line ${fn.line}`);
      if (fn.doc) { lines.push(''); lines.push(fn.doc); }
      lines.push('');
    }
  }

  if (classes.length) {
    lines.push('## Classes');
    lines.push('');
    for (const cls of classes) {
      lines.push(`### \`${cls.name}\``);
      lines.push(`> Line ${cls.line}`);
      if (cls.doc) { lines.push(''); lines.push(cls.doc); }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function docNameFor(file) {
  return file.replace(/\.[a-z0-9]+$/i, '').replace(/[\\/]/g, '.') + '.md';
}

function generateIndexDoc(mods) {
  const lines = [];
  lines.push('# Usage Documentation — Index');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Modules');
  lines.push('');
  lines.push('| File | Language | Lines | Symbols |');
  lines.push('|------|----------|-------|---------|');
  for (const m of mods) {
    lines.push(`| [${m.file}](${docNameFor(m.file)}) | ${m.lang} | ${m.lines} | ${m.symbols.length} |`);
  }
  lines.push('');

  const allEndpoints = mods.flatMap((m) => m.symbols.filter((s) => s.kind === 'endpoint').map((s) => ({ ...s, file: m.file })));
  if (allEndpoints.length) {
    lines.push('## API Endpoints');
    lines.push('');
    lines.push('| Method | Path | File | Line |');
    lines.push('|--------|------|------|------|');
    for (const e of allEndpoints) lines.push(`| \`${e.method}\` | \`${e.path}\` | ${e.file} | ${e.line} |`);
    lines.push('');
  }

  return lines.join('\n');
}

function generateAll(opts = {}) {
  const srcDir = opts.sourceDir || DEFAULT_DIRS.source;
  const outDir = opts.usageDir || DEFAULT_DIRS.usage;
  ensureDir(outDir);

  const mods = scanSource(srcDir);
  const written = [];

  const indexText = generateIndexDoc(mods);
  const indexPath = path.join(outDir, 'index.md');
  fs.writeFileSync(indexPath, indexText, 'utf8');
  written.push(rel(indexPath));

  for (const mod of mods) {
    const text = generateModuleDoc(mod);
    const outPath = path.join(outDir, docNameFor(mod.file));
    fs.writeFileSync(outPath, text, 'utf8');
    written.push(rel(outPath));
  }

  return { generatedAt: new Date().toISOString(), moduleCount: mods.length, files: written };
}

module.exports = { generateAll, generateModuleDoc, generateIndexDoc };
