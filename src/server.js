'use strict';

const path = require('path');
const fs = require('fs');
const { createServer, syncRegistry, makeCtx } = require('./dashboard/server');
const { checkRecent } = require('./agent/commit-checker');
const { loadAllUrd, flattenRequirements } = require('./agent/urd-reader');
const db = require('./store/db');
const projects = require('./store/projects');
const { DEFAULT_DIRS, ensureDir } = require('./store/fs-utils');

const projectsDir = process.env.PROJECTS_DIR || path.join(__dirname, '..', 'projects');
const port = parseInt(process.env.PORT || '8080', 10);

async function bootstrapProject(name) {
  try {
    const ctx = makeCtx(name);
    if (!ctx) return;
    const urds = loadAllUrd(ctx.urdDir);
    const reqs = flattenRequirements(urds);
    if (!reqs.length) { console.log(`[urd-guardian] ${name}: no URD found`); return; }
    const reg = db.load(ctx.registryFile);
    db.syncRequirements(reg, reqs);
    db.save(reg, ctx.registryFile);
    console.log(`[urd-guardian] ${name}: ${reqs.length} requirements synced, scanning ALL REQ-claiming commits...`);
    const gitReader = require('./agent/git-reader');
    const { checkCommit, parseClaimedRequirements } = require('./agent/commit-checker');
    const allCommits = gitReader.listCommits(1000, ctx.root);
    let checked = 0;
    let skipped = 0;
    for (const c of allCommits) {
      const claimed = parseClaimedRequirements(c.subject, '');
      if (!claimed.length) { skipped++; continue; }
      try {
        const result = await checkCommit(c.sha, { root: ctx.root, urdDir: ctx.urdDir });
        const regUpd = db.load(ctx.registryFile);
        db.upsertCommit(regUpd, result);
        db.save(regUpd, ctx.registryFile);
        checked++;
      } catch (_e) {}
    }
    try { projects.updateProject(name, { scanStatus: 'full' }); } catch (_e) {}
    console.log(`[urd-guardian] ${name}: ${checked} REQ-commits checked, ${skipped} skipped, ${allCommits.length} total`);
  } catch (e) {
    console.error(`[urd-guardian] bootstrap error for ${name}: ${e.message}`);
  }
}

async function bootstrap() {
  ensureDir(projectsDir);
  projects.syncDiscovered(projectsDir);
  const list = projects.loadProjects();
  console.log(`[urd-guardian] discovered ${list.length} project(s) in ${projectsDir}, checking commits in background...`);
  for (const p of list) await bootstrapProject(p.name);
  console.log(`[urd-guardian] bootstrap complete`);
}

createServer({ port, projectsDir });
bootstrap();
