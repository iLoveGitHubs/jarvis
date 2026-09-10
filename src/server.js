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
    const results = await checkRecent(8, { root: ctx.root, urdDir: ctx.urdDir });
    for (const r of results) db.upsertCommit(reg, r);
    db.save(reg, ctx.registryFile);
    console.log(`[urd-guardian] ${name}: ${reqs.length} requirements, ${results.length} commits checked (LLM)`);
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
