'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_DIRS, ensureDir, readJson, writeJson } = require('./fs-utils');

const PROJECTS_FILE = path.join(DEFAULT_DIRS.data, 'projects.json');
const REGISTRY_DIR = path.join(DEFAULT_DIRS.data, 'registries');

function registryFileFor(name) {
  ensureDir(REGISTRY_DIR);
  return path.join(REGISTRY_DIR, `${name}.json`);
}

function loadProjects() {
  return readJson(PROJECTS_FILE, []);
}

function saveProjects(list) {
  writeJson(PROJECTS_FILE, list);
}

function findProject(name) {
  return loadProjects().find((p) => p.name === name);
}

function addProject(name, projectPath, urdPath) {
  if (!name || !projectPath) throw new Error('name and path required');
  const list = loadProjects();
  if (list.find((p) => p.name === name)) throw new Error(`project "${name}" already exists`);
  if (!fs.existsSync(projectPath)) throw new Error(`path does not exist: ${projectPath}`);
  const record = { name, path: projectPath, addedAt: new Date().toISOString() };
  if (urdPath) record.urdPath = urdPath;
  record.checkMode = 'post';
  list.push(record);
  saveProjects(list);
  return record;
}

function updateProject(name, updates) {
  const list = loadProjects();
  const p = list.find((x) => x.name === name);
  if (!p) throw new Error(`project "${name}" not found`);
  if (updates.checkMode && !['pre', 'post', 'both'].includes(updates.checkMode)) {
    throw new Error('checkMode must be pre, post, or both');
  }
  Object.assign(p, updates);
  saveProjects(list);
  return p;
}

function removeProject(name) {
  const list = loadProjects().filter((p) => p.name !== name);
  saveProjects(list);
  try { fs.unlinkSync(registryFileFor(name)); } catch (_e) {}
  return true;
}

function discoverProjects(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const urdDir = path.join(dir, entry.name, 'docs', 'urd');
    if (fs.existsSync(urdDir)) found.push({ name: entry.name, path: path.join(dir, entry.name) });
  }
  return found;
}

function syncDiscovered(dir) {
  const discovered = discoverProjects(dir);
  const list = loadProjects();
  for (const d of discovered) {
    if (!list.find((p) => p.name === d.name)) {
      list.push({ name: d.name, path: d.path, addedAt: new Date().toISOString(), discovered: true });
    }
  }
  saveProjects(list);
  return list;
}

module.exports = { PROJECTS_FILE, REGISTRY_DIR, registryFileFor, loadProjects, saveProjects, findProject, addProject, updateProject, removeProject, discoverProjects, syncDiscovered };
