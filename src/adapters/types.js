'use strict';

/**
 * Normalized, agent-agnostic shapes shared by src/core/*.js.
 *
 * These typedefs are the stable contract between hook-format adapters
 * (src/adapters/copilot.js today, src/adapters/claude-code.js etc. later)
 * and the core gate/learn/enforce logic. Nothing under src/core/ should
 * ever read a field name specific to one agent's hook payload — only
 * these shapes.
 *
 * This file intentionally has no runtime exports; it exists for the
 * JSDoc typedefs below so editors/tools can check shapes across the
 * adapter boundary.
 */

/**
 * @typedef {Object} CheckRequest
 * @property {string} prompt - raw user prompt text
 * @property {string} sessionId - opaque per-session id from the calling agent
 * @property {string} cwd - repo root the agent is operating in
 * @property {string} [agentName] - which adapter produced this, for logging only
 * @property {Object} [raw] - original untranslated payload, kept for debugging/logs only
 */

/**
 * @typedef {Object} CheckMatch
 * @property {string} path
 * @property {string} [symbol]
 * @property {string} kind
 * @property {'high'|'low'} confidence
 */

/**
 * @typedef {Object} LearnedSuggestion
 * @property {string} id
 * @property {Object} suggestion
 * @property {string} confidence
 */

/**
 * @typedef {Object} GateQuestion
 * @property {string} slot
 * @property {string} question
 */

/**
 * @typedef {Object} CheckResponse
 * @property {boolean} skipped - true if short-circuited (short follow-up / already checked this session)
 * @property {CheckMatch[]} matches
 * @property {string[]} standingNotes
 * @property {LearnedSuggestion[]} learnedSuggestions
 * @property {string[]} unknownSlots - e.g. ['scope','acceptance']
 * @property {string[]} vagueTermsFound
 * @property {GateQuestion[]} questions
 * @property {'off'|'warn'} warningLevel - informational only; 'block' is decided by EnforceDecision
 */

/**
 * @typedef {Object} LearnRequest
 * @property {string} sessionId
 * @property {string} toolName
 * @property {string[]} filesTouched
 * @property {string} timestamp - ISO 8601
 * @property {string} [answerText] - best-effort extracted answer, may be absent
 */

/**
 * @typedef {Object} EnforceRequest
 * @property {CheckRequest} check
 * @property {string} toolName
 * @property {'read'|'write'} changeType
 */

/**
 * @typedef {Object} EnforceDecision
 * @property {'allow'|'warn'|'deny'} decision
 * @property {string} [reason]
 */

module.exports = {};
