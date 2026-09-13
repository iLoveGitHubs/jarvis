'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { execSync } = require('child_process');
const { ROOT, DEFAULT_DIRS, readText, rel, ensureDir } = require('../store/fs-utils');
const db = require('../store/db');
const projects = require('../store/projects');
const { loadAllUrd, flattenRequirements } = require('../agent/urd-reader');
const { checkCommit, checkRecent, checkHead, checkStaged } = require('../agent/commit-checker');
const { generateAll } = require('../agent/doc-generator');
const llm = require('../agent/llm-checker');
const git = require('../agent/git-reader');

const PUBLIC_DIR = path.join(__dirname, 'public');

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function makeCtx(projectName) {
  const list = projects.loadProjects();
  const proj = (projectName && list.find((p) => p.name === projectName)) || list[0];
  if (!proj) return null;
  const root = proj.path;
  const srcDir = path.join(root, 'src');
  const sourceDir = fs.existsSync(srcDir) ? srcDir
    : fs.existsSync(path.join(root, 'backend', 'src')) ? path.join(root, 'backend', 'src')
    : root;
  return {
    projectName: proj.name,
    root,
    urdDir: proj.urdPath ? proj.urdPath : path.join(root, 'docs', 'urd'),
    sourceDir,
    usageDir: path.join(root, 'docs', 'usage'),
    registryFile: projects.registryFileFor(proj.name),
  };
}

function syncRegistry(ctx) {
  const reg = db.load(ctx.registryFile);
  const urds = loadAllUrd(ctx.urdDir);
  const reqs = flattenRequirements(urds);
  db.syncRequirements(reg, reqs);
  db.save(reg, ctx.registryFile);
  return reg;
}

function listDocs(ctx) {
  ensureDir(ctx.usageDir);
  const out = [];
  if (!fs.existsSync(ctx.usageDir)) return out;
  for (const entry of fs.readdirSync(ctx.usageDir, { withFileTypes: true })) {
    if (entry.isFile() && path.extname(entry.name) === '.md') {
      const full = path.join(ctx.usageDir, entry.name);
      out.push({ name: entry.name, size: fs.statSync(full).size });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function findTestFiles(sourceDir, projectRoot) {
  const testPatterns = [/Test\.java$/i, /Tests\.java$/i, /\.test\.(js|ts)$/i, /\.spec\.(js|ts)$/i, /^test_.*\.py$/i, /_test\.py$/i];
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'target', 'dist', '.angular', 'build'].includes(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (testPatterns.some((p) => p.test(entry.name))) {
        const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
        let content = '';
        try { content = fs.readFileSync(full, 'utf8'); } catch (_e) {}
        out.push({ path: rel, content });
      }
    }
  };
  walk(sourceDir);
  return out;
}

function listUrd(ctx) {
  const out = [];
  if (!fs.existsSync(ctx.urdDir)) return out;
  for (const entry of fs.readdirSync(ctx.urdDir, { withFileTypes: true })) {
    if (entry.isFile() && path.extname(entry.name) === '.md') {
      const full = path.join(ctx.urdDir, entry.name);
      out.push({ name: entry.name, size: fs.statSync(full).size });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function handleApi(req, res, pathname, query, ctx) {
  switch (pathname) {
    case '/api/projects': {
      const list = projects.loadProjects();
      const stats = list.map((p) => {
        const c = makeCtx(p.name);
        if (!c) return { name: p.name, path: p.path, requirements: 0, commits: 0, gitUrl: null, urdGitUrl: null };
        const reg = db.load(c.registryFile);
        let gitUrl = p.gitUrl || git.remoteUrl(c.root);
        if (gitUrl && gitUrl.startsWith('/')) gitUrl = p.gitUrl || null;
        let urdGitUrl = p.urdGitUrl || (p.urdPath ? git.remoteUrl(p.urdPath) : null);
        if (urdGitUrl && urdGitUrl.startsWith('/')) urdGitUrl = p.urdGitUrl || null;
        return { name: p.name, path: p.path, requirements: reg.requirements.length, commits: reg.commits.length, gitUrl, urdGitUrl, branch: git.branches(c.root)[0] || '', checkMode: p.checkMode || 'post', runtimeUrl: p.runtimeUrl || null, scanStatus: p.scanStatus || 'partial' };
      });
      return json(res, 200, { current: ctx && ctx.projectName, projects: stats });
    }
    case '/api/registry': {
      const reg = syncRegistry(ctx);
      return json(res, 200, db.dashboardView(reg));
    }
    case '/api/requirements': {
      const reg = syncRegistry(ctx);
      return json(res, 200, db.dashboardView(reg).requirements);
    }
    case '/api/commits': {
      const reg = syncRegistry(ctx);
      return json(res, 200, db.dashboardView(reg).commits);
    }
    case '/api/git/commits': {
      return json(res, 200, git.listCommits(parseInt(query.limit || '50', 10), ctx.root));
    }
    case '/api/git/status': {
      return json(res, 200, { isRepo: git.isRepo(ctx.root), head: git.headSha(ctx.root), branch: git.branches(ctx.root), status: git.statusPorcelain(ctx.root) });
    }
    case '/api/check/head': {
      const result = await checkHead({ root: ctx.root, urdDir: ctx.urdDir });
      if (result.error) return json(res, 400, result);
      const reg = db.load(ctx.registryFile);
      db.upsertCommit(reg, result);
      db.save(reg, ctx.registryFile);
      return json(res, 200, result);
    }
    case '/api/check/recent': {
      const results = await checkRecent(parseInt(query.limit || '3', 10), { root: ctx.root, urdDir: ctx.urdDir });
      const reg = db.load(ctx.registryFile);
      for (const r of results) db.upsertCommit(reg, r);
      db.save(reg, ctx.registryFile);
      return json(res, 200, results);
    }
    case '/api/check/all': {
      const force = query.force === 'true';
      (async () => {
        const allCommits = git.listCommits(1000, ctx.root);
        const urds = loadAllUrd(ctx.urdDir);
        const reqs = flattenRequirements(urds);
        let checked = 0;
        let skipped = 0;
        for (const c of allCommits) {
          const reg = db.load(ctx.registryFile);
          db.syncRequirements(reg, reqs);
          const already = reg.commits.find((x) => x.sha === c.sha);
          if (already && !force) { skipped++; continue; }
          const result = await checkCommit(c.sha, { root: ctx.root, urdDir: ctx.urdDir });
          db.upsertCommit(reg, result);
          db.save(reg, ctx.registryFile);
          checked++;
        }
        try { projects.updateProject(ctx.projectName, { scanStatus: 'full' }); } catch (_e) {}
        console.log(`[urd-guardian] ${ctx.projectName}: ${force?'force ':''}scan done — ${checked} checked, ${skipped} skipped, ${allCommits.length} total`);
      })();
      return json(res, 200, { status: 'started', message: force ? 'Đang quét lại toàn bộ (force)' : 'Đang quét toàn bộ commit trong background' });
    }
    case '/api/generate-docs': {
      const result = generateAll({ sourceDir: ctx.sourceDir, usageDir: ctx.usageDir, urdDir: ctx.urdDir, projectRoot: ctx.root });
      return json(res, 200, result);
    }
    case '/api/docs': {
      return json(res, 200, { dir: rel(ctx.usageDir), files: listDocs(ctx) });
    }
    case '/api/urd': {
      return json(res, 200, { dir: rel(ctx.urdDir), files: listUrd(ctx) });
    }
    case '/api/traceability': {
      const reg = syncRegistry(ctx);
      const view = db.dashboardView(reg);
      const testFiles = findTestFiles(ctx.sourceDir, ctx.root);
      const commitById = new Map();
      for (const c of reg.commits) commitById.set(c.sha, c);
      const matrix = view.requirements.map((r) => {
        const reqCommits = (r.commits || []).map((sc) => commitById.get(sc.sha)).filter(Boolean);
        const sourceFiles = [...new Set(reqCommits.flatMap((c) => c.changedFiles || []))];
        const tests = testFiles.filter((f) => {
          const lower = (f.path || '').toLowerCase();
          const content = (f.content || '').toLowerCase();
          const idLower = r.id.toLowerCase();
          return lower.includes(idLower) || content.includes(idLower) || content.includes(idLower.replace('-', ''));
        }).map((f) => f.path);
        return {
          id: r.id, title: r.title, urdId: r.urdId, urdFile: r.urdFile,
          status: r.status,
          acCount: (r.acceptanceCriteria || []).length,
          commits: (r.commits || []).map((c) => ({ sha: c.sha, ok: c.ok, subject: c.subject })),
          sourceFiles,
          testFiles: tests,
          mismatchNotes: r.mismatchNotes || [],
        };
      });
      return json(res, 200, { requirements: matrix, totalTests: testFiles.length });
    }
    case '/api/coverage': {
      const reg = syncRegistry(ctx);
      const reqs = reg.requirements;
      const total = reqs.length;
      const commitById = new Map();
      for (const c of reg.commits) commitById.set(c.sha, c);
      const reqHasPass = (r) => {
        for (const sha of (r.commits || [])) {
          const commit = commitById.get(sha);
          if (commit && commit.requirements) {
            const res = commit.requirements.find((x) => x.id === r.id);
            if (res && res.verdict === 'PASS') return true;
          }
        }
        return false;
      };
      const pass = reqs.filter((r) => (r.commits || []).length && reqHasPass(r)).length;
      const fail = reqs.filter((r) => (r.commits || []).length && !reqHasPass(r)).length;
      const notStarted = reqs.filter((r) => !(r.commits || []).length).length;
      const byUrd = {};
      for (const r of reqs) {
        const k = r.urdId || 'không rõ';
        if (!byUrd[k]) byUrd[k] = { total: 0, pass: 0, fail: 0, notStarted: 0 };
        byUrd[k].total++;
        if (!(r.commits || []).length) byUrd[k].notStarted++;
        else if (reqHasPass(r)) byUrd[k].pass++;
        else byUrd[k].fail++;
      }
      const view = db.dashboardView(reg);
      const commits = [...view.commits].reverse();
      const seenPass = new Set();
      const trend = commits.map((c) => {
        for (const r of (c.requirements || [])) if (r.verdict === 'PASS') seenPass.add(r.id);
        return { sha: c.sha, date: c.date, passed: seenPass.size, total, coverage: total ? Math.round(seenPass.size / total * 100) : 0 };
      });
      return json(res, 200, { total, pass, fail, notStarted, percentage: total ? Math.round(pass / total * 100) : 0, byUrd, trend });
    }
    case '/api/impact': {
      const reg = syncRegistry(ctx);
      const view = db.dashboardView(reg);
      const urdFiles = listUrd(ctx);
      const commitById = new Map();
      for (const c of reg.commits) commitById.set(c.sha, c);
      let urdCommits = [];
      try { urdCommits = git.listCommits(10, ctx.urdDir); } catch (_e) {}
      const impact = urdFiles.map((f) => {
        const urdReqs = reg.requirements.filter((r) => r.urdFile && r.urdFile.endsWith(f.name));
        return {
          file: f.name,
          requirementCount: urdReqs.length,
          requirements: urdReqs.map((r) => {
            const reqCommits = (r.commits || []).map((sc) => commitById.get(sc.sha)).filter(Boolean);
            const sourceFiles = [...new Set(reqCommits.flatMap((c) => c.changedFiles || []))];
            let hasPass = false;
            let hasFail = false;
            for (const sha of (r.commits || [])) {
              const commit = commitById.get(sha);
              if (commit && commit.requirements) {
                const res = commit.requirements.find((x) => x.id === r.id);
                if (res) {
                  if (res.verdict === 'PASS') hasPass = true;
                  if (res.verdict === 'FAIL') hasFail = true;
                }
              }
            }
            const status = !r.commits || !r.commits.length ? 'chưa code' : hasPass ? 'OK' : hasFail ? 'có FAIL' : 'đang làm';
            return {
              id: r.id, title: r.title, status,
              sourceFiles,
              commitCount: (r.commits || []).length,
              hasFail: hasFail && !hasPass,
            };
          }),
        };
      });
      return json(res, 200, { urdFiles: impact, urdCommits });
    }
    default:
      if (pathname.startsWith('/api/check/')) {
        const sha = pathname.replace('/api/check/', '');
        const result = await checkCommit(sha, { root: ctx.root, urdDir: ctx.urdDir });
        if (result.error) return json(res, 400, result);
        const reg = db.load(ctx.registryFile);
        db.upsertCommit(reg, result);
        db.save(reg, ctx.registryFile);
        return json(res, 200, result);
      }
      if (pathname.startsWith('/api/docs/')) {
        const name = pathname.replace('/api/docs/', '');
        const file = path.join(ctx.usageDir, name);
        const text = readText(file);
        if (!text) return json(res, 404, { error: 'doc not found' });
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        return res.end(text);
      }
      if (pathname.startsWith('/api/urd/')) {
        const name = pathname.replace('/api/urd/', '');
        const file = path.join(ctx.urdDir, name);
        const text = readText(file);
        if (!text) return json(res, 404, { error: 'urd not found' });
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        return res.end(text);
      }
      return json(res, 404, { error: `unknown api path: ${pathname}` });
  }
}

function handleStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': (types[ext] || 'text/plain') + '; charset=utf-8' });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

async function handleUploadUrd(req, res, ctx) {
  try {
    const body = JSON.parse(await readBody(req));
    const name = (body.name || '').trim();
    const content = body.content || '';
    if (!name || !content) return json(res, 400, { error: 'Thiếu tên file hoặc nội dung' });
    if (!name.endsWith('.md')) return json(res, 400, { error: 'File phải có đuôi .md' });
    ensureDir(ctx.urdDir);
    const safeName = name.replace(/[\\/]/g, '');
    const filePath = path.join(ctx.urdDir, safeName);
    fs.writeFileSync(filePath, content, 'utf8');
    const reg = db.load(ctx.registryFile);
    const urds = loadAllUrd(ctx.urdDir);
    const reqs = flattenRequirements(urds);
    db.syncRequirements(reg, reqs);
    db.save(reg, ctx.registryFile);
    const newUrds = urds.filter((u) => u.file.endsWith(safeName));
    return json(res, 200, { saved: safeName, requirements: reqs.length, urd: newUrds[0] || null });
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
}

async function handleReviewUrd(req, res, ctx) {
  try {
    const body = JSON.parse(await readBody(req));
    const content = body.content || '';
    if (!content) return json(res, 400, { error: 'Thiếu nội dung URD' });
    const review = await llm.reviewUrd(content);
    return json(res, 200, review);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
}

async function handleCheckStaged(req, res, ctx) {
  try {
    const body = JSON.parse(await readBody(req));
    const result = await checkStaged(body.diff || '', body.message || '', { root: ctx.root, urdDir: ctx.urdDir });
    return json(res, 200, result);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
}

async function handleCloneProject(req, res) {
  try {
    const body = JSON.parse(await readBody(req));
    const { name, gitUrl, urdGitUrl, checkMode } = body;
    if (!name || !gitUrl) return json(res, 400, { error: 'Thiếu tên dự án hoặc git URL' });
    const projectsDir = process.env.PROJECTS_DIR || path.join(__dirname, '..', 'projects');
    ensureDir(projectsDir);
    const targetPath = path.join(projectsDir, name);
    if (fs.existsSync(targetPath)) return json(res, 400, { error: `Thư mục đã tồn tại: ${targetPath}` });
    execSync(`git clone --depth 1 "${gitUrl}" "${targetPath}"`, { stdio: 'ignore', timeout: 60000 });
    let urdPath = null;
    if (urdGitUrl) {
      urdPath = path.join(projectsDir, name + '-urd');
      try { execSync(`git clone --depth 1 "${urdGitUrl}" "${urdPath}"`, { stdio: 'ignore', timeout: 60000 }); }
      catch (_e) { urdPath = null; }
    }
    const rec = projects.addProject(name, targetPath, urdPath || undefined);
    if (checkMode) { try { projects.updateProject(name, { checkMode }); } catch (_e) {} }
    if (urdGitUrl) { try { projects.updateProject(name, { gitUrl: gitUrl, urdGitUrl: urdGitUrl }); } catch (_e) {} }
    else { try { projects.updateProject(name, { gitUrl: gitUrl }); } catch (_e) {} }
    return json(res, 200, rec);
  } catch (e) {
    return json(res, 400, { error: 'Clone thất bại: ' + e.message });
  }
}

async function handleStandardizeUrd(req, res, ctx) {
  try {
    const body = JSON.parse(await readBody(req));
    const content = body.content || '';
    if (!content) return json(res, 400, { error: 'Thiếu nội dung URD' });
    const result = await llm.standardizeUrd(content);
    if (result.error) return json(res, 400, { error: result.error });
    return json(res, 200, { content: result.content });
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
}

function generateHookScript(projectName, baseUrl) {
  return `#!/bin/sh
# Jarvis pre-commit/commit-msg hook — project: ${projectName}
# Cài đặt: copy file này vào .git/hooks/commit-msg và chmod +x
MSG=$(cat "$1")
DIFF=$(git diff --cached)
if [ -z "$DIFF" ]; then
  echo "Jarvis: Không có thay đổi staged, bỏ qua kiểm tra."
  exit 0
fi
RESULT=$(curl -s -X POST "${baseUrl}/api/check/staged?project=${projectName}" \\
  -H "Content-Type: application/json" \\
  -d "$(printf '%s' "$DIFF" | jq -Rs '{diff: ., message: "'"$MSG"'"}')")
OK=$(echo "$RESULT" | jq -r '.ok // true')
if [ "$OK" = "false" ]; then
  echo ""
  echo "❌ Jarvis: Commit BỊ CHẶN — code không khớp URD"
  echo "$RESULT" | jq -r '.notes[]? | select(.level!="info") | "  ⚠️ " + .message'
  echo ""
  echo "Sửa code hoặc đổi commit message rồi thử lại."
  echo "Bỏ qua: git commit --no-verify"
  exit 1
fi
echo "✅ Jarvis: Commit PASS — code khớp URD"
`;
}

function createServer(opts = {}) {
  const port = typeof opts === 'number' ? opts : (opts.port || 7171);
  if (opts.projectsDir) projects.syncDiscovered(opts.projectsDir);
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const query = parsed.query;
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'healthy', ts: Date.now() }));
    }
    if (pathname === '/api/guide') {
      const guidePath = path.join(ROOT, 'docs', 'huong-dan-su-dung.md');
      const text = readText(guidePath);
      if (!text) return json(res, 404, { error: 'guide not found' });
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      return res.end(text);
    }
    if (pathname === '/api/projects' && req.method === 'GET') {
      const ctx = makeCtx(query.project);
      return handleApi(req, res, '/api/projects', query, ctx);
    }
    if (pathname === '/api/projects' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { name, path: ppath, urdPath } = JSON.parse(body);
          const rec = projects.addProject(name, ppath, urdPath);
          return json(res, 200, rec);
        } catch (e) { return json(res, 400, { error: e.message }); }
      });
      return;
    }
    if (pathname === '/api/projects/clone' && req.method === 'POST') {
      return handleCloneProject(req, res);
    }
    if (pathname.startsWith('/api/projects/') && req.method === 'DELETE') {
      const name = decodeURIComponent(pathname.replace('/api/projects/', ''));
      projects.removeProject(name);
      return json(res, 200, { removed: name });
    }
    if (pathname.startsWith('/api/projects/') && req.method === 'PATCH') {
      const name = decodeURIComponent(pathname.replace('/api/projects/', '').replace('/mode', ''));
      (async () => {
        try {
          const body = JSON.parse(await readBody(req));
          const rec = projects.updateProject(name, body);
          return json(res, 200, rec);
        } catch (e) { return json(res, 400, { error: e.message }); }
      })();
      return;
    }
    if (pathname.startsWith('/api/projects/') && pathname.endsWith('/hook') && req.method === 'GET') {
      const name = decodeURIComponent(pathname.replace('/api/projects/', '').replace('/hook', ''));
      const p = projects.findProject(name);
      if (!p) return json(res, 404, { error: 'project not found' });
      const host = req.headers.host || 'localhost:8080';
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const baseUrl = `${proto}://${host}`;
      const hook = generateHookScript(name, baseUrl);
      res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Content-Disposition': `attachment; filename="commit-msg"` });
      return res.end(hook);
    }
    const ctx = makeCtx(query.project);
    if (!ctx) return json(res, 400, { error: 'no projects configured. POST /api/projects {name,path} or set PROJECTS_DIR.' });
    if (req.method === 'POST' && pathname === '/api/generate-docs') return handleApi(req, res, '/api/generate-docs', query, ctx);
    if (req.method === 'POST' && pathname === '/api/check/recent') return handleApi(req, res, '/api/check/recent', query, ctx);
    if (req.method === 'POST' && pathname === '/api/check/all') return handleApi(req, res, '/api/check/all', query, ctx);
    if (req.method === 'POST' && pathname === '/api/check/staged') return handleCheckStaged(req, res, ctx);
    if (req.method === 'POST' && pathname === '/api/urd') return handleUploadUrd(req, res, ctx);
    if (req.method === 'POST' && pathname === '/api/urd/review') return handleReviewUrd(req, res, ctx);
    if (req.method === 'POST' && pathname === '/api/urd/standardize') return handleStandardizeUrd(req, res, ctx);
    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname, query, ctx);
    return handleStatic(req, res, pathname);
  });
  server.listen(port, () => {
    const list = projects.loadProjects();
    console.log(`[urd-guardian] dashboard on http://localhost:${port} (${list.length} projects)`);
    for (const p of list) console.log(`[urd-guardian]   - ${p.name} -> ${p.path}`);
  });
  return server;
}

module.exports = { createServer, makeCtx, syncRegistry };
