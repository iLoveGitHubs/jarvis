'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { ROOT, rel } = require('../store/fs-utils');

function git(args, cwd = ROOT) {
  try {
    const out = execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim();
  } catch (_e) {
    return '';
  }
}

function isRepo(cwd = ROOT) {
  return git('rev-parse --is-inside-work-tree', cwd) === 'true';
}

function headSha(cwd = ROOT) {
  return git('rev-parse HEAD', cwd);
}

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : '';
}

function listCommits(limit = 50, cwd = ROOT) {
  const raw = git(
    `log -n ${limit} --pretty=format:%H%x1f%an%x1f%ad%x1f%s --date=iso`,
    cwd
  );
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const [sha, author, date, subject] = line.split('\x1f');
    return { sha, author, date, subject };
  });
}

function commitInfo(sha, cwd = ROOT) {
  const subject = git(`log -1 --pretty=format:%s ${sha}`, cwd);
  const author = git(`log -1 --pretty=format:%an ${sha}`, cwd);
  const date = git(`log -1 --pretty=format:%ad --date=iso ${sha}`, cwd);
  const body = git(`log -1 --pretty=format:%b ${sha}`, cwd);
  const files = changedFiles(sha, cwd);
  const diffStat = git(`diff-tree --no-commit-id --stat --root ${sha}`, cwd);
  const fullDiff = git(`diff-tree --no-commit-id -p --root ${sha}`, cwd);
  return { sha, subject, author, date, body, changedFiles: files, diffStat, fullDiff };
}

function changedFiles(sha, cwd = ROOT) {
  const raw = git(`diff-tree --no-commit-id --name-status -r --root ${sha}`, cwd);
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const parts = line.split('\t');
    const status = parts[0];
    const file = parts[parts.length - 1];
    return { status, file: file.replace(/\\/g, '/') };
  });
}

function fileAtCommit(sha, file, cwd = ROOT) {
  return git(`show ${sha}:${file}`, cwd);
}

function diffFor(sha, cwd = ROOT) {
  return git(`diff-tree --no-commit-id -p ${sha}`, cwd);
}

function branches(cwd = ROOT) {
  const raw = git('branch --list', cwd);
  return raw.split('\n').map((b) => b.replace(/^\*?\s+/, '').trim()).filter(Boolean);
}

function statusPorcelain(cwd = ROOT) {
  const raw = git('status --porcelain', cwd);
  if (!raw) return [];
  return raw.split('\n').map((line) => ({
    xy: line.slice(0, 2),
    file: line.slice(3).trim(),
  }));
}

module.exports = {
  git,
  isRepo,
  headSha,
  shortSha,
  listCommits,
  commitInfo,
  changedFiles,
  fileAtCommit,
  diffFor,
  branches,
  statusPorcelain,
};
