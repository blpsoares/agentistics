#!/usr/bin/env bash
#
# central.sh — manage the agentistics Team Mode central (Docker Compose).
#
# Wraps `docker compose` with the project name and env file pre-set, and can
# generate central.env interactively (auto-filling secrets with openssl).
# See docs/DEPLOY.md for details.
#
# Usage: ./central.sh <command>
#
#   up        Ensure central.env exists (offer interactive setup), then build
#             and (re)create the containers.                      [most common]
#   init      (Re)generate central.env interactively — asks each value and can
#             auto-generate the secrets with openssl.
#   restart   Restart the app container WITHOUT rebuilding
#   logs      Follow the app container logs (Ctrl-C to stop)
#   status    Show container + health status
#   down      Stop and remove the containers (KEEPS the data volume)
#   pull      Rebuild from a fresh base image (git pull first, then this)
#   help      Show this message
#
# Override the defaults with env vars if needed:
#   PROJECT=team-mode   ENV_FILE=central.env   ./central.sh up
#
set -euo pipefail

# Run from the directory this script lives in, so relative paths (central.env,
# docker-compose.yml) resolve regardless of where you invoke it from.
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
  case "$url" in
    *mongo:27017*) return 0 ;;  # internal service host → bundled Mongo
    *) return 1 ;;              # external cluster → do NOT start local Mongo
  esac
}

# Compose file set: always the base; add the local-Mongo overlay only when using the bundled DB.
compose_files() {
  if uses_local_db; then
    printf '%s' "-f docker-compose.yml -f docker-compose.localdb.yml"
  else
    printf '%s' "-f docker-compose.yml"
  fi
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
  bind="${bind:-0.0.0.0}"
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

# Detect this host's Tailscale IPv4, if the CLI is present (empty otherwise).
detect_tailscale_ip() {
  command -v tailscale >/dev/null 2>&1 || return 0
  tailscale ip -4 2>/dev/null | head -1 || true
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

  local port org password secret ingest ts_ip extra_bind
  # 48080 by default — a member/dev instance uses 47291, so the central takes a distinct
  # port to avoid colliding with a local agentistics on the same machine.
  port="$(ask 'Host port (APP_PORT)' '48080')"
  org="$(ask 'Org name (AGENTISTICS_TEAM_ORG)' 'default')"
  password="$(ask_secret 'Admin password (AGENTISTICS_TEAM_PASSWORD)' 'openssl rand -hex 24')"
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

AGENTISTICS_TEAM_PASSWORD=$password
AGENTISTICS_TEAM_SESSION_SECRET=$secret
AGENTISTICS_TEAM_INGEST_TOKEN=$ingest
AGENTISTICS_CENTRAL_USER=
EOF
  chmod 600 "$ENV_FILE"

  echo
  echo "Wrote $ENV_FILE (chmod 600)."
  echo "  Bind: ${extra_bind:-0.0.0.0}"
  echo "  Keep the password — share it with your team to log in to the dashboard."
  echo
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd="${1:-help}"
case "$cmd" in
  init)
    init_env
    ;;
  up)
    if [ ! -f "$ENV_FILE" ]; then
      echo "$ENV_FILE not found — let's create it."
      init_env
    elif [ -t 0 ]; then
      reply=""
      read -rp "$ENV_FILE exists. Re-run interactive setup? [y/N]: " reply || true
      case "$reply" in [yY]*) init_env ;; esac
    fi
    # --build rebuilds the image; --force-recreate is ESSENTIAL — plain `up -d`
    # does NOT recreate the container after a rebuild, so new code wouldn't run.
    # --remove-orphans cleans up a previously-bundled local Mongo container when you switch
    # to an external MONGO_URL (its data volume is preserved).
    compose up -d --build --force-recreate --remove-orphans
    echo
    if uses_local_db; then
      echo "Database: bundled local Mongo (docker-compose.localdb.yml)."
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
