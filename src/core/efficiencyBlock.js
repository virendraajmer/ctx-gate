'use strict';

// Fixed efficiency-rules block written verbatim into every generated
// AGENTS.md. The wording is identical across every repo — only the test
// command and the stack-specific ignore-path extensions are substituted —
// so it stays a stable, cacheable prefix instead of text the optimizer
// rewords on every run. See addon-3-agents-md-efficiency-block.md.

const EFFICIENCY_BLOCK_VERSION = 1;

const BASELINE_IGNORE_PATHS = [
  'node_modules/',
  'dist/',
  'build/',
  '*.lock',
  '*.min.js',
  'generated/',
  'migrations/',
  'test fixtures',
  'sample data',
];

// Extends, never replaces, BASELINE_IGNORE_PATHS.
const STACK_IGNORE_EXTENSIONS = {
  dotnet: ['bin/', 'obj/', 'packages/'],
  python: ['__pycache__/', '.venv/', '*.egg-info/'],
};

const DEFAULT_TEST_COMMANDS = {
  dotnet: 'dotnet test',
  python: 'pytest',
};

/**
 * @param {Object} stacks - manifest.stacks
 * @returns {string} the best test command to show in the block
 */
function resolveTestCommand(stacks) {
  if (stacks.node && stacks.node.detected && stacks.node.testCommand) {
    return stacks.node.testCommand;
  }
  if (stacks.dotnet && stacks.dotnet.detected) {
    return DEFAULT_TEST_COMMANDS.dotnet;
  }
  if (stacks.python && stacks.python.detected) {
    return DEFAULT_TEST_COMMANDS.python;
  }
  return '<test command>';
}

/**
 * @param {string[]} stacksPresent
 * @returns {string[]} baseline ignore paths extended with stack-specific ones
 */
function resolveIgnorePaths(stacksPresent) {
  const extra = [];
  for (const stack of stacksPresent) {
    const additions = STACK_IGNORE_EXTENSIONS[stack];
    if (additions) extra.push(...additions);
  }
  return [...BASELINE_IGNORE_PATHS, ...extra];
}

/**
 * @param {Object} opts
 * @param {string} opts.testCommand
 * @param {string[]} opts.stacksPresent
 * @returns {string} the fixed efficiency-rules block, markdown text
 */
function buildEfficiencyBlock({ testCommand, stacksPresent }) {
  const ignorePaths = resolveIgnorePaths(stacksPresent || []);
  return [
    '## Running commands',
    '- Pipe long output to a file, then read only what matters:',
    `  \`${testCommand} > /tmp/out.log 2>&1; grep -A5 "FAIL\\|Error" /tmp/out.log\``,
    '- Never run a command whose output exceeds ~100 lines directly into chat.',
    '- For builds, surface only error lines, not the full log.',
    '',
    '## Reading files',
    '- Search first, read after. Never read a full file to locate one symbol.',
    '- Read only the needed line range.',
    '- If a file was already read this session, do not read it again.',
    `- Never read: ${ignorePaths.join(', ')}.`,
    '',
    '## Editing files',
    '- Change only the lines that need changing. Never rewrite a whole file for',
    '  a small edit.',
    '- Do not print the full file back after editing it.',
    '',
    '## Response style',
    '- No preamble. Do not restate the request.',
    '- Do not summarise what you did unless asked.',
  ].join('\n');
}

module.exports = {
  EFFICIENCY_BLOCK_VERSION,
  BASELINE_IGNORE_PATHS,
  STACK_IGNORE_EXTENSIONS,
  resolveTestCommand,
  resolveIgnorePaths,
  buildEfficiencyBlock,
};
