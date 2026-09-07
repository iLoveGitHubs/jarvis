#!/usr/bin/env node
'use strict';

const path = require('path');
const { DEFAULT_DIRS, ensureDir } = require('./store/fs-utils');
const db = require('./store/db');
const { loadAllUrd, flattenRequirements } = require('./agent/urd-reader');
const { checkCommit, checkHead, checkRecent } = require('./agent/commit-checker');
const { generateAll } = require('./agent/doc-generator');
const { snapshotAll, bumpVersion } = require('./agent/version-manager');
const git = require('./agent/git-reader');
const { createServer } = require('./dashboard/server');

function usage() {
  return `
urd-guardian — AI agent that guards commits against URD requirements.

Usage:
  urd-guardian <command> [args]

Commands:
  dashboard [port]            Start web dashboard (default port 7171)
  check [sha|head|recent]     Check a commit against URD. Default: head.
                              "recent" checks last 10 commits.
  generate-docs               Generate usage markdown from source code.
  snapshot                    Snapshot URD + usage docs + source version.
  list-urd                    List parsed URD requirements.
  list-commits [limit]        Show recent git commits.
  sync                        Sync URD requirements into registry.
  init                        Create docs/urd, docs/usage, data dirs.
  help                        Show this help.

URD commit convention:
  Reference requirements in commit messages with "Req: REQ-001, REQ-002"
  or bracket "[REQ-001]". The checker maps changed files to requirements.

URD markdown format: see docs/urd/urd-001-example.md
`.trim();
}

function print(obj) {
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

function cmdInit() {
  ensureDir(DEFAULT_DIRS.urd);
  ensureDir(DEFAULT_DIRS.usage);
  ensureDir(DEFAULT_DIRS.data);
  ensureDir(DEFAULT_DIRS.snapshots);
  console.log('Created dirs: docs/urd, docs/usage, data, data/snapshots');
}

function cmdSync() {
  const reg = db.load();
  const reqs = flattenRequirements(loadAllUrd());
  db.syncRequirements(reg, reqs);
  db.save(reg);
  console.log(`Synced ${reqs.length} requirements into registry.`);
}

function cmdCheck(arg, root) {
  const opts = root ? { root } : {};
  if (!arg || arg === 'head') {
    const r = checkHead(opts);
    if (r.error) return console.error(r.error);
    recordCheck(r, opts);
    print(r);
  } else if (arg === 'recent') {
    const results = checkRecent(10, opts);
    for (const r of results) recordCheck(r, opts);
    print(results);
  } else {
    const r = checkCommit(arg, opts);
    if (r.error) return console.error(r.error);
    recordCheck(r, opts);
    print(r);
  }
}

function recordCheck(check, opts = {}) {
  const reg = db.load();
  const reqs = flattenRequirements(loadAllUrd(opts.root ? path.join(opts.root, 'docs', 'urd') : undefined));
  db.syncRequirements(reg, reqs);
  db.upsertCommit(reg, check);
  db.save(reg);
}

function cmdListUrd() {
  const urds = loadAllUrd();
  for (const urd of urds) {
    console.log(`\n${urd.id} v${urd.version} [${urd.status}] — ${urd.title}  (${urd.file})`);
    for (const req of urd.requirements) {
      console.log(`  ${req.id}: ${req.title}`);
      for (const ac of req.acceptanceCriteria) console.log(`    - ${ac}`);
      if (req.affectedFiles.length) console.log(`    files: ${req.affectedFiles.join(', ')}`);
    }
  }
  if (!urds.length) console.log('No URD documents found in', DEFAULT_DIRS.urd);
}

function cmdListCommits(limit) {
  if (!git.isRepo()) return console.error('Not a git repository.');
  const commits = git.listCommits(parseInt(limit || '20', 10));
  for (const c of commits) console.log(`${c.sha.slice(0, 7)}  ${c.date}  ${c.author}  ${c.subject}`);
}

function cmdGenerateDocs() {
  const result = generateAll();
  console.log(`Generated ${result.moduleCount} module docs → ${DEFAULT_DIRS.usage}`);
  for (const f of result.files) console.log(`  ${f}`);
}

function cmdSnapshot() {
  const snap = snapshotAll();
  const reg = db.load();
  reg.urdVersions = snap.urd;
  reg.docVersions = snap.usage;
  reg.sourceVersions = [snap.source];
  db.save(reg);
  console.log('Snapshot complete:');
  print(snap);
}

function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(usage());
      break;
    case 'init':
      cmdInit();
      break;
    case 'sync':
      cmdSync();
      break;
    case 'dashboard':
      createServer(parseInt(rest[0] || '7171', 10));
      break;
    case 'check': {
      let root;
      const filtered = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--root') { root = rest[++i]; } else { filtered.push(rest[i]); }
      }
      cmdCheck(filtered[0], root);
      break;
    }
    case 'list-urd':
      cmdListUrd();
      break;
    case 'list-commits':
      cmdListCommits(rest[0]);
      break;
    case 'generate-docs':
      cmdGenerateDocs();
      break;
    case 'snapshot':
      cmdSnapshot();
      break;
    case 'lint':
      console.log('lint: ok (no external linter configured)');
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(usage());
      process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main };
