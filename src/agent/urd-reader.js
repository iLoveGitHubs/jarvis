'use strict';

const fs = require('fs');
const path = require('path');
const { listFiles, readText, rel, DEFAULT_DIRS } = require('../store/fs-utils');

function parseFrontmatter(text) {
  const fm = {};
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { frontmatter: fm, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > -1) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter: fm, body: text.slice(m[0].length).replace(/^\r?\n/, '') };
}

function parseRequirementSection(body, headingLine) {
  const lines = body.split(/\r?\n/);
  const start = lines.indexOf(headingLine);
  if (start < 0) return null;
  const idMatch = headingLine.match(/###\s+((?:REQ|CR)-[A-Za-z0-9-]+)/);
  const id = idMatch ? idMatch[1] : null;
  const title = headingLine.replace(/^###\s+/, '').replace(/(?:REQ|CR)-[A-Za-z0-9-]+\s*:\s*/, '');

  const section = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###\s/.test(lines[i]) || /^##\s/.test(lines[i])) break;
    section.push(lines[i]);
  }
  const sectionText = section.join('\n');

  const acceptanceCriteria = [];
  const affectedFiles = [];
  const tags = [];

  for (const line of section) {
    const ac = line.match(/^\s*[-*]\s*(AC\d+[^\n]*)/i);
    if (ac) acceptanceCriteria.push(ac[1].trim());
    const f = line.match(/^\s*[-*]\s+`?([^\s`]+)`?\s*$/);
    if (f && /\.[a-z0-9]+$/i.test(f[1])) affectedFiles.push(f[1]);
    const t = line.match(/^\s*\*\*Tags?:\*\*\s*(.+)$/i);
    if (t) tags.push(...t[1].split(',').map((s) => s.trim()));
  }

  const descMatch = sectionText.match(/(?:^|\n)\s*([^-\n*#\n].+?)(?=\n\s*\*\*Acceptance|\n\s*\*\*Affected|\n\s*\*\*Tags|\n###|\n##|$)/s);
  const description = descMatch ? descMatch[1].trim() : '';

  return { id, title, description, acceptanceCriteria, affectedFiles, tags };
}

function parseUrdFile(file) {
  const text = readText(file);
  const { frontmatter, body } = parseFrontmatter(text);
  const requirements = [];
  const headingRe = /^###\s+(?:REQ|CR)-[A-Za-z0-9-]+/m;
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    if (headingRe.test(line)) {
      const req = parseRequirementSection(body, line);
      if (req && req.id) requirements.push(req);
    }
  }
  const id = frontmatter.id || path.basename(file, '.md');
  return {
    id,
    title: frontmatter.title || (body.match(/^#\s+(.*)/)?.[1] || id),
    version: frontmatter.version || '0.1.0',
    status: frontmatter.status || 'draft',
    file: rel(file),
    requirements,
    raw: text,
  };
}

function loadAllUrd(dir = DEFAULT_DIRS.urd) {
  const files = listFiles(dir, ['.md']);
  return files.map(parseUrdFile);
}

function flattenRequirements(urds) {
  const out = [];
  for (const urd of urds) {
    for (const req of urd.requirements) {
      out.push({
        id: req.id,
        urdId: urd.id,
        urdVersion: urd.version,
        urdFile: urd.file,
        title: req.title,
        description: req.description,
        acceptanceCriteria: req.acceptanceCriteria,
        affectedFiles: req.affectedFiles,
        tags: req.tags,
        status: urd.status,
      });
    }
  }
  return out;
}

module.exports = { parseFrontmatter, parseUrdFile, loadAllUrd, flattenRequirements };
