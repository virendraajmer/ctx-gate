'use strict';

// Fixed block appended to generated AGENTS.md only when codebase-memory-mcp
// is detected on PATH for the target repo (see src/mcp/codebaseMemoryClient.js),
// directing agents to its graph tools instead of grep/full-file reads for
// structural code questions. Omitted entirely when the binary isn't
// available -- there's nothing to route to, and the efficiency block's
// "search first, read after" rule already covers the plain-grep fallback.

const MCP_GUIDANCE_BLOCK = [
  '## Code search',
  '- codebase-memory-mcp is available in this repo. For structural code',
  '  questions -- finding a symbol, tracing callers/callees, understanding',
  '  architecture -- prefer its graph tools (search_graph, trace_path,',
  '  get_code_snippet, query_graph, get_architecture) over grep or reading',
  '  whole files to locate something.',
  '- Fall back to grep/file search only for literal text, non-code content,',
  '  or areas the graph has no coverage for.',
].join('\n');

module.exports = { MCP_GUIDANCE_BLOCK };
