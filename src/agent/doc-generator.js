'use strict';

const fs = require('fs');
const path = require('path');
const { scanSource } = require('./source-reader');
const { loadAllUrd, flattenRequirements } = require('./urd-reader');
const { ensureDir, readText, readJson, rel, DEFAULT_DIRS, ROOT } = require('../store/fs-utils');

function extractAPIFromText(text) {
  const out = [];
  const re = /(GET|POST|PUT|%PATCH|DELETE)\s+(\/[^\s`*]+)/g;
  let m;
  while ((m = re.exec(text))) out.push({ method: m[1], path: m[2] });
  return out;
}

function curlExample(ep) {
  const base = 'http://localhost:3000';
  if (ep.method === 'GET') return `curl ${base}${ep.path}`;
  if (ep.method === 'DELETE') return `curl -X DELETE ${base}${ep.path}`;
  const body = '{\n  "title": "example"\n}';
  return `curl -X ${ep.method} ${base}${ep.path} \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
}

function generateOverview(pkg, reqs, mods, appName, description) {
  const L = [];
  L.push(`# ${appName}`);
  L.push('');
  L.push(`> ${description}`);
  L.push('');
  L.push('## Tổng quan');
  L.push('');
  L.push(`${appName} là một ứng dụng Node.js.! ${description}`);
  L.push('');
  L.push('## Tính năng');
  L.push('');
  for (const r of reqs) L.push(`- **${r.id}: ${r.title}** — ${r.description || r.title}`);
  L.push('');
  L.push('## Công nghệ');
  L.push('');
  const langs = [...new Set(mods.map((m) => m.lang))];
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| Ngôn ngữ | ${langs.join(', ')} |`);
  L.push(`| Modules | ${mods.length} |`);
  L.push(`| Yêu cầu | ${reqs.length} |`);
  const allEps = reqs.flatMap((r) => extractAPIFromText(`${r.title} ${r.description}`));
  L.push(`| API | ${allEps.length} |`);
  L.push('');
  L.push('## Khởi động nhanh');
  L.push('');
  L.push('```bash');
  L.push(`# Cài đặt dependency`);
  L.push(`npm install`);
  L.push(`# Chạy ứng dụng`);
  L.push(`node src/app.js`);
  L.push('```');
  L.push('');
  L.push('Server chạy trên port 3000. Kiểm tra bằng:');
  L.push('');
  L.push('```bash');
  L.push('curl http://localhost:3000/health');
  L.push('# → ok');
  L.push('```');
  L.push('');
  return L.join('\n');
}

function generateUserGuide(reqs, appName) {
  const L = [];
  L.push(`# User Guide — ${appName}`);
  L.push('');
  L.push(`Hướng dẫn này giải thích cách sử dụng **${appName}** dưới góc độ người dùng. Each feature is described with its purpose, how to invoke it, and the expected behavior.`);
  L.push('');
  L.push('---');
  L.push('');
  if (!reqs.length) {
    L.push('_No requirements documented. Add a URD markdown file to `docs/urd/`._');
    return L.join('\n');
  }
  for (const r of reqs) {
    L.push(`## ${r.id}: ${r.title}`);
    L.push('');
    if (r.description) { L.push(r.description); L.push(''); }
    const eps = extractAPIFromText(`${r.title} ${r.description}`);
    if (eps.length) {
      L.push('### Cách sử dụng');
      L.push('');
      for (const ep of eps) {
        L.push(`**${ep.method} ${ep.path}**`);
        L.push('');
        L.push('```bash');
        L.push(curlExample(ep));
        L.push('```');
        L.push('');
      }
    }
    if (r.acceptanceCriteria && r.acceptanceCriteria.length) {
      L.push('### Hành vi mong đợi');
      L.push('');
      for (const ac of r.acceptanceCriteria) L.push(`- ✅ ${ac}`);
      L.push('');
    }
    if (r.affectedFiles && r.affectedFiles.length) {
      L.push(`<details><summary>File hiện thực</summary>`);
      L.push('');
      for (const f of r.affectedFiles) L.push(`- \`${f}\``);
      L.push('');
      L.push('</details>');
      L.push('');
    }
    L.push('---');
    L.push('');
  }
  return L.join('\n');
}

function generateApiReference(reqs, mods, appName) {
  const L = [];
  L.push(`# API Reference — ${appName}`);
  L.push('');
  L.push('## API');
  L.push('');
  const allEps = [];
  for (const r of reqs) {
    for (const ep of extractAPIFromText(`${r.title} ${r.description}`)) {
      allEps.push({ ...ep, req: r.id, desc: r.description });
    }
  }
  if (allEps.length) {
    L.push('| Method | Path | Requirement | Description |');
    L.push('|--------|------|-------------|-------------|');
    for (const ep of allEps) L.push(`| \`${ep.method}\` | \`${ep.path}\` | ${ep.req} | ${ep.desc || ''} |`);
    L.push('');
    for (const ep of allEps) {
      L.push(`### ${ep.method} ${ep.path}`);
      L.push('');
      L.push('```bash');
      L.push(curlExample(ep));
      L.push('```');
      L.push('');
    }
  } else {
    L.push('_Không phát hiện API nào in URD descriptions. Document endpoints as `METHOD /path` in requirement descriptions._');
    L.push('');
  }
  L.push('## Module');
  L.push('');
  for (const mod of mods) {
    L.push(`### \`${mod.file}\``);
    L.push('');
    L.push(`- **Ngôn ngữ:** ${mod.lang} · **Dòngs:** ${mod.lines}`);
    const fns = mod.symbols.filter((s) => s.kind === 'function');
    const cls = mod.symbols.filter((s) => s.kind === 'class');
    if (fns.length) {
      L.push('');
      L.push('| Hàm | Tham số | Dòng |');
      L.push('|----------|------------|------|');
      for (const f of fns) L.push(`| \`${f.name}\` | ${f.params.join(', ') || '—'} | ${f.line} |`);
    }
    if (cls.length) {
      L.push('');
      L.push('| Lớp | Dòng |');
      L.push('|-------|------|');
      for (const c of cls) L.push(`| \`${c.name}\` | ${c.line} |`);
    }
    L.push('');
  }
  return L.join('\n');
}

function generateDeveloperGuide(reqs, mods, appName, projectRoot) {
  const L = [];
  L.push(`# Developer Guide — ${appName}`);
  L.push('');
  L.push('## Kiến trúc');
  L.push('');
  L.push(`${appName} là một ứng dụng Node.js.!`);
  L.push('');
  L.push('```');
  L.push(projectRoot.replace(/\\/g, '/') + '/');
  const dirs = [...new Set(mods.map((m) => path.dirname(m.file)))].sort();
  for (const d of dirs) L.push(`  ${d}/`);
  L.push('```');
  L.push('');
  L.push('## Trách nhiệm Module');
  L.push('');
  for (const mod of mods) {
    const fns = mod.symbols.filter((s) => s.kind === 'function');
    L.push(`### \`${mod.file}\``);
    L.push('');
    if (fns.length) {
      for (const f of fns) {
        L.push(`- \`${f.name}(${f.params.join(', ')})\` (line ${f.line})${f.doc ? ' — ' + f.doc.split('\n')[0] : ''}`);
      }
    } else {
      L.push('- _(không có hàm export)_');
    }
    L.push('');
  }
  L.push('## Yêu cầu → Hiện thực');
  L.push('');
  L.push('| Requirement | Title | Affected files |');
  L.push('|-------------|-------|----------------|');
  for (const r of reqs) L.push(`| ${r.id} | ${r.title} | ${(r.affectedFiles || []).map((f) => '`' + f + '`').join(', ')} |`);
  L.push('');
  L.push('## Cách mở rộng');
  L.push('');
  L.push('1. **Viết yêu cầu** — add a `### REQ-XXX` section to a URD markdown file in `docs/urd/`, listing acceptance criteria and affected files.');
  L.push('2. **Hiện thực code** — add or modify the source files listed in the requirement\'s **Affected Files**.');
  L.push('3. **Commit với tham chiếu** — include `Req: REQ-XXX` in the commit message so Jarvis can verify the change matches the URD.');
  L.push('4. **/health** — mọi container phải expose `GET /health` returning 200.');
  L.push('');
  L.push('## Cách chạy');
  L.push('');
  L.push('```bash');
  L.push('node src/app.js      # khởi động server');
  L.push('curl localhost:3000/health   # kiểm tra health');
  L.push('```');
  L.push('');
  return L.join('\n');
}

function generateIndex(appName, files) {
  const L = [];
  L.push(`# ${appName} — Documentation`);
  L.push('');
  L.push(`> Sinh lúc ${new Date().toISOString()}`);
  L.push('');
  L.push('## Mục lục');
  L.push('');
  L.push('| # | Document | Audience |');
  L.push('|---|----------|----------|');
  L.push('| 1 | [Overview](overview.md) | Everyone — what the app is, features, quick start |');
  L.push('| 2 | [User Guide](user-guide.md) | End users — how to use each feature with examples |');
  L.push('| 3 | [API Reference](api-reference.md) | Developers — endpoints, modules, functions |');
  L.push('| 4 | [Developer Guide](developer-guide.md) | Developers — architecture, how to extend |');
  L.push('');
  L.push('---');
  L.push('');
  L.push('_Tất cả tài liệu được sinh from the URD (`docs/urd/`) and source code (`src/`) by the Jarvis URD Guardian agent._');
  return L.join('\n');
}

function generateAll(opts = {}) {
  const srcDir = opts.sourceDir || DEFAULT_DIRS.source;
  const outDir = opts.usageDir || DEFAULT_DIRS.usage;
  const urdDir = opts.urdDir || DEFAULT_DIRS.urd;
  const projectRoot = opts.projectRoot || path.dirname(srcDir);

  ensureDir(outDir);
  for (const f of fs.readdirSync(outDir).filter((f) => f.endsWith('.md'))) {
    try { fs.unlinkSync(path.join(outDir, f)); } catch (_e) {}
  }
  const mods = scanSource(srcDir).map((m) => ({
    ...m,
    file: path.relative(projectRoot, path.resolve(ROOT, m.file)).replace(/\\/g, '/') || m.file,
  }));
  const urds = loadAllUrd(urdDir);
  const reqs = flattenRequirements(urds);
  const pkg = readJson(path.join(projectRoot, 'package.json'), {});

  const appName = pkg.name ? pkg.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : (urds[0] && urds[0].title) || 'Application';
  const description = pkg.description || (urds[0] && urds[0].title) || 'A Node.js application.';

  const docs = [
    { name: 'overview.md', content: generateOverview(pkg, reqs, mods, appName, description) },
    { name: 'user-guide.md', content: generateUserGuide(reqs, appName) },
    { name: 'api-reference.md', content: generateApiReference(reqs, mods, appName) },
    { name: 'developer-guide.md', content: generateDeveloperGuide(reqs, mods, appName, projectRoot) },
    { name: 'index.md', content: generateIndex(appName) },
  ];

  const written = [];
  for (const d of docs) {
    const fp = path.join(outDir, d.name);
    fs.writeFileSync(fp, d.content, 'utf8');
    written.push(rel(fp));
  }

  return { generatedAt: new Date().toISOString(), appName, documents: docs.map((d) => d.name), requirementCount: reqs.length, moduleCount: mods.length, files: written };
}

module.exports = { generateAll, generateOverview, generateUserGuide, generateApiReference, generateDeveloperGuide, generateIndex };
