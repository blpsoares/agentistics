#!/usr/bin/env bash
# Install agentop — agentistics CLI
# Usage: curl -fsSL https://raw.githubusercontent.com/blpsoares/agentistics/main/install.sh | bash
#        sudo curl -fsSL https://raw.githubusercontent.com/blpsoares/agentistics/main/install.sh | bash

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
