# GitHub Actions — track Claude Code Actions usage per repository

agentistics can track token/cost usage from **Claude Code running inside GitHub Actions**, not
just from developers' laptops. Each Actions run is an *ephemeral machine*: it populates
`~/.claude`, then dies. `agentop ci-push` sends that run's computed metrics to your **central**
before the runner is torn down, attributed to the repository it ran in — so a repo's dashboard
shows **local devs + cloud agents together**, grouped by git remote.

This builds on the [repository dimension](./architecture.md): every session carries a normalized
`git_remote` (`host/org/repo`, no protocol), and CI runs are additionally flagged `ci: true` and
surfaced under **Repositories → Actions**.

## How it works

```
GitHub Actions runner (ephemeral)
  ├── Claude Code Action runs  → writes ~/.claude
  └── agentop ci-push          → POST /api/team/ingest  (Bearer <repo CI token>)
                                        ↓
                            Central (Mongo) stamps git_remote + ci=true
                                        ↓
                            Repositories → Actions  (per repo, cross-user)
```

- **Attribution is authoritative on the central.** The CI token is *bound to a repository*, so
  the central stamps `git_remote` (the registered remote) and `user = github-actions` itself — a
  runner cannot mis-report which repo it belongs to.
- **No chat leaves the runner** — the same privacy contract as team members: computed metrics
  only (sessions/tokens/cost aggregates + statsCache), never raw transcripts.
- **`ci-push` never fails your job.** A push error (central down, bad token) logs and exits 0.

## 1. Register the repository on the central

Registration is an **admin action** on the central (behind the dashboard password). It mints a
long repo-bound CI token — shown once — that you store as a GitHub Actions secret.

```bash
# From an authenticated admin session on the central (cookie from the dashboard login):
curl -sS -X POST "$CENTRAL_URL/api/team/repos" \
  -H 'Content-Type: application/json' \
  -H "Cookie: $ADMIN_SESSION_COOKIE" \
  -d '{ "url": "git@github.com:org/repo.git", "name": "org/repo" }'
# → { "token": "<96-char CI token — store as a secret>", "remote": "github.com/org/repo" }
```

`url` accepts any remote form (https / ssh / scp); it is normalized to `github.com/org/repo`.
Re-registering the same repo **rotates** its token (the old one is revoked).

Then add the token to the repo's secrets:

```bash
gh secret set AGENTISTICS_CI_TOKEN --repo org/repo --body '<the token>'
```

(You can also list/unregister: `GET /api/team/repos`, `DELETE /api/team/repos { "remote": … }`.)

## 2. Add the push step to your workflow

Drop this step at the **end** of the job that runs Claude Code (see the full template in
[`docs/examples/agentistics-actions.yml`](./examples/agentistics-actions.yml)):

```yaml
      # ... your existing Claude Code Action step runs first ...

      - name: Push agentistics metrics
        if: always()   # report usage even if the Claude step failed
        env:
          AGENTISTICS_CENTRAL_URL: ${{ vars.AGENTISTICS_CENTRAL_URL }}
          AGENTISTICS_CI_TOKEN: ${{ secrets.AGENTISTICS_CI_TOKEN }}
        run: |
          curl -fsSL "https://github.com/blpsoares/agentistics/releases/latest/download/agentop" -o agentop
          chmod +x agentop
          ./agentop ci-push
```

`ci-push` reads `AGENTISTICS_CENTRAL_URL` and `AGENTISTICS_CI_TOKEN` from the environment (or
takes `--endpoint` / `--token` / `--org` flags). The central must be reachable from the runner
(a public URL or a self-hosted runner on your network).

## 3. See it in the dashboard

Open **Repositories** → click the repo → **Actions** tab, or **Repositories → Actions** for the
cross-repo view. CI runs are counted separately (`user = github-actions`) but roll up into the
same per-repo totals as your local sessions.

## Security notes

- The CI token is stored only as a **SHA-256 hash** on the central (like every ingest token) and
  is used as `Authorization: Bearer`. Treat it like any secret; rotate by re-registering the repo.
- The token is **repo-scoped for attribution** but, like all ingest tokens, can write sessions to
  the central — only register repos you control and keep the secret in GitHub's secret store.
- Prefer a self-hosted runner or an authenticated reverse proxy if your central is not public.
