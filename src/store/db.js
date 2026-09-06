'use strict';

const { readJson, writeJson, DEFAULT_DIRS } = require('./fs-utils');

function emptyRegistry() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    urdVersions: [],
    docVersions: [],
    sourceVersions: [],
    requirements: [],
    commits: [],
  };
}

function load(file = DEFAULT_DIRS.registry) {
  const reg = readJson(file, null);
  if (!reg) return emptyRegistry();
  if (!reg.requirements) reg.requirements = [];
  if (!reg.commits) reg.commits = [];
  if (!reg.urdVersions) reg.urdVersions = [];
  if (!reg.docVersions) reg.docVersions = [];
  if (!reg.sourceVersions) reg.sourceVersions = [];
  return reg;
}

function save(reg, file = DEFAULT_DIRS.registry) {
  reg.updatedAt = new Date().toISOString();
  writeJson(file, reg);
}

function upsertRequirement(reg, req) {
  const idx = reg.requirements.findIndex((r) => r.id === req.id);
  const record = {
    id: req.id,
    urdId: req.urdId,
    urdVersion: req.urdVersion,
    urdFile: req.urdFile,
    title: req.title,
    description: req.description,
    acceptanceCriteria: req.acceptanceCriteria,
    affectedFiles: req.affectedFiles,
    tags: req.tags || [],
    status: req.status || 'open',
    commits: idx > -1 ? reg.requirements[idx].commits || [] : [],
    updatedAt: new Date().toISOString(),
  };
  if (idx > -1) reg.requirements[idx] = record;
  else reg.requirements.push(record);
  return record;
}

function upsertCommit(reg, check) {
  const idx = reg.commits.findIndex((c) => c.sha === check.sha);
  const record = {
    sha: check.sha,
    shortSha: check.shortSha,
    subject: check.subject,
    author: check.author,
    date: check.date,
    claimedRequirementIds: check.claimedRequirementIds,
    changedFiles: check.changedFiles,
    matchedRequirements: check.matchedRequirements,
    extraFiles: check.extraFiles,
    missingRequirements: check.missingRequirements,
    notes: check.notes,
    ok: check.ok,
    checkedAt: check.checkedAt,
  };
  if (idx > -1) reg.commits[idx] = record;
  else reg.commits.push(record);

  for (const reqId of check.matchedRequirements) {
    const r = reg.requirements.find((x) => x.id === reqId);
    if (r) {
      if (!r.commits.includes(check.sha)) r.commits.push(check.sha);
      r.status = check.missingRequirements.includes(reqId) ? 'in-progress' : 'done';
    }
  }
  return record;
}

function syncRequirements(reg, requirements) {
  const seen = new Set();
  for (const req of requirements) {
    upsertRequirement(reg, req);
    seen.add(req.id);
  }
  reg.requirements = reg.requirements.filter((r) => seen.has(r.id) || (r.commits && r.commits.length));
  return reg.requirements;
}

function dashboardView(reg) {
  return {
    updatedAt: reg.updatedAt,
    requirements: reg.requirements.map((r) => {
      const commits = (r.commits || []).map((sha) => reg.commits.find((c) => c.sha === sha)).filter(Boolean);
      const notes = commits.flatMap((c) => (c.notes || []).map((n) => ({ ...n, commit: c.shortSha, commitSubject: c.subject })));
      return {
        id: r.id,
        urdId: r.urdId,
        urdVersion: r.urdVersion,
        title: r.title,
        status: r.status,
        affectedFiles: r.affectedFiles,
        acceptanceCriteria: r.acceptanceCriteria,
        tags: r.tags,
        commits: commits.map((c) => ({ sha: c.shortSha, subject: c.subject, ok: c.ok, date: c.date })),
        mismatchNotes: notes.filter((n) => n.level !== 'info'),
        allNotes: notes,
      };
    }),
    commits: reg.commits.map((c) => ({
      sha: c.shortSha,
      fullSha: c.sha,
      subject: c.subject,
      author: c.author,
      date: c.date,
      ok: c.ok,
      claimed: c.claimedRequirementIds,
      matched: c.matchedRequirements,
      missing: c.missingRequirements,
      extraFiles: c.extraFiles,
      noteCount: (c.notes || []).length,
      notes: c.notes,
    })),
    urdVersions: reg.urdVersions,
    docVersions: reg.docVersions,
    sourceVersions: reg.sourceVersions,
  };
}

module.exports = { emptyRegistry, load, save, upsertRequirement, upsertCommit, syncRequirements, dashboardView };
