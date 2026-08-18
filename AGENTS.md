# AGENTS.md — process rules for any AI coding assistant working in this repo

This file follows the [agents.md](https://agents.md) convention and is read by AI coding harnesses
(Claude Code, Codex CLI, Cursor, Amp, Jules, Gemini CLI, and any other tool that supports it). It
defines the **process** every harness must follow when doing implementation work in this repo —
Issues, the Project board, Discussions, and documentation. It does not duplicate architecture or
implementation detail: those live in `docs/` (canonical) and in each harness's own config
(`CLAUDE.md` for Claude Code).

## Before starting implementation work

1. Check the [Project board](https://github.com/users/blpsoares/projects/2) and open Issues for an
   item that already covers the task. If none exists, open one — use the `bug_report` or
   `feature_request` issue template as fits the change.
2. New Issues land on the board automatically
   (`.github/workflows/project-add.yml`). Set:
   - **Status** — `Backlog` on creation, `In progress` once work actually starts, `In review` once
     a PR is open, `Done` when it merges. Don't leave a card silently stale in the wrong column.
   - **Priority** — `P0` / `P1` / `P2`. Ask the user if it's unclear; never guess `P0`.
3. **Architecture-affecting or breaking changes get a Discussion first**, in the
   [Ideas category](https://github.com/blpsoares/agentistics/discussions/categories/ideas), before
   an Issue is opened — link the Issue back to the Discussion once it exists. Skip this step for
   bug fixes, docs-only changes, and scoped features that don't change a public contract (an API
   route, the `SessionMeta` shape, a CLI flag, the `HarnessAdapter` contract, a stored document
   shape, etc.). When in doubt, open the Discussion — reverting a merged breaking change is far
   more expensive than a skipped conversation.

## Opening a PR

- **Every PR must reference an Issue** — `Closes #N` / `Fixes #N` / `Resolves #N` in the PR body.
  `.github/workflows/require-linked-issue.yml` checks this on every PR. A genuinely trivial change
  (a typo, a single dependency bump) can carry the `no-issue-needed` label instead of an Issue
  opened just to satisfy the check — that label is the escape hatch, not the default.
- Follow `CONTRIBUTING.md` for setup, running tests, and commit conventions (Conventional Commits,
  English).
- Fill in the PR template for real — a "Summary" with no "Motivation" or "Test plan" is not a
  filled template.

## Documentation

- **Documentation is `docs/*.md`** — real files, versioned with the code, readable by any tool or
  person, not only a harness reading its own memory file. `CLAUDE.md` is Claude Code's own
  operational memory: dense, repo-specific invariants written for a model. It is not the canonical
  source for anything, and other harnesses do not read it. If a decision or an invariant is worth
  remembering, it belongs in `docs/` — `CLAUDE.md` may reference it, never replace it.
- The [Wiki](https://github.com/blpsoares/agentistics/wiki) is an index INTO `docs/`, not a copy of
  it. Update the doc under `docs/`; the wiki page links there rather than repeating the prose.
- Update `docs/` (and `CLAUDE.md`, if the change affects how a harness should operate in this repo)
  in the SAME PR as the code change — never as a follow-up someone has to remember to do.

## Scope discipline

- One Issue, one PR, one concern. An unrelated fix found along the way gets its own Issue, not a
  ride inside the current PR.
- If a task turns out larger than its Issue describes, say so in the Issue before the PR grows to
  match — don't silently widen scope.

## Discussions

- **Ideas** — proposals and architecture discussions before they become Issues (see above).
- **Q&A** — usage questions; don't open an Issue for "how do I configure X".
- **Show and tell** — community usage, dashboards, integrations built on top of agentistics.
- **Announcements** — maintainer-only, releases and breaking-change notices.
