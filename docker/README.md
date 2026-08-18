# `docker/` — the compose files, one per thing you might run

Every file here is a real, runnable deployment. Nothing in this directory is an example that needs
editing before it works: you supply a `central.env`, and that is the whole of the configuration.

Two questions decide which files you want, and they are independent:

- **What are you running?** A team **central** (aggregates many machines) or a **machine** (one
  developer's own metrics, solo or as a member).
- **Where does the image come from?** Built from this checkout, or pulled from GHCR.

**How to run one** is [`docs/central-deploy.md`](../docs/central-deploy.md).
**How to publish one on the internet** is [`docs/exposure.md`](../docs/exposure.md) — a separate
decision, a separate set of variables, and the one with a checklist you must pass.

---

## The files

| File | What it is | Merged automatically by |
|---|---|---|
| `central.yml` | The central, **built from this checkout** | `./central.sh` · `agentop central up --build` |
| `central.image.yml` | The central, from the **published image** — the exact twin of the above | `agentop central up --image` |
| `central.localdb.yml` | The bundled MongoDB. An overlay, merged only when `MONGO_URL` points at the internal `mongo` service | both central paths, when the database is bundled |
| `central.selfcontrib.yml` | Mounts the host's harness dirs read-only so the central also reports its own machine | both, when `AGENTISTICS_CENTRAL_USER` is set |
| `central.ingest-only.yml` | Turns an instance into a token-gated `/api/team/ingest` and nothing else — the public half of a split deployment for CI runners | never — you pass it deliberately |
| `machine.yml` | One machine (solo or member) in a container instead of natively | `agentop start` → the **docker** option |
| `central.env.example` | Annotated template for `central.env` | — |

`central.yml` and `central.image.yml` are interchangeable on one host: same project name, same
service, same volume, same variables. Switching between them keeps the database and the
preferences.

---

## Running them by hand

The wrappers exist so you do not have to remember `-p`, `--env-file` and the overlays. If you would
rather drive compose yourself:

```bash
# Central, built here, bundled database
docker compose -p team-mode --env-file central.env \
  -f docker/central.yml -f docker/central.localdb.yml \
  up -d --build --force-recreate

# Central, published image, bundled database
docker compose -p team-mode --env-file central.env \
  -f docker/central.image.yml -f docker/central.localdb.yml \
  up -d --pull always --force-recreate

# Central, published image, external database (Atlas) — no local Mongo at all
docker compose -p team-mode --env-file central.env \
  -f docker/central.image.yml \
  up -d --pull always --force-recreate

# This machine, in a container
docker compose -f docker/machine.yml up -d --build
```

Two flags are not optional habits:

- **`--force-recreate`.** A plain `up -d` does not replace a container whose image was rebuilt, so
  your new code silently does not run.
- **`-p team-mode`.** Both central files pin `name: team-mode` so a bare run lands on the same
  stack the wrapper uses; keep the flag anyway if you script it, and use a *different* project name
  deliberately when you actually want a second stack (see `central.ingest-only.yml`).

---

## If you ran these from the repository root

They used to live there as `docker-compose*.yml`, and Compose derives the project name from the
compose file's directory when nothing pins it. Both central files and `machine.yml` now pin their
own `name:`, so the stack no longer depends on where you invoke it from — but a container created
under the *old* name is still on your host and still holds the ports. Remove it once:

```bash
docker rm -f $(docker ps -aq --filter "name=agentistics-machine") 2>/dev/null
```

The central is unaffected: `central.sh` always passed `-p team-mode`, which is the name that is now
pinned.
