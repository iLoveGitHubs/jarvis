'use strict';

const path = require('path');
const { flattenRequirements, loadAllUrd } = require('./urd-reader');
const git = require('./git-reader');
const llm = require('./llm-checker');
const { DEFAULT_DIRS } = require('../store/fs-utils');

function parseClaimedRequirements(subject, body = '') {
  const text = `${subject}\n${body}`;
  const ids = new Set();
  const re = /(?:REQ|CR)-[A-Za-z0-9-]+/g;
  let m;
  while ((m = re.exec(text))) ids.add(m[0]);
  return [...ids];
}

async function checkCommit(sha, opts = {}) {
  const root = opts.root;
  const urdDir = opts.urdDir || (root ? path.join(root, 'docs', 'urd') : DEFAULT_DIRS.urd);
  const urds = loadAllUrd(urdDir);
  const requirements = flattenRequirements(urds);
  const reqById = new Map(requirements.map((r) => [r.id, r]));

  const info = git.commitInfo(sha, root);
  const changedFiles = info.changedFiles.map((c) => c.file);
  const diff = (info.fullDiff || git.diffFor(sha, root) || '').slice(0, 8000);
  const claimed = parseClaimedRequirements(info.subject, info.body);

  const notes = [];
  const reqResults = [];

  if (!claimed.length && changedFiles.length) {
    notes.push({
      level: 'warn',
      type: 'no-claim',
      message: 'Commit changes code but references no REQ-ID. Use "Req: REQ-001" in the commit message.',
    });
  }

  for (const reqId of claimed) {
    const req = reqById.get(reqId);
    if (!req) {
      notes.push({ level: 'error', type: 'unknown-requirement', message: `Claimed ${reqId} not found in any URD document.` });
      reqResults.push({ id: reqId, title: '(unknown)', verdict: 'FAIL', summary: `Requirement ${reqId} not found in URD`, criteria: [] });
      continue;
    }
    const verdict = await llm.checkRequirement(req, diff);
    reqResults.push({
      id: req.id,
      title: req.title,
      urdId: req.urdId,
      verdict: verdict.overall,
      summary: verdict.summary,
      criteria: verdict.criteria,
    });
    if (verdict.overall === 'FAIL') {
      const failed = verdict.criteria.filter((c) => c.verdict === 'FAIL').map((c) => c.criterion).join(', ');
      notes.push({ level: 'error', type: 'requirement-not-satisfied', message: `${req.id} (${req.title}): FAIL${failed ? ` on ${failed}` : ''}. ${verdict.summary || ''}` });
    } else if (verdict.overall === 'PASS') {
      notes.push({ level: 'info', type: 'requirement-satisfied', message: `${req.id} (${req.title}): PASS. ${verdict.summary || ''}` });
    } else {
      notes.push({ level: 'warn', type: 'llm-unchecked', message: `${req.id}: ${verdict.summary || 'LLM check unavailable'}` });
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
    requirements: reqResults,
    notes,
    ok,
    checkedAt: new Date().toISOString(),
  };
}

async function checkHead(opts = {}) {
  const sha = git.headSha(opts.root);
  if (!sha) return { error: 'Not a git repo or no commits yet.' };
  return checkCommit(sha, opts);
}

async function checkRecent(limit = 10, opts = {}) {
  const commits = git.listCommits(limit, opts.root);
  const results = [];
  for (const c of commits) {
    results.push(await checkCommit(c.sha, opts));
  }
  return results;
}

async function checkStaged(diff, message, opts = {}) {
  const root = opts.root;
  const urdDir = opts.urdDir || (root ? path.join(root, 'docs', 'urd') : DEFAULT_DIRS.urd);
  const urds = loadAllUrd(urdDir);
  const requirements = flattenRequirements(urds);
  const reqById = new Map(requirements.map((r) => [r.id, r]));

  const claimed = parseClaimedRequirements(message, '');
  const truncatedDiff = (diff || '').slice(0, 8000);
  const notes = [];
  const reqResults = [];

  if (!claimed.length && truncatedDiff.length) {
    notes.push({ level: 'warn', type: 'no-claim', message: 'Commit chưa tham chiếu REQ-ID nào. Thêm "Req: REQ-001" vào commit message.' });
  }

  for (const reqId of claimed) {
    const req = reqById.get(reqId);
    if (!req) {
      notes.push({ level: 'error', type: 'unknown-requirement', message: `Claim ${reqId} không có trong URD.` });
      reqResults.push({ id: reqId, title: '(không rõ)', verdict: 'FAIL', summary: `Yêu cầu ${reqId} không có trong URD`, criteria: [] });
      continue;
    }
    const verdict = await llm.checkRequirement(req, truncatedDiff);
    reqResults.push({ id: req.id, title: req.title, urdId: req.urdId, verdict: verdict.overall, summary: verdict.summary, criteria: verdict.criteria });
    if (verdict.overall === 'FAIL') {
      const failed = verdict.criteria.filter((c) => c.verdict === 'FAIL').map((c) => c.criterion).join(', ');
      notes.push({ level: 'error', type: 'requirement-not-satisfied', message: `${req.id} (${req.title}): FAIL${failed ? ` ở ${failed}` : ''}. ${verdict.summary || ''}` });
    } else if (verdict.overall === 'PASS') {
      notes.push({ level: 'info', type: 'requirement-satisfied', message: `${req.id} (${req.title}): PASS. ${verdict.summary || ''}` });
    } else {
      notes.push({ level: 'warn', type: 'llm-unchecked', message: `${req.id}: ${verdict.summary || 'LLM không khả dụng'}` });
    }
  }

  const ok = notes.every((n) => n.level !== 'error');
  return { staged: true, claimedRequirementIds: claimed, requirements: reqResults, notes, ok };
}

module.exports = { checkCommit, checkHead, checkRecent, checkStaged, parseClaimedRequirements };
