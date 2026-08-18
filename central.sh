#!/usr/bin/env bash
#
# central.sh — manage the agentistics Team Mode central (Docker Compose).
#
# Wraps `docker compose` with the project name and env file pre-set, and can
# generate central.env interactively (auto-filling secrets with openssl).
# See docs/central-deploy.md for details.
#
# Usage: ./central.sh <command>
#
#   up [options]
#             Ensure central.env exists (offer interactive setup), then build
#             and (re)create the containers.                      [most common]
#             Options (answer the prompts up front, for unattended runs):
#               -y, --yes    re-run the interactive setup, without asking
#               -n, --no     do NOT re-run it, without asking
#               --no-cache   build the image from scratch (slow: a full install +
#                            build inside the container). The rebuild paths
#                            (`agentop restart … --rebuild`) pass this by default.
#               --cache      reuse Docker's layer cache — the fast path
#   init      (Re)generate central.env interactively — asks each value and can
#             auto-generate the secrets with openssl.
#   restart   Restart the app container WITHOUT rebuilding
#   logs      Follow the app container logs (Ctrl-C to stop)
#   status    Show container + health status
#   doctor    Run the exposure preflight INSIDE the container, where central.env is
#             the live environment and the database is reachable. Add --exposed to
#             check against the strict public bar before opening a tunnel.
#   setup-token
#             Reissue the one-time OWNER setup token, for when the boot that printed it
#             has scrolled away or its log rotated. Refused once an owner exists.
#   reset-password --email <address> [--password <new>] [--clear-mfa]
#             Reset an account's password from the host. This is the ONLY way back in for a
#             locked-out last owner. Run without --email to list the accounts.
#   down      Stop and remove the containers (KEEPS the data volume)
#   pull      Rebuild from a fresh base image (git pull first, then this)
#   help      Show this message
#
# Override the defaults with env vars if needed:
#   PROJECT=team-mode   ENV_FILE=central.env   ./central.sh up
#
set -euo pipefail

# Run from the directory this script lives in, so relative paths (central.env,
# docker/central.yml) resolve regardless of where you invoke it from.
cd "$(dirname "$0")"

PROJECT="${PROJECT:-team-mode}"
ENV_FILE="${ENV_FILE:-central.env}"

# Decide whether to start the bundled local Mongo. Local when MONGO_URL is unset/blank or points
# at the internal `mongo` service host; external (Atlas etc.) otherwise. The value is whitespace-
# trimmed so a stray space in `MONGO_URL= mongodb+srv://…` doesn't misclassify it as external junk.
uses_local_db() {
  [ -f "$ENV_FILE" ] || return 0
  local url
  url="$(grep -E '^MONGO_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [ -z "$url" ] && return 0
  # Match the internal service host at a URL boundary (//mongo:27017 or user@mongo:27017) so an
  # external host that merely ends in "mongo:27017" (e.g. //mymongo:27017) isn't misclassified.
  case "$url" in
    *//mongo:27017*|*@mongo:27017*) return 0 ;;  # internal service host → bundled Mongo
    *) return 1 ;;                               # external cluster → do NOT start local Mongo
  esac
}

# Compose file set: always the base; add the local-Mongo overlay only when using the bundled DB.
# The container used to run as root, so an existing agentistics_data volume is owned by uid 0.
# It now runs as uid 10001, which cannot write those files — preferences and the consolidate
# store would silently stop persisting on upgrade. Fix the ownership once, idempotently, using
# the app's own image (already built locally, so nothing extra is pulled).
migrate_volume_ownership() {
  local owner
  owner="$(docker run --rm --user 0 -v "${PROJECT}_agentistics_data:/d" \
            --entrypoint sh "$(compose config --images 2>/dev/null | head -1)" \
            -c 'stat -c %u /d 2>/dev/null || echo unknown' 2>/dev/null || echo skip)"
  case "$owner" in
    10001|skip|unknown|'') return 0 ;;
  esac
  echo "  migrating data volume ownership to the unprivileged user (was uid $owner)…"
  docker run --rm --user 0 -v "${PROJECT}_agentistics_data:/d" \
    --entrypoint sh "$(compose config --images 2>/dev/null | head -1)" \
    -c 'chown -R 10001:10001 /d' >/dev/null 2>&1 || {
      echo "  WARNING: could not chown the data volume. The central may fail to persist" >&2
      echo "  preferences. Fix manually:" >&2
      echo "    docker run --rm --user 0 -v ${PROJECT}_agentistics_data:/d alpine chown -R 10001:10001 /d" >&2
    }
}

compose_files() {
  local files="-f docker/central.yml"
  uses_local_db && files="$files -f docker/central.localdb.yml"
  # Only a self-contributing central mounts the host harness dirs. A dedicated central gets no
  # host filesystem access at all — which is what makes it safe to expose.
  if [ -f "$ENV_FILE" ] && grep -qE '^AGENTISTICS_CENTRAL_USER=.+' "$ENV_FILE" 2>/dev/null; then
    files="$files -f docker/central.selfcontrib.yml"
  fi
  printf '%s' "$files"
}

# shellcheck disable=SC2046  # intentional word-splitting of the -f flags
compose() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" $(compose_files) "$@"; }

# Print the dashboard access URL(s) after the central is up. Reads APP_PORT / BIND_IP from
# the env file; when bound to all interfaces (0.0.0.0) also suggests the LAN / Tailscale IP so
# teammates know where to point their members.
print_access_url() {
  [ -f "$ENV_FILE" ] || return 0
  local port bind
  port="$(grep -E '^APP_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  bind="$(grep -E '^BIND_IP=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  port="${port:-48080}"
  bind="${bind:-127.0.0.1}"
  echo
  echo "Dashboard / central endpoint:"
  if [ "$bind" = "0.0.0.0" ] || [ -z "$bind" ]; then
    echo "  local:     http://localhost:$port"
    local lan_ip ts_ip
    lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    ts_ip="$(detect_tailscale_ip)"
    [ -n "$lan_ip" ] && echo "  LAN:       http://$lan_ip:$port"
    [ -n "$ts_ip" ]  && echo "  Tailscale: http://$ts_ip:$port"
    echo "  Members connect to one of the reachable URLs above (e.g. agentop member connect --endpoint …)."
  else
    echo "  http://$bind:$port"
  fi
  print_owner_setup_hint "$port"
}

# First boot has no owner account yet: say what the browser is about to ask for, and where the
# one-time setup token is. Best-effort — a central that is slow or unreachable simply prints
# nothing (curl may be absent; never let this fail `up`).
print_owner_setup_hint() {
  local port="$1" body="" i=0
  command -v curl >/dev/null 2>&1 || return 0
  while [ "$i" -lt 20 ]; do
    body="$(curl -fsS --max-time 2 "http://localhost:$port/api/iam/status" 2>/dev/null || true)"
    [ -n "$body" ] && break
    i=$((i + 1))
    sleep 1
  done
  case "$body" in
    *'"needsBootstrap":true'*) ;;
    *) return 0 ;;
  esac
  local token
  # The banner prints the token alone on its line; the last one wins (a re-issued token).
  token="$(docker compose -p "$PROJECT" logs --no-color app 2>/dev/null \
    | grep -oE '\b[0-9a-f]{48}\b' | tail -1 || true)"
  echo
  echo "First boot — no owner account exists yet."
  echo "  Open the dashboard above: it asks you to CREATE THE OWNER ACCOUNT (name, e-mail, password)"
  echo "  plus the one-time setup token the central printed to its log."
  echo
  if [ -n "$token" ]; then
    echo "  setup token: $token"
  else
    echo "  Read it with: docker compose -p $PROJECT logs app | grep -A6 'OWNER SETUP'"
  fi
  echo
  echo "  There is no shared team password — everyone else gets their own account, invited by the owner."
}

# ── Interactive helpers ──────────────────────────────────────────────────────

# Prompt for a plain value with a default. Usage: v=$(ask "Label" "default")
ask() {
  local label="$1" def="${2:-}" val=""
  if [ -n "$def" ]; then
    read -rp "  $label [$def]: " val || true
  else
    read -rp "  $label: " val || true
  fi
  printf '%s' "${val:-$def}"
}

# Prompt for a secret: type your own, or press Enter to auto-generate via the
# given generator command. Usage: s=$(ask_secret "Label" "openssl rand -hex 32")
ask_secret() {
  local label="$1" gen="$2" val=""
  read -rp "  $label [Enter to generate with openssl, or type your own]: " val || true
  if [ -z "$val" ]; then
    val="$(eval "$gen")"
    echo "    -> generated: $val" >&2
  fi
  printf '%s' "$val"
}

# This host's Tailscale IPv4, or nothing. NEVER an error, and never a stall.
#
# Three ways this can go wrong and none of them may reach the user, because a suggested URL is
# a convenience and `up` must not fail over one:
#   - the CLI is not installed        -> `command -v` guard;
#   - it is installed but the daemon is down, logged out, or hung -> stderr discarded, non-zero
#     exit swallowed, and a `timeout` so an unresponsive daemon cannot hold up the deploy;
#   - it answers something that is not an address (a notice, a login URL, an empty tailnet) ->
#     the output is only accepted if it LOOKS like a CGNAT (100.64.0.0/10) address, so a stray
#     line can never be printed back as "http://<whatever>:48080".
detect_tailscale_ip() {
  command -v tailscale >/dev/null 2>&1 || return 0
  local out=""
  if command -v timeout >/dev/null 2>&1; then
    out="$(timeout 3 tailscale ip -4 2>/dev/null | head -1 || true)"
  else
    out="$(tailscale ip -4 2>/dev/null | head -1 || true)"
  fi
  # 100.64.0.0/10 — the range Tailscale assigns from. Anything else is not a tailnet address.
  case "$out" in
    100.6[4-9].*|100.[7-9][0-9].*|100.1[0-1][0-9].*|100.12[0-7].*)
      printf '%s' "$out"
      ;;
  esac
  return 0
}

# Generate central.env interactively.
init_env() {
  if [ ! -t 0 ]; then
    echo "init requires an interactive terminal (stdin is not a TTY)." >&2
    exit 1
  fi
  command -v openssl >/dev/null 2>&1 || { echo "openssl not found — install it to auto-generate secrets." >&2; exit 1; }

  if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$ENV_FILE.bak"
    echo "Backed up existing $ENV_FILE -> $ENV_FILE.bak"
  fi

  echo
  echo "Setting up $ENV_FILE — press Enter to accept the [default] / auto-generate."
  echo

  local port org secret ingest ts_ip extra_bind
  # 48080 by default — a member/dev instance uses 47291, so the central takes a distinct
  # port to avoid colliding with a local agentistics on the same machine.
  port="$(ask 'Host port (APP_PORT)' '48080')"
  org="$(ask 'Org name (AGENTISTICS_TEAM_ORG)' 'default')"
  # No dashboard password is asked for or written: a central authenticates ACCOUNTS. The owner
  # account is created in the browser on first boot, with the one-time setup token the server
  # prints to its log. AGENTISTICS_TEAM_PASSWORD is the legacy pre-accounts gate.
  secret="$(ask_secret 'Session secret (AGENTISTICS_TEAM_SESSION_SECRET)' 'openssl rand -hex 32')"

  # Optional ingest token (a shared secret). Most teams leave this blank and use per-member
  # minted tokens instead. Explicit choices so "blank = none" is never ambiguous.
  echo "  Ingest token (AGENTISTICS_TEAM_INGEST_TOKEN, optional shared secret):"
  echo "    1) generate with openssl"
  echo "    2) enter my own"
  echo "    3) leave blank / none  (default)"
  local ingest_choice=""
  read -rp "  Choose [3]: " ingest_choice || true
  case "$ingest_choice" in
    1) ingest="$(openssl rand -hex 24)"; echo "    -> generated: $ingest" ;;
    2) read -rp "  Paste the token: " ingest || true ;;
    *) ingest="" ;;
  esac

  # Bind interface: default 0.0.0.0 (all interfaces — works everywhere). Optionally restrict
  # to a specific IP; offer the detected Tailscale address as a suggestion (never forced).
  ts_ip="$(detect_tailscale_ip)"
  if [ -n "$ts_ip" ]; then
    echo "  Bind IP: blank = 0.0.0.0 (all interfaces). To restrict, enter a specific IP —"
    echo "           e.g. your Tailscale address $ts_ip (serves only tailnet peers)."
  else
    echo "  Bind IP: blank = 0.0.0.0 (all interfaces). Enter a specific IP to restrict exposure."
  fi
  extra_bind="$(ask 'Bind IP (BIND_IP)' '0.0.0.0')"

  umask 077  # central.env holds secrets -> create it readable only by the owner
  cat > "$ENV_FILE" <<EOF
# agentistics Team Mode — generated by ./central.sh init
# Holds secrets. NEVER commit this file (it is gitignored).

APP_PORT=$port
BIND_IP=${extra_bind:-0.0.0.0}

# Database. Leave as-is to use the bundled local Mongo (started automatically). To use an
# external cluster (e.g. Atlas), set the full connection string here — central.sh then does NOT
# start the local Mongo. No leading space after '='.
#   MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/
MONGO_URL=mongodb://mongo:27017/?replicaSet=rs0
MONGO_DB=agentistics

AGENTISTICS_TEAM_CENTRAL=1
AGENTISTICS_TEAM_ORG=$org

AGENTISTICS_TEAM_SESSION_SECRET=$secret
AGENTISTICS_TEAM_INGEST_TOKEN=$ingest
AGENTISTICS_CENTRAL_USER=
EOF
  chmod 600 "$ENV_FILE"

  echo
  echo "Wrote $ENV_FILE (chmod 600)."
  echo "  Bind: ${extra_bind:-0.0.0.0}"
  echo "  No dashboard password is set here — on first boot the browser asks you to create the"
  echo "  OWNER account, using the one-time setup token the central prints to its log."
  echo
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd="${1:-help}"
case "$cmd" in
  init)
    init_env
    ;;
  up)
    # Flags, so an unattended rebuild never stops on a question. The `agentop` side resolves them
    # (rebuild-flags.ts) and hands this script an already-decided answer; the same words work by
    # hand. Unset means "ask, as before" for the setup prompt and "cached build" for the image —
    # a plain `up` must not start doing full no-cache builds.
    setup_answer=""
    build_cache=""
    shift || true
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -y|--yes)
          if [ "$setup_answer" = "no" ]; then
            echo "-y and -n contradict each other — pass one." >&2; exit 1
          fi
          setup_answer="yes" ;;
        -n|--no)
          if [ "$setup_answer" = "yes" ]; then
            echo "-y and -n contradict each other — pass one." >&2; exit 1
          fi
          setup_answer="no" ;;
        --cache)
          if [ "$build_cache" = "fresh" ]; then
            echo "--cache and --no-cache contradict each other — pass one." >&2; exit 1
          fi
          build_cache="reuse" ;;
        --no-cache)
          if [ "$build_cache" = "reuse" ]; then
            echo "--cache and --no-cache contradict each other — pass one." >&2; exit 1
          fi
          build_cache="fresh" ;;
        *)
          echo "Unknown option for up: $1" >&2
          echo "Run './central.sh help' for usage." >&2
          exit 1 ;;
      esac
      shift
    done

    if [ ! -f "$ENV_FILE" ]; then
      if [ "$setup_answer" = "no" ]; then
        echo "$ENV_FILE not found, and -n says not to create it. Run './central.sh init' first." >&2
        exit 1
      fi
      echo "$ENV_FILE not found — let's create it."
      init_env
    elif [ "$setup_answer" = "yes" ]; then
      init_env
    elif [ -z "$setup_answer" ] && [ -t 0 ]; then
      reply=""
      read -rp "$ENV_FILE exists. Re-run interactive setup? [y/N]: " reply || true
      case "$reply" in [yY]*) init_env ;; esac
    fi
    # --build rebuilds the image; --force-recreate is ESSENTIAL — plain `up -d`
    # does NOT recreate the container after a rebuild, so new code wouldn't run.
    # --remove-orphans cleans up a previously-bundled local Mongo container when you switch
    # to an external MONGO_URL (its data volume is preserved).
    # The BIND_IP default changed from 0.0.0.0 (every interface) to 127.0.0.1 (this host).
    # An existing install that reached the central over the LAN or a tailnet without setting
    # BIND_IP would silently stop being reachable, so say so instead of letting them find out.
    if [ -f "$ENV_FILE" ] && ! grep -qE '^BIND_IP=' "$ENV_FILE"; then
      echo
      echo "  NOTE: BIND_IP now defaults to 127.0.0.1 (this host only) instead of 0.0.0.0."
      echo "        Local access and tunnels are unaffected. If teammates reached this central"
      echo "        directly over the LAN or a tailnet, add one line to $ENV_FILE:"
      echo "          BIND_IP=0.0.0.0        # the whole LAN, as before"
      echo "          BIND_IP=100.x.y.z      # or just your Tailscale address"
      echo
    fi
    if [ "$build_cache" = "fresh" ]; then
      echo
      echo "  Building the image FROM SCRATCH (--no-cache): a full dependency install and frontend"
      echo "  build inside the container, so this takes several minutes. Pass --cache to reuse"
      echo "  Docker's layer cache when you only want the container recreated."
      echo
      compose build --no-cache
    else
      compose build
    fi
    migrate_volume_ownership
    compose up -d --force-recreate --remove-orphans
    echo
    if uses_local_db; then
      echo "Database: bundled local Mongo (docker/central.localdb.yml)."
    else
      echo "Database: external MONGO_URL — local Mongo NOT started."
    fi
    compose ps
    print_access_url
    ;;
  restart)
    compose restart app
    print_access_url
    ;;
  logs)
    docker compose -p "$PROJECT" logs -f app
    ;;
  status)
    docker compose -p "$PROJECT" ps
    ;;

  doctor)
    # Run it inside the container on purpose: that is where central.env is the live
    # environment AND where MongoDB is reachable, so the owner-MFA and token checks
    # can actually run instead of reporting "could not verify".
    compose exec -T app bun run packages/server/bin/cli.ts doctor "${@:2}"
    ;;
  setup-token)
    # Same reason as doctor: the database is only reachable from inside the compose network.
    compose exec -T app bun run packages/server/bin/cli.ts setup-token
    ;;
  reset-password)
    # The recovery path when the last owner is locked out — there is no e-mail-based reset,
    # and this central has no mail server to send one through. Same in-container reason.
    compose exec -T app bun run packages/server/bin/cli.ts reset-password "${@:2}"
    ;;
  down)
    # Note: no `-v` — the Mongo data volume is preserved. Add it manually only
    # when you truly want to wipe all stored team data.
    compose down
    ;;
  pull)
    compose build --pull
    compose up -d --force-recreate --remove-orphans
    ;;
  help|-h|--help)
    # Print the contiguous header comment block (lines 2.. until the first non-# line).
    awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    echo "Run './central.sh help' for usage." >&2
    exit 1
    ;;
esac
