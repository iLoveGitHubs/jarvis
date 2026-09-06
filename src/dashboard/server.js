'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { ROOT, DEFAULT_DIRS, readText, rel } = require('../store/fs-utils');
const db = require('../store/db');
const { loadAllUrd, flattenRequirements } = require('../agent/urd-reader');
const { checkCommit, checkRecent, checkHead } = require('../agent/commit-checker');
const { generateAll } = require('../agent/doc-generator');
const { snapshotAll } = require('../agent/version-manager');
const git = require('../agent/git-reader');

const PUBLIC_DIR = path.join(__dirname, 'public');

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function syncRegistry() {
  const reg = db.load();
  const urds = loadAllUrd();
  const reqs = flattenRequirements(urds);
  db.syncRequirements(reg, reqs);
  db.save(reg);
  return reg;
}

function handleApi(req, res, pathname, query) {
  switch (pathname) {
    case '/api/registry': {
      const reg = syncRegistry();
      return json(res, 200, db.dashboardView(reg));
    }
    case '/api/requirements': {
      const reg = syncRegistry();
      return json(res, 200, db.dashboardView(reg).requirements);
    }
    case '/api/commits': {
      const reg = syncRegistry();
      return json(res, 200, db.dashboardView(reg).commits);
    }
    case '/api/git/commits': {
      return json(res, 200, git.listCommits(parseInt(query.limit || '50', 10)));
    }
    case '/api/git/status': {
      return json(res, 200, { isRepo: git.isRepo(), head: git.headSha(), branch: git.branches(), status: git.statusPorcelain() });
    }
    case '/api/check/head': {
      const result = checkHead();
      if (result.error) return json(res, 400, result);
      const reg = db.load();
      db.upsertCommit(reg, result);
      db.save(reg);
      return json(res, 200, result);
    }
    case '/api/check/recent': {
      const results = checkRecent(parseInt(query.limit || '10', 10));
      const reg = db.load();
      for (const r of results) db.upsertCommit(reg, r);
      db.save(reg);
      return json(res, 200, results);
    }
    case '/api/generate-docs': {
      const result = generateAll();
      return json(res, 200, result);
    }
    case '/api/snapshot': {
      const snap = snapshotAll();
      const reg = db.load();
      reg.urdVersions = snap.urd;
      reg.docVersions = snap.usage;
      reg.sourceVersions = [snap.source];
      db.save(reg);
      return json(res, 200, snap);
    }
    default:
      if (pathname.startsWith('/api/check/')) {
        const sha = pathname.replace('/api/check/', '');
        const result = checkCommit(sha);
        if (result.error) return json(res, 400, result);
        const reg = db.load();
        db.upsertCommit(reg, result);
        db.save(reg);
        return json(res, 200, result);
      }
      if (pathname.startsWith('/api/docs/')) {
        const name = pathname.replace('/api/docs/', '');
        const file = path.join(DEFAULT_DIRS.usage, name);
        const text = readText(file);
        if (!text) return json(res, 404, { error: 'doc not found' });
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

function createServer(port = 7171) {
  syncRegistry();
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    if (req.method === 'POST' && pathname === '/api/snapshot') return handleApi(req, res, '/api/snapshot', parsed.query);
    if (req.method === 'POST' && pathname === '/api/generate-docs') return handleApi(req, res, '/api/generate-docs', parsed.query);
    if (req.method === 'POST' && pathname === '/api/check/recent') return handleApi(req, res, '/api/check/recent', parsed.query);
    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname, parsed.query);
    return handleStatic(req, res, pathname);
  });
  server.listen(port, () => {
    console.log(`[urd-guardian] dashboard on http://localhost:${port}`);
    console.log(`[urd-guardian] docs/urd   -> ${rel(DEFAULT_DIRS.urd)}`);
    console.log(`[urd-guardian] docs/usage -> ${rel(DEFAULT_DIRS.usage)}`);
  });
  return server;
}

module.exports = { createServer };
