'use strict';

// Writes .github/hooks/ctx-gate.json directly from `ctx-gate init`, so a
// plain `npm install -g ctx-gate && ctx-gate init` is self-sufficient and
// doesn't require install.ps1/install.sh just to wire up Copilot's hooks.
//
// `node "<jsPath>" <subcommand>` is valid as both a bash command and a
// PowerShell command, so one resolved path covers both shells -- no
// separate .ps1 wrapper indirection needed here.
//
// install.ps1/install.sh still overwrite this file with their own
// version-pinned resolution afterward; this is just the fallback so the
// hooks file exists at all for npm-only installs.

const fs = require('fs');
const path = require('path');

function buildHooksConfig(ctxGateJsPath) {
  const jsPath = ctxGateJsPath.replace(/\\/g, '/');
  const commandFor = (subcommand) => `node "${jsPath}" ${subcommand}`;
  return {
    version: 1,
    hooks: {
      userPromptSubmitted: [
        { type: 'command', bash: commandFor('check'), powershell: commandFor('check'), timeout: 10 },
      ],
      postToolUse: [
        { type: 'command', bash: commandFor('learn'), powershell: commandFor('learn'), timeout: 10 },
      ],
      preToolUse: [
        { type: 'command', bash: commandFor('enforce'), powershell: commandFor('enforce'), timeout: 10 },
      ],
    },
  };
}

/**
 * @param {string} repoRoot
 * @param {string} ctxGateJsPath - absolute path to the running bin/ctx-gate.js
 * @returns {string} the path written
 */
function writeHooksFile(repoRoot, ctxGateJsPath) {
  const dir = path.join(repoRoot, '.github', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'ctx-gate.json');
  const text = JSON.stringify(buildHooksConfig(ctxGateJsPath), null, 2);
  fs.writeFileSync(target, text, 'utf8');
  return target;
}

module.exports = { buildHooksConfig, writeHooksFile };
