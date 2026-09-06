---
name: urd-guardian
description: "MANDATORY skill for ANY request to verify a git commit against URD (User Requirements Document) requirements, to generate usage documentation from source code, to manage URD/doc/source versions, or to view the requirements/commits dashboard. Reads git, source code, and URD markdown; warns about code changes that do not match the documentation (extra or missing requirements); generates usage markdown from source; snapshots URD/docs/source versions for AI agent use; serves a web dashboard of requirements, commits, and mismatch notes. All documents are markdown."
---

# URD Guardian — Commit/Requirement Guard, Doc Generator & Dashboard

An AI agent that keeps source code honest against URD (User Requirements Document)
markdown, generates usage docs from source, manages versions, and shows everything
on a web dashboard. All documents are markdown.

## Argument Routing

| First Argument | Action |
|----------------|--------|
| `dashboard [port]` | Start the web dashboard (default port 7171) |
| `check [sha\|head\|recent]` | Check a commit against URD requirements (default: head) |
| `generate-docs` | Generate usage markdown from source code |
| `snapshot` | Snapshot URD + usage docs + source version |
| `list-urd` | List parsed URD requirements |
| `list-commits [limit]` | Show recent git commits |
| `sync` | Sync URD requirements into the registry |
| `init` | Create docs/urd, docs/usage, data dirs |
| *(no args)* | Show help |

Run the CLI directly:

```bash
node src/index.js <command> [args]
```

---

## URD Markdown Format

Every URD document is a markdown file under `docs/urd/` with YAML frontmatter and
one `### REQ-xxx` section per requirement:

```markdown
---
id: URD-001
title: Feature Title
version: 1.0.0
status: draft|active|deprecated
---

# URD-001: Feature Title

## Requirements

### REQ-001: Requirement title
Free-text description.

**Acceptance Criteria:**
- AC1: ...
- AC2: ...

**Affected Files:**
- src/path/to/file.js

**Tags:** auth, backend
```

The checker maps a commit's changed files to a requirement's **Affected Files**.

---

## Commit Convention

Reference requirements in the commit message so the checker knows what the commit
claims to implement. Either form works:

```
feat: add login endpoint  Req: REQ-001, REQ-002
```
```
[REQ-001] add login endpoint
```

The checker extracts every `REQ-xxx` token from the subject + body.

---

## How the Commit Check Works

For a given commit the agent:

1. Reads changed files (`git diff-tree --name-status`).
2. Parses claimed `REQ-xxx` IDs from the commit message.
3. Loads all URD requirements and their **Affected Files**.
4. Computes:
   - **matchedRequirements** — requirements whose affected files were touched.
   - **extraFiles** — changed files that belong to NO requirement (warning: `extra-change`).
   - **missingRequirements** — claimed requirements whose affected files were NOT touched (error: `missing-requirement`).
   - **no-claim** warning — commit changed code but references no REQ-ID.
   - **incomplete-requirement** warning — claimed requirement with 0 affected files touched.
5. Sets `ok = false` if any error-level note exists.

This is exactly the "warn where source code changes do not match the documentation
(extra / missing requirements)" behavior.

---

## Generating Usage Documentation

```bash
node src/index.js generate-docs
```

Scans `src/` for code files (`.js .ts .jsx .tsx .py .java .go .rs`), extracts
symbols (functions, classes, express endpoints, JSDoc/docstring text), and writes:

- `docs/usage/index.md` — module index + endpoint table.
- `docs/usage/<module>.md` — per-module reference.

All output is markdown — clean for an AI agent to read.

---

## Version Management

```bash
node src/index.js snapshot
```

Snapshots are written to `data/snapshots/`:

- `urd/`  — each URD copied with a content hash + git SHA in the filename.
- `usage/` — each generated usage doc copied with a content hash.
- source version — current `git HEAD` + branch.

The registry (`data/registry.json`) records `urdVersions`, `docVersions`, and
`sourceVersions` so any version can be recalled. Use `bumpVersion(current, 'major'|'minor'|'patch')` from `src/agent/version-manager.js`.

---

## Web Dashboard

```bash
node src/index.js dashboard        # http://localhost:7171
```

Endpoints (all built-in `http`, no external deps):

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/registry` | Requirements + commits + notes (joined) |
| GET  | `/api/requirements` | Requirements list |
| GET  | `/api/commits` | Checked commits list |
| GET  | `/api/git/commits?limit=30` | Raw git log |
| GET  | `/api/git/status` | Repo status |
| POST | `/api/check/head` | Check HEAD commit |
| POST | `/api/check/recent` | Check last 10 commits |
| GET  | `/api/check/<sha>` | Check a specific commit |
| POST | `/api/generate-docs` | Generate usage docs |
| POST | `/api/snapshot` | Snapshot all versions |
| GET  | `/api/docs/<name>` | Read a usage doc (markdown) |

The page shows two columns: **Requirements** (each card lists acceptance criteria,
affected files, linked commits, and mismatch notes) and **Commits** (checked
commits with PASS/FAIL badges and notes, plus a Git-log tab with a per-commit
"Check" button).

---

## File Boundaries

- `docs/urd/*.md` — URD documents (markdown). Source of truth for requirements.
- `docs/usage/*.md` — generated usage docs (markdown). Do not edit by hand.
- `data/registry.json` — joined state: requirements ↔ commits ↔ notes.
- `data/snapshots/` — versioned copies of URD, usage docs, and source SHAs.
- `src/agent/` — the agent modules (git-reader, urd-reader, source-reader, commit-checker, doc-generator, version-manager).
- `src/store/` — filesystem utils + registry store.
- `src/dashboard/` — http server + static HTML.

---

## End-to-End Example

```bash
node src/index.js init                 # create dirs
# ...write docs/urd/urd-001.md and source code...
node src/index.js sync                 # load URD into registry
node src/index.js check recent         # check last 10 commits
node src/index.js generate-docs        # write docs/usage/*.md
node src/index.js snapshot             # snapshot versions
node src/index.js dashboard            # open http://localhost:7171
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Not a git repository" | Run `git init` and make at least one commit. |
| No requirements shown | Add a markdown URD to `docs/urd/` then run `sync`. |
| Every commit shows `no-claim` | Add `Req: REQ-001` to commit messages. |
| Extra-change warnings | Add the file to the requirement's **Affected Files** list. |
| Dashboard port in use | `node src/index.js dashboard 8181`. |
