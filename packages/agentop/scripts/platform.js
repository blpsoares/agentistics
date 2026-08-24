// Pure platform resolution for the @agentistics/agentop npm postinstall.
//
// Mirrors the gate in /install.sh (Linux x86_64 only, same error message shape).
// install.sh cannot be sourced from here — it is fetched standalone via
// `curl | bash` with no local checkout at run time — so this check is kept in
// sync by hand. See CLAUDE.md's PKG_FILES comment in release.yml for the same
// documented trade-off (two things that must agree, checked nowhere but here).

const REPO = 'blpsoares/agentistics';
const BINARY = 'agentop';

// node's process.platform/process.arch -> the `uname -s` / `uname -m` strings
// install.sh's error messages are phrased in terms of, so a Node-side failure
// reads the same way as a curl|bash one.
const OS_NAMES = {
  linux: 'Linux',
  darwin: 'Darwin',
  win32: 'Windows',
};

const ARCH_NAMES = {
  x64: 'x86_64',
  arm64: 'arm64',
  ia32: 'x86',
};

function displayOs(platform) {
  return OS_NAMES[platform] || platform;
}

function displayArch(arch) {
  return ARCH_NAMES[arch] || arch;
}

/**
 * @param {string} platform - process.platform value
 * @param {string} arch - process.arch value
 * @param {string} version - the npm package's own version (no leading "v")
 * @returns {{ok: true, url: string} | {ok: false, message: string}}
 */
function resolveAsset(platform, arch, version) {
  if (platform !== 'linux') {
    return {
      ok: false,
      message: `Error: only Linux binaries are published at the moment (detected: ${displayOs(platform)}).`,
    };
  }

  if (arch !== 'x64') {
    return {
      ok: false,
      message: `Error: only x86_64 binaries are published at the moment (detected: ${displayArch(arch)}).`,
    };
  }

  return {
    ok: true,
    url: `https://github.com/${REPO}/releases/download/v${version}/${BINARY}`,
  };
}

module.exports = { resolveAsset, REPO, BINARY };
