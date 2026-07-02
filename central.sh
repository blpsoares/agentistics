#!/usr/bin/env bash
#
# central.sh — manage the agentistics Team Mode central (Docker Compose).
#
# Wraps `docker compose` with the project name and env file pre-set so you
# don't have to remember the flags. See docs/DEPLOY.md for details.
#
# Usage: ./central.sh <command>
#
#   up        Build the image and (re)create the containers  [most common]
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

compose() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" "$@"; }

cmd="${1:-help}"
case "$cmd" in
  up)
    # --build rebuilds the image; --force-recreate is ESSENTIAL — plain `up -d`
    # does NOT recreate the container after a rebuild, so new code wouldn't run.
    compose up -d --build --force-recreate
    echo
    compose ps
    ;;
  restart)
    compose restart app
    ;;
  logs)
    # No --env-file needed for logs, but harmless to keep the wrapper uniform.
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
    compose up -d --force-recreate
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
