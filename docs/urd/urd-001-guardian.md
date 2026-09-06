---
id: URD-001
title: URD Guardian Core Agent
version: 1.0.0
status: active
---

# URD-001: URD Guardian Core Agent

An AI agent that reads git, source code, and URD markdown documents to verify that
commits satisfy the documented requirements, and to generate usage documentation.

## Requirements

### REQ-001: Read git history and commit diffs
The agent must read commit metadata (sha, author, date, subject, body) and the list
of files changed by a commit, plus the full diff.

**Acceptance Criteria:**
- AC1: Given a commit sha, the agent returns subject, author, date, and changed files
- AC2: The agent can list recent commits with a configurable limit
- AC3: The agent reports the working-tree status when available

**Affected Files:**
- src/agent/git-reader.js

### REQ-002: Parse URD markdown documents
The agent must parse URD markdown files with YAML frontmatter (id, title, version,
status) and one `### REQ-xxx` section per requirement, extracting title, description,
acceptance criteria, affected files, and tags.

**Acceptance Criteria:**
- AC1: Frontmatter fields id, title, version, status are parsed
- AC2: Each REQ section yields id, title, acceptanceCriteria, affectedFiles, tags
- AC3: All URD files under docs/urd are loaded and flattened into a requirement list

**Affected Files:**
- src/agent/urd-reader.js

### REQ-003: Check a commit against URD requirements
Given a commit, the agent maps changed files to URD requirements and reports
matched requirements, extra files (changed but not in any requirement), missing
requirements (claimed but not touched), and mismatch notes (warnings/errors).

**Acceptance Criteria:**
- AC1: Claimed REQ-IDs are parsed from the commit message
- AC2: Files changed but not listed in any requirement are flagged as extra-change
- AC3: Claimed requirements with no affected files touched are flagged as missing
- AC4: Commits with no REQ reference trigger a no-claim warning
- AC5: The check result has an ok flag that is false when any error note exists

**Affected Files:**
- src/agent/commit-checker.js

### REQ-004: Generate usage documentation from source code
The agent scans source files, extracts symbols (functions, classes, endpoints),
and writes per-module markdown plus an index to docs/usage.

**Acceptance Criteria:**
- AC1: JavaScript/TypeScript functions, arrow functions, classes, and express routes are extracted
- AC2: Python def and class symbols are extracted
- AC3: A per-module markdown file and an index.md are written to docs/usage

**Affected Files:**
- src/agent/doc-generator.js
- src/agent/source-reader.js

### REQ-005: Manage versions of URD, docs, and source
The agent snapshots URD documents, generated usage docs, and the current source
git SHA into data/snapshots so any version can be recalled by an AI agent.

**Acceptance Criteria:**
- AC1: URD snapshots are written with a content hash and git SHA
- AC2: Usage doc snapshots are written with a content hash
- AC3: The source version records the current git HEAD and branch

**Affected Files:**
- src/agent/version-manager.js

### REQ-006: Serve a web dashboard
A dashboard lists all requirements with their linked commits and mismatch notes,
and lists checked commits with pass/fail status and notes.

**Acceptance Criteria:**
- AC1: GET /api/registry returns requirements with commits and notes
- AC2: The dashboard HTML renders requirement cards and commit cards
- AC3: POST /api/check/recent checks recent commits and stores results

**Affected Files:**
- src/dashboard/server.js
- src/dashboard/public/index.html

### REQ-007: Persist a registry of requirements, commits, and notes
A JSON registry links requirements to commits and stores check results so the
dashboard and CLI share state.

**Acceptance Criteria:**
- AC1: Requirements are upserted and linked to matching commit shas
- AC2: Commit check results are upserted by sha
- AC3: A dashboard view joins requirements with their commits and notes

**Affected Files:**
- src/store/db.js
