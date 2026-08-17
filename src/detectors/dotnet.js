'use strict';

const fs = require('fs');
const path = require('path');

function findFiles(dir, ext, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'bin' ||
      entry.name === 'obj' ||
      entry.name.startsWith('.')
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFiles(full, ext, out);
    } else if (entry.name.endsWith(ext)) {
      out.push(full);
    }
  }
}

/**
 * Detect .NET project facts from a repo root. Pure function.
 *
 * @param {string} repoRoot
 * @returns {Object|null} DotnetFacts, or null if no *.csproj/*.sln found
 */
function detectDotnet(repoRoot) {
  const csprojFiles = [];
  const slnFiles = [];
  findFiles(repoRoot, '.csproj', csprojFiles);
  findFiles(repoRoot, '.sln', slnFiles);

  if (csprojFiles.length === 0 && slnFiles.length === 0) {
    return null;
  }

  const projects = csprojFiles.map((f) => {
    const text = fs.readFileSync(f, 'utf8');
    const tfMatch = text.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
    return {
      name: path.basename(f, '.csproj'),
      path: path.relative(repoRoot, f).replace(/\\/g, '/'),
      targetFramework: tfMatch ? tfMatch[1] : null,
    };
  });

  return {
    detected: true,
    solutionFiles: slnFiles.map((f) => path.relative(repoRoot, f).replace(/\\/g, '/')),
    projects,
  };
}

module.exports = { detectDotnet };
