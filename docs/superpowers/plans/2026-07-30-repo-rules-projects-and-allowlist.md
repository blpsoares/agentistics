# Sharing rules: projects, allowlist mode, and the clarity fixes — Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn per-connection sharing rules from "repositories only, block-what-you-don't-want" into the thing the user actually asked for: a picker over **projects and repositories** (two tabs), with a per-connection choice between **"share everything except…"** and **"share only…"**, plus the clarity fixes that came out of the first real use.

**Architecture:** The expensive machinery — the seal ledger, the crash journal, the attribution-split cache, the retroactive removal — all hangs off a single predicate, `sessionShared()` in `share-rules.ts`. This plan changes that predicate and the UI above it; it does not touch the machinery. `TeamConnection.deniedRepos: string[]` becomes a typed source list plus a mode, migrated in place.

**Tech Stack:** Bun, TypeScript, React 18 + Vite, MongoDB (central only), `bun test`.

**Origin:** direct user feedback after testing Plan 3 on a live machine. Their words, kept verbatim because each one is a requirement: the hidden chips are confusing ("poderia ser mais explícito o que tá oculto"); the confirm message is unclear and its date is unformatted; they want the inverse mode ("Compartilhar apenas X repositórios"); "Sem repositório" is opaque ("todos os Projetos sem git? sessões sem git em pastas soltas?"); saving should sync without a second click; Disconnect and Sync-now should not show while editing; and the list should cover **projects**, "os mesmos que aparecem na opção de filtro 'Filtrar por projeto'".

## Global Constraints

- Everything in English: code, comments, commit messages, docs. (Product copy is EN+PT by definition.)
- **The pre-commit hook must pass on every commit** (`bun tsc --noEmit` + `bun test`). **Never `--no-verify`.** Baseline entering this plan: 1984 pass / 0 fail.
- **No test may read `~/.claude` or `~/.agentistics`, or depend on the developer's locale.** Inject dependencies; use tmp dirs and restore module globals in `afterAll`.
- **`share-rules.ts` stays pure** — no I/O, no `preferences`, no `config` import.
- **Nothing about the rules goes on the wire to a central.** `IngestBody` gains no field; `StatsCache` gains no field. The only outbound body remains `{ sessionIds }` on forget.
- **Deny wins, always.** With two dimensions a session is shared only if NO rule excludes it. In allowlist mode: shared only if SOME rule includes it AND none excludes it. Fail-closed in both directions.
- **A committed test that asserts nothing is a defect**; `for (const x of possiblyEmpty) expect(...)` passes vacuously — that defect was found four times across Plans 2 and 3.
- **Do not start the app on port 47291/47292** — the user's live instance runs there. Browser verification uses an isolated stack (see Task 8; Plan 3's Task 14 report has the working recipe).
- Mobile is part of every UI task, not a follow-up: 44px targets on mobile only, inputs ≥16px, `document.documentElement.scrollWidth <= window.innerWidth` at 390px.
- **Migration must be silent and lossless for existing users.** A machine already configured with `deniedRepos` keeps behaving identically until the user changes something.

## Ordering

**Task 1 is the clarity fixes and lands first**, because the user is testing right now and every one of those is a thing they hit in the first ten minutes. Tasks 2–5 are the data-model and server change, 6–7 the new picker, 8 the gate and docs.

---

### Task 1: the clarity fixes (ship first)

**Files:**
- Modify: `packages/web/src/components/team/SharedReposPanel.tsx`, `SharedReposEditView.tsx`, `copy.ts`
- Modify: `packages/web/src/components/team/ConnectionCard.tsx` (hide Disconnect / Sync now while editing)
- Test: `packages/web/src/components/team/repoPanelState.test.ts`, `copy.test.ts`

Six fixes, each from live feedback:

1. **The chip block reads as its own opposite.** The heading says `REPOSITÓRIOS COMPARTILHADOS` and the amber chip directly beneath it is the **hidden** one — two polarities in one box. Restructure the read view: a clearly-labelled "Ocultos desta central (N)" / "Hidden from this central (N)" block holding the chips, and the shared count as separate text. The chips keep `EyeOff` so the icon and the label agree.
2. **The confirm modal is unclear.** Rewrite `applyConfirmBody` / `applyConfirmStats` in plain language, structured as *what happens now* / *what cannot be undone*, keeping every fact the current copy states (already-sent data has been seen; the pre-boundary aggregate cannot be split). Do not drop a limitation to make it read better — losing one is the failure this whole feature guards against.
3. **The date is raw.** `statsNote` and the confirm copy interpolate `{boundary}` as `2026-07-20`. Format it in the viewer's locale (the app already formats dates elsewhere — use the existing helper rather than a new one). `null` still means unknowable and still renders no date.
4. **"Sem repositório" is opaque.** Make the row say what it actually covers: sessions whose folder is not a git repository, **plus** every session from CLIs that record no remote (Codex, Gemini, Kimi, agy). On this user's machine that is most of their history, so the row must not read as an edge case.
5. **Saving already syncs — make it visible.** `handlePatchConnection` already calls `pushNow` when rules change (`team-connections.ts:424`); the user cannot tell. Surface it in the existing apply banner ("enviando para a central…" → "enviado") instead of adding another control.
6. **Hide Disconnect and Sync now while the repo panel is in edit mode.** They are unrelated to the edit in progress and one of them is destructive.

- [ ] **Step 1: Write the failing tests** — the read-view model exposes a hidden-block with a count and a shared count separately; the boundary formatter renders a localized date for a real boundary and nothing for `null`; the panel model reports "editing" so the card can hide its two actions.
- [ ] **Step 2: Run, watch fail.** `bun test packages/web/src/components/team/`
- [ ] **Step 3: Implement.** Copy changes go in `copy.ts` in BOTH languages; `copy.test.ts`'s parity guards cover them automatically.
- [ ] **Step 4: Run.** `bun test && bun tsc --noEmit`
- [ ] **Step 5: Commit** `fix(web): make the hidden repositories explicit and the confirm copy plain`

---

### Task 2: the data model — typed sources and a mode

**Files:**
- Modify: `packages/core/src/team.ts` (`TeamConnection`, migration)
- Test: `packages/core/src/team.test.ts`

```ts
export type ShareSourceType = 'repo' | 'project' | 'none'

export interface ShareSource {
  type: ShareSourceType
  /** canonical repo key, or the project path, or '' for the `none` bucket */
  value: string
}

export interface TeamConnection {
  // …existing fields…
  /** 'denylist' (share everything except `sources`) | 'allowlist' (share only `sources`) */
  shareMode?: 'denylist' | 'allowlist'
  /** The typed rule list. Replaces `deniedRepos`, which is kept as a read migration source. */
  sources?: ShareSource[]
  /** LEGACY. Still read by the migration; never written by this version onward. */
  deniedRepos?: string[]
}
```

**Migration, in the existing pure `migrateTeamConfig`:** a connection with `deniedRepos` and no `sources` becomes `{ shareMode: 'denylist', sources: deniedRepos.map(v => v === NO_REPO_KEY ? {type:'none',value:''} : {type:'repo',value:v}) }`. Deterministic, idempotent, and it must run in the same read path the Plan 1 migration already uses — a machine that never opens Settings keeps behaving identically.

**`shareMode` absent reads as `'denylist'`.** Every existing config is a denylist; treating absence as anything else would silently invert live rules.

- [ ] Steps: failing tests (legacy → migrated shape; `NO_REPO_KEY` → `{type:'none'}`; idempotence over 100 calls; absent mode reads denylist; an already-migrated config is untouched) → implement → run → commit.

---

### Task 3: the predicate — `share-rules.ts` learns projects and allowlist

**Files:** modify `packages/server/server/share-rules.ts`; test `share-rules.test.ts`

This is the only place the new semantics live. Everything downstream (`deniedSessionIds`, the split cache, the seal ledger, the shrink detector, the forget journal) consumes `sessionShared` and inherits the change without modification — **do not modify those**.

```ts
export function sessionShared(
  s: Pick<SessionMeta, 'git_remote' | 'project_path'>,
  rules: { mode: 'denylist' | 'allowlist'; sources: ReadonlySet<string> },  // keyed as `${type}:${value}`
  index?: PathRepoIndex,
): boolean
```

Semantics, exactly:
- A session **matches** a source when: `repo` — its canonical repo key equals the value (including via `index`); `project` — its `project_path` equals the value; `none` — it resolves to no repository at all.
- **denylist:** shared ⟺ it matches NO source.
- **allowlist:** shared ⟺ it matches SOME source.
- **Deny wins across dimensions** in denylist mode: matching a blocked repo denies the session even if its project is not listed. In allowlist mode, matching either an allowed repo or an allowed project is enough.
- The `conflictPaths` rule survives unchanged: a path resolving to more than one repository is shared only if every one of those repos is shared (denylist) / some is allowed **and** none is excluded (allowlist).

- [ ] Steps: failing tests (each bullet above, plus: an allowlist with an empty source set shares NOTHING — assert it explicitly, because the opposite reading is the one that leaks; a project rule catches a remote-less session; a repo rule catches a session whose project was never named) → implement → run → commit.

---

### Task 4: the server — routes and status carry the new shape

**Files:** modify `packages/server/server/team-connections.ts`, `team-uploader.ts`, `team-rules.ts`; tests alongside.

- `POST` / `PATCH /api/team/connections` accept `{ shareMode, sources }`, validated totally (junk → 400, never partial).
- `withUnresolvedDenied`'s job — auto-adding the unattributed bucket on the first restriction — applies to **denylist mode only**. In allowlist mode the unattributed bucket is hidden by default like everything else, so nothing to add.
- `GET /api/team/status` reports `shareMode` and a per-dimension count (`deniedRepos`/`deniedProjects` counts, or `allowedCount`) — **never the values**.
- `denialSignature` covers mode + typed sources, so switching mode triggers the retroactive removal exactly like editing the list does.
- **Switching denylist → allowlist can shrink the shared set drastically.** That must flow through the existing forget sequence, not a special path.

- [ ] Steps: failing tests → implement → run → **manual check against a throwaway central** (block by project, confirm those sessions leave; switch modes, confirm the removal runs once) → commit.

---

### Task 5: the web projection learns projects

**Files:** modify `packages/web/src/lib/shareRepos.ts` + its test.

`buildShareTargets` gains a sibling for projects, fed by `ctx.data.projects` — the same list the "Filtrar por projeto" filter uses, so the two agree. A project target carries: path, display name, its repo (when it has one), sessions, last active, and whether it is **locked by a repo rule**.

Keep the hand-mirrored `canonicalRepoKey` and its cross-check test — it stays the highest-risk duplication in the codebase.

- [ ] Steps: failing tests (a project with no git appears by folder name; a project under a blocked repo reports locked; the project list matches what the project filter shows for the same data; ordering sessions-desc) → implement → run → commit.

---

### Task 6: the two-tab picker

**Files:** modify `SharedReposEditView.tsx`, `repoPanelState.ts`, `SharedReposPanel.tsx` + tests.

Two tabs, **Projetos** and **Repositórios**, over one rule list. The user chose this shape knowing the trade-off; the plan removes the trade-off's teeth:

- **A project whose repository is blocked renders blocked-and-locked**, saying "bloqueado pelo repositório X" — the same treatment `conflictPaths` rows already get. So no contradictory pair can be created, and the reason is on screen.
- The summary above both tabs is shared across them ("N de M compartilhados"), so switching tabs never looks like a different machine.
- Both tabs obey the mode selector (Task 7).

- [ ] Steps: failing tests for the pure model (tab state, locked-by-repo derivation, the shared summary, a toggle in one tab reflected in the other's locks) → implement → 390px check → commit.

---

### Task 7: the mode selector

**Files:** `SharedReposPanel.tsx`, `copy.ts`, `AddCentralDrawer.tsx` + tests.

A per-connection choice, shown above the tabs and in the add wizard's step 2:
- **"Compartilhar tudo, exceto…"** (default; today's behaviour; a new project/repo is shared)
- **"Compartilhar apenas…"** (a new project/repo is **hidden**)

The switch is a rules change like any other: it goes through the same confirm modal, the same single `PATCH`, and the same retroactive removal. The confirm copy must state the consequence in the direction being chosen — switching to "apenas" hides everything not listed, and that is usually a large removal.

- [ ] Steps: failing tests (the mode reaches the submit body; switching mode marks the draft dirty; the confirm copy differs per direction; allowlist + empty list is refused in the UI with an explanation rather than silently sharing nothing) → implement → 390px → commit.

---

### Task 8: docs and the browser gate

- [ ] Update `docs/architecture.md` and `docs/security.md`: the guarantee is unchanged in kind, but now covers two dimensions and two modes. State plainly that allowlist mode is the safer default for an untrusted central because a new project is hidden rather than shared.
- [ ] Update `CLAUDE.md`'s team-mode rules: deny wins across dimensions; `shareMode` absent reads denylist; the predicate is the only place the semantics live.
- [ ] Re-run Plan 3 Task 14's 390px gate against an isolated stack, adding the new states: both tabs, the mode selector, a project locked by a repo rule, and the allowlist confirm.

---

## Self-review notes

- **The risky machinery is untouched by design.** If a task finds itself editing the seal ledger, the journal or the split cache, something has gone wrong — stop and report.
- **`deniedRepos` is read-only from Task 2 onward.** Any code still writing it is a bug; grep for it at the end of Task 4.
- The user's two-tab choice was made against my recommendation of grouped projects; the locked-by-repo rendering in Task 6 is what makes it safe, so it is not optional.
