'use strict';

const fs = require('fs');
const path = require('path');

const CODE_EXTS = ['.jsx', '.tsx', '.js', '.ts'];
const ROUTE_JSX_RE = /<Route\s+[^>]*path\s*=\s*["'`]([^"'`]+)["'`][^>]*>/g;

function walk(dir, exts, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

function detectNextScreens(repoRoot) {
  const screens = [];
  for (const pagesRoot of [path.join(repoRoot, 'pages'), path.join(repoRoot, 'src', 'pages')]) {
    if (!fs.existsSync(pagesRoot)) continue;
    const files = [];
    walk(pagesRoot, CODE_EXTS, files);
    for (const f of files) {
      const rel = path.relative(pagesRoot, f);
      const base = rel.replace(/\.(jsx|tsx|js|ts)$/, '');
      if (/^_app|^_document|^api([\\/]|$)/.test(base)) continue;
      const routeBase = base.replace(/\\/g, '/').replace(/\/index$/, '').replace(/^index$/, '');
      screens.push({
        name: path.basename(base) === 'index' ? path.basename(path.dirname(base)) || 'index' : path.basename(base),
        route: routeBase === '' ? '/' : `/${routeBase}`,
        path: path.relative(repoRoot, f).replace(/\\/g, '/'),
        confidence: 'high',
        source: 'next-pages-dir',
      });
    }
  }
  for (const appRoot of [path.join(repoRoot, 'app'), path.join(repoRoot, 'src', 'app')]) {
    if (!fs.existsSync(appRoot)) continue;
    const files = [];
    walk(appRoot, CODE_EXTS, files);
    for (const f of files) {
      if (!/[\\/]page\.(jsx|tsx|js|ts)$/.test(f)) continue;
      const dir = path.dirname(path.relative(appRoot, f));
      const route = dir === '.' ? '/' : `/${dir.replace(/\\/g, '/')}`;
      screens.push({
        name: dir === '.' ? 'root' : path.basename(dir),
        route,
        path: path.relative(repoRoot, f).replace(/\\/g, '/'),
        confidence: 'high',
        source: 'next-app-dir',
      });
    }
  }
  return screens;
}

function detectRouteTableScreens(repoRoot, srcFiles) {
  const screens = [];
  for (const f of srcFiles) {
    const text = fs.readFileSync(f, 'utf8');
    ROUTE_JSX_RE.lastIndex = 0;
    let m;
    while ((m = ROUTE_JSX_RE.exec(text))) {
      screens.push({
        name: path.basename(f).replace(/\.(jsx|tsx|js|ts)$/, ''),
        route: m[1],
        path: path.relative(repoRoot, f).replace(/\\/g, '/'),
        confidence: 'high',
        source: 'route-table',
      });
    }
  }
  return screens;
}

function detectFallbackScreens(repoRoot) {
  const screens = [];
  for (const rel of ['src/pages', 'src/screens', 'pages']) {
    const dir = path.join(repoRoot, rel);
    if (!fs.existsSync(dir)) continue;
    const files = [];
    walk(dir, CODE_EXTS, files);
    for (const f of files) {
      screens.push({
        name: path.basename(f).replace(/\.(jsx|tsx|js|ts)$/, ''),
        route: null,
        path: path.relative(repoRoot, f).replace(/\\/g, '/'),
        confidence: 'low',
        source: 'folder-name-fallback',
      });
    }
  }
  return screens;
}

/**
 * Detect React project facts (routes/screens). Only meaningful when
 * nodeFacts indicates react as a dependency. Pure function.
 *
 * @param {string} repoRoot
 * @param {Object|null} nodeFacts - result of detectNode(repoRoot)
 * @returns {Object|null} ReactFacts, or null if React isn't a dependency
 */
function detectReact(repoRoot, nodeFacts) {
  if (!nodeFacts || !nodeFacts.detected || !nodeFacts.dependencies.includes('react')) {
    return null;
  }

  const deps = nodeFacts.dependencies;
  let router = 'none';
  if (deps.includes('next')) {
    router = 'next';
  } else if (deps.includes('react-router-dom') || deps.includes('react-router')) {
    router = 'react-router';
  }

  let screens = [];
  if (router === 'next') {
    screens = detectNextScreens(repoRoot);
  } else if (router === 'react-router') {
    const srcFiles = [];
    walk(path.join(repoRoot, 'src'), CODE_EXTS, srcFiles);
    screens = detectRouteTableScreens(repoRoot, srcFiles);
  }

  if (screens.length === 0) {
    screens = detectFallbackScreens(repoRoot);
  }

  return { detected: true, router, screens };
}

module.exports = { detectReact };
