'use strict';

const path = require('path');
const { flattenRequirements, loadAllUrd } = require('./urd-reader');
const git = require('./git-reader');
const { DEFAULT_DIRS } = require('../store/fs-utils');

function parseClaimedRequirements(subject, body = '') {
  const text = `${subject}\n${body}`;
  const ids = new Set();
  const re = /REQ-[A-Za-z0-9-]+/g;
  let m;
  while ((m = re.exec(text))) ids.add(m[0]);
  return [...ids];
}

function checkCommit(sha, opts = {}) {
  const root = opts.root;
  const urdDir = opts.urdDir || (root ? path.join(root, 'docs', 'urd') : DEFAULT_DIRS.urd);
  const urds = loadAllUrd(urdDir);
  const requirements = flattenRequirements(urds);
  const reqByFile = new Map();
  for (const req of requirements) {
    for (const f of req.affectedFiles) {
      if (!reqByFile.has(f)) reqByFile.set(f, []);
      reqByFile.get(f).push(req.id);
    }
  }

  const info = git.commitInfo(sha, root);
  const changedFiles = info.changedFiles.map((c) => c.file);
  const claimed = parseClaimedRequirements(info.subject, info.body);

  const matchedRequirements = new Set();
  const extraFiles = [];
  const fileToReqs = {};

  for (const file of changedFiles) {
    const reqs = reqByFile.get(file) || reqByFile.get(normalizePath(file)) || [];
    fileToReqs[file] = reqs;
    if (reqs.length) reqs.forEach((r) => matchedRequirements.add(r));
    else extraFiles.push(file);
  }

  const claimedSet = new Set(claimed);
  const missingRequirements = [...claimedSet].filter((r) => !matchedRequirements.has(r));

  const orphanRequirements = requirements
    .filter((r) => !matchedRequirements.has(r))
    .map((r) => r.id);

  const notes = [];
  for (const file of extraFiles) {
    notes.push({
      level: 'warn',
      type: 'extra-change',
      message: `File "${file}" was changed but is not listed under any URD requirement's affected files.`,
    });
  }
  for (const id of missingRequirements) {
    notes.push({
      level: 'error',
      type: 'missing-requirement',
      message: `Commit claims "${id}" but none of that requirement's affected files were changed.`,
    });
  }
  if (!claimed.length && changedFiles.length) {
    notes.push({
      level: 'warn',
      type: 'no-claim',
      message: 'Commit message does not reference any REQ-ID. Use "Req: REQ-001" or "[REQ-001]" in the message.',
    });
  }
  for (const req of requirements) {
    const touched = req.affectedFiles.some((f) => changedFiles.includes(f) || changedFiles.includes(normalizePath(f)));
    if (claimedSet.has(req.id) && !touched) {
      notes.push({
        level: 'warn',
        type: 'incomplete-requirement',
        message: `Requirement "${req.id}" (${req.title}) is claimed but 0/${req.affectedFiles.length} affected files were touched.`,
      });
    }
  }

  const ok = notes.every((n) => n.level !== 'error');

  return {
    sha,
    shortSha: git.shortSha(sha),
    subject: info.subject,
    author: info.author,
    date: info.date,
    claimedRequirementIds: claimed,
    changedFiles,
    fileToReqs,
    matchedRequirements: [...matchedRequirements],
    extraFiles,
    missingRequirements,
    orphanRequirements,
    notes,
    ok,
    checkedAt: new Date().toISOString(),
  };
}

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function checkHead(opts = {}) {
  const sha = git.headSha(opts.root);
  if (!sha) return { error: 'Not a git repo or no commits yet.' };
  return checkCommit(sha, opts);
}

function checkRecent(limit = 10, opts = {}) {
  const commits = git.listCommits(limit, opts.root);
  return commits.map((c) => checkCommit(c.sha, opts));
}

module.exports = { checkCommit, checkHead, checkRecent, parseClaimedRequirements };
