#!/usr/bin/env bash
# Install agentop — agentistics CLI
# Usage: curl -fsSL https://agentop.openvibes.tech/cli | bash
#        sudo curl -fsSL https://agentop.openvibes.tech/cli | bash

set -euo pipefail

REPO="blpsoares/agentistics"
BINARY="agentop"
RELEASE_URL="https://github.com/${REPO}/releases/latest/download/${BINARY}"

# ── Determine install directory ────────────────────────────────────────────
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="${HOME}/.local/bin"
fi

# ── Check platform ─────────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" != "Linux" ]]; then
  echo "Error: only Linux binaries are published at the moment (detected: $OS)."
  exit 1
fi

if [[ "$ARCH" != "x86_64" ]]; then
  echo "Error: only x86_64 binaries are published at the moment (detected: $ARCH)."
  exit 1
fi

# ── Runtime dependency: tmux ────────────────────────────────────────────────
#
# agentop's session manager (`agentop session`, the cockpit's Sessions tab) is built on tmux —
# there is no other backend (see packages/server/server/sessions/dependency-plan.ts, which the
# already-installed binary uses to explain a MISSING tmux to someone who skipped this script or
# removed the package afterwards). Without it every session-related feature fails the moment it is
# used, well after the install already reported success — a confusing place to first learn about a
# missing dependency. So it is installed HERE, proactively, the same way any competent install
# script pulls in what it needs — never silently, and never left to fail on first use.
#
# `apt` is checked before `apt-get` (Debian/Ubuntu ship both; a machine with both gets the modern
# one) and `apt-get update` runs first because a freshly booted cloud VM or container image
# routinely has an empty or stale package index — `apt-get install` alone fails on exactly the
# machines this script most often runs on. `pacman -Sy` syncs the database for the same reason.
if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux not found — agentop's session manager needs it. Installing…"

  TMUX_SUDO=()
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
      TMUX_SUDO=(sudo)
    else
      echo "  Not root and no sudo on PATH — install tmux yourself, e.g.: apt install tmux"
    fi
  fi

  if [[ "${EUID:-$(id -u)}" -eq 0 || ${#TMUX_SUDO[@]} -gt 0 ]]; then
    if command -v apt >/dev/null 2>&1; then
      "${TMUX_SUDO[@]}" apt-get update -qq 2>/dev/null || true
      "${TMUX_SUDO[@]}" apt install -y tmux
    elif command -v apt-get >/dev/null 2>&1; then
      "${TMUX_SUDO[@]}" apt-get update -qq 2>/dev/null || true
      "${TMUX_SUDO[@]}" apt-get install -y tmux
    elif command -v dnf >/dev/null 2>&1; then
      "${TMUX_SUDO[@]}" dnf install -y tmux
    elif command -v yum >/dev/null 2>&1; then
      "${TMUX_SUDO[@]}" yum install -y tmux
    elif command -v pacman >/dev/null 2>&1; then
      "${TMUX_SUDO[@]}" pacman -Sy --noconfirm tmux
    elif command -v zypper >/dev/null 2>&1; then
      "${TMUX_SUDO[@]}" zypper install -y tmux
    elif command -v apk >/dev/null 2>&1; then
      "${TMUX_SUDO[@]}" apk add tmux
    elif command -v brew >/dev/null 2>&1; then
      brew install tmux
    else
      echo "  No supported package manager found — install tmux manually."
    fi
  fi

  if command -v tmux >/dev/null 2>&1; then
    echo "  tmux installed ($(tmux -V))."
  else
    echo "  tmux is still missing — agentop will run, but session features (agentop session," \
         "the cockpit's Sessions tab) will not work until it is installed."
  fi
  echo ""
fi

# ── Download ───────────────────────────────────────────────────────────────
echo "Downloading ${BINARY} from ${RELEASE_URL} …"
mkdir -p "$INSTALL_DIR"
curl -fsSL "$RELEASE_URL" -o "${INSTALL_DIR}/${BINARY}"
chmod +x "${INSTALL_DIR}/${BINARY}"

# ── PATH hint ──────────────────────────────────────────────────────────────
if ! echo ":${PATH}:" | grep -q ":${INSTALL_DIR}:"; then
  echo ""
  echo "NOTE: ${INSTALL_DIR} is not in your PATH."
  echo "Add it with:"
  echo ""
  echo "  echo 'export PATH=\"\${HOME}/.local/bin:\${PATH}\"' >> ~/.bashrc && source ~/.bashrc"
  echo ""
fi

echo "Installed: ${INSTALL_DIR}/${BINARY}"
echo ""
echo "Usage:"
echo "  ${BINARY} server       # web dashboard + daemon"
echo "  ${BINARY} tui          # terminal TUI"
echo "  ${BINARY} watch        # daemon only"
