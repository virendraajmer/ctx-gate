'use strict';

// Deliberately not a plugin framework — a plain lookup map. Add a new
// agent CLI by writing src/adapters/<name>.js implementing the same four
// functions as copilot.js and adding one line here. src/core/*.js must
// never import from this file or from any individual adapter.

const REGISTRY = {
  copilot: require('./copilot'),
};

/**
 * @param {string} name
 * @returns {typeof import('./copilot')}
 */
function resolveAdapter(name) {
  const adapter = REGISTRY[name];
  if (!adapter) {
    throw new Error(`Unknown agent adapter: ${name}`);
  }
  return adapter;
}

module.exports = { resolveAdapter, REGISTRY };
