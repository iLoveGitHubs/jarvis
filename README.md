# URD Guardian

An AI agent that keeps source code honest against **URD (User Requirements Document)**
markdown, generates usage docs from source, manages versions, and shows everything on a
web dashboard. All documents are markdown.

Built on the [GreenNode AgentBase skills](https://github.com/vngcloud/greennode-agentbase-skills)
pattern (`SKILL.md` + references + scripts). The pulled skill repo lives in `agentbase-skills/`.

## What it does

1. **Commit guard** — when a commit is checked, the agent reads git, reads the changed
   source, reads the URD markdown, and verifies the code change matches the requirements.
   It warns where source code was changed but does not match the documentation:
   - **extra-change** — a file was changed but is not listed under any requirement.
   - **missing-requirement** — the commit claims a `REQ-ID` but none of its affected files were touched.
   - **no-claim** — the commit changed code but references no requirement.
   - **incomplete-requirement** — a claimed requirement had 0 affected files touched.
2. **Doc generator** — scans source code, extracts functions/classes/endpoints, writes
   per-module usage markdown + an index to `docs/usage/`.
3. **Version manager** — snapshots URD docs, usage docs, and the source git SHA into
   `data/snapshots/` so any version can be recalled by an AI agent.
4. **Web dashboard** — lists requirements, the commits that implement each requirement,
   and notes where code does not match the docs.

## Quick start

```bash
node src/index.js init                 # create docs/urd, docs/usage, data dirs
node src/index.js sync                 # load URD requirements into registry
node src/index.js check recent         # check last 10 commits against URD
node src/index.js generate-docs        # generate docs/usage/*.md from src/
node src/index.js snapshot             # snapshot URD + docs + source version
node src/index.js dashboard            # http://localhost:7171
```

## URD format

See `docs/urd/urd-001-guardian.md` for a full example. In short:

```markdown
---
id: URD-001
title: Feature
version: 1.0.0
status: active
---
### REQ-001: Title
**Acceptance Criteria:**
- AC1: ...
**Affected Files:**
- src/auth/login.js
```

Reference requirements in commit messages: `feat: ...  Req: REQ-001, REQ-002` or `[REQ-001] ...`.

## Layout

```
greenNode/
├── agentbase-skills/          # pulled GreenNode AgentBase skills (reference + installable skills)
├── skills/urd-guardian/SKILL.md   # this agent as a SKILL.md-compatible skill
├── src/
│   ├── index.js               # CLI entry
│   ├── agent/                 # git-reader, urd-reader, source-reader, commit-checker, doc-generator, version-manager
│   ├── store/                 # fs-utils + registry db
│   └── dashboard/             # http server + public/index.html
├── docs/
│   ├── urd/                   # URD documents (markdown)
│   └── usage/                 # generated usage docs (markdown)
└── data/                      # registry.json + snapshots/
```

## Dashboard

`node src/index.js dashboard` serves a single-page app on port 7171:

- **Requirements** column — each card shows acceptance criteria, affected files, linked
  commits (with PASS/FAIL), and mismatch notes.
- **Commits** column — checked commits with notes; a Git-log tab lets you check any
  commit with one click.

API: `GET /api/registry`, `POST /api/check/recent`, `POST /api/generate-docs`,
`POST /api/snapshot`, `GET /api/docs/<name>` (see `skills/urd-guardian/SKILL.md`).

## Tech

Node.js >= 18, **zero runtime dependencies** (only built-in modules: `http`, `fs`,
`path`, `child_process`, `crypto`, `url`). Git CLI required for commit checks.
