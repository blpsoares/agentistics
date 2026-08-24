#!/usr/bin/env node
// Thin exec shim — the real CLI is the native binary postinstall.js downloaded
// alongside this file. This wrapper exists only because npm's `bin` field
// needs a file it can chmod +x and put on PATH; it does not reimplement or
// rebundle any agentop behavior.
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BIN_PATH = path.join(__dirname, 'agentop-bin');

if (!fs.existsSync(BIN_PATH)) {
  console.error(
    'agentop binary not found — the npm postinstall step did not complete. Try reinstalling: npm i -g @agentistics/agentop'
  );
  process.exit(1);
}

const result = spawnSync(BIN_PATH, process.argv.slice(2), { stdio: 'inherit' });

if (result.error) {
  console.error(`Failed to launch agentop: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
