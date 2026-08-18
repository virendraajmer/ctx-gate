'use strict';

// Translates between GitHub Copilot's agent-hook JSON payloads and the
// normalized CheckRequest/CheckResponse/LearnRequest/EnforceRequest/
// EnforceDecision shapes defined in src/adapters/types.js.
//
// This is the ONLY file in the codebase allowed to know Copilot's actual
// hook field names. src/core/*.js must never import this module.
//
// Copilot's agent hooks are in preview as of this writing; every field
// name below is a best-effort guess and MUST be verified against the
// current hooks reference before this is relied on in production.

/**
 * @param {string} stdinJson - raw JSON text read from stdin for the
 *   userPromptSubmitted hook
 * @returns {import('./types').CheckRequest}
 */
function parseCheckInput(stdinJson) {
  const payload = JSON.parse(stdinJson);
  // TODO(hooks-preview): verify field names (prompt/session_id/cwd) against
  // the current VS Code Copilot userPromptSubmitted hook payload schema.
  return {
    prompt: payload.prompt ?? '',
    sessionId: payload.session_id ?? payload.sessionId ?? '',
    cwd: payload.cwd ?? process.cwd(),
    agentName: 'copilot',
    raw: payload,
  };
}

/**
 * @param {import('./types').CheckResponse} checkResponse
 * @returns {Object} JSON-serializable object to write to stdout
 */
function formatCheckOutput(checkResponse) {
  // TODO(hooks-preview): verify the expected output field name(s) the
  // userPromptSubmitted hook uses to inject extra context back into the
  // agent. Using `additionalContext` as a best guess.
  if (checkResponse.skipped) {
    const lines = [];
    if (checkResponse.sessionWarning) {
      lines.push(checkResponse.sessionWarning.message);
    }
    return { additionalContext: lines.join('\n') };
  }
  const lines = [];
  if (checkResponse.sessionWarning) {
    lines.push(checkResponse.sessionWarning.message);
  }
  for (const t of checkResponse.unknownTermsCrossed || []) {
    lines.push(
      `"${t.term}" has appeared in ${t.sessionCount} requests but is not defined anywhere in the glossary or the codebase. ` +
        `Run \`ctx-gate glossary add ${t.term}\` to define it.`
    );
  }
  if (checkResponse.warningLevel === 'warn') {
    lines.push('This request looks underspecified — proceeding anyway.');
  }
  for (const note of checkResponse.standingNotes) {
    lines.push(`Standing rule: ${note}`);
  }
  for (const match of checkResponse.matches) {
    const loc = match.symbol ? `${match.path}#${match.symbol}` : match.path;
    lines.push(`Matched (${match.confidence}): ${loc}`);
  }
  for (const suggestion of checkResponse.learnedSuggestions) {
    lines.push(`Learned suggestion (${suggestion.id}): ${JSON.stringify(suggestion.suggestion)}`);
  }
  for (const q of checkResponse.questions) {
    lines.push(`Ask: ${q.question}`);
  }
  return { additionalContext: lines.join('\n') };
}

/**
 * @param {string} stdinJson - raw JSON text read from stdin for the
 *   postToolUse hook
 * @returns {import('./types').LearnRequest}
 */
function parseLearnInput(stdinJson) {
  const payload = JSON.parse(stdinJson);
  // TODO(hooks-preview): verify field names (tool_name/tool_input/session_id)
  // against the current postToolUse hook payload schema.
  const toolInput = payload.tool_input ?? payload.toolInput ?? {};
  const filesTouched = Array.isArray(toolInput.files)
    ? toolInput.files
    : toolInput.path
      ? [toolInput.path]
      : [];
  return {
    sessionId: payload.session_id ?? payload.sessionId ?? '',
    toolName: payload.tool_name ?? payload.toolName ?? '',
    filesTouched,
    timestamp: new Date().toISOString(),
    answerText: payload.answer_text ?? undefined,
  };
}

/**
 * @param {string} stdinJson - raw JSON text read from stdin for the
 *   preToolUse hook
 * @returns {import('./types').EnforceRequest}
 */
function parseEnforceInput(stdinJson) {
  const payload = JSON.parse(stdinJson);
  // TODO(hooks-preview): verify field names against the current preToolUse
  // hook payload schema, including how read vs. write tools are identified.
  const toolName = payload.tool_name ?? payload.toolName ?? '';
  const writeTools = new Set(['editFiles', 'createFile', 'applyPatch', 'writeFile']);
  return {
    check: {
      prompt: payload.prompt ?? '',
      sessionId: payload.session_id ?? payload.sessionId ?? '',
      cwd: payload.cwd ?? process.cwd(),
      agentName: 'copilot',
      raw: payload,
    },
    toolName,
    changeType: writeTools.has(toolName) ? 'write' : 'read',
  };
}

/**
 * @param {import('./types').EnforceDecision} decision
 * @returns {Object} JSON-serializable object to write to stdout
 */
function formatEnforceOutput(decision) {
  // TODO(hooks-preview): verify the deny/allow field name(s) the
  // preToolUse hook expects (e.g. `decision`/`permission`).
  return {
    decision: decision.decision,
    reason: decision.reason ?? '',
  };
}

module.exports = {
  parseCheckInput,
  formatCheckOutput,
  parseLearnInput,
  parseEnforceInput,
  formatEnforceOutput,
};
