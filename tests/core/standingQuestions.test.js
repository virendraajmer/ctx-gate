'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');

const { buildStandingEntries } = require('../../src/core/standingQuestions');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

// readline only asks for the next line once the previous `.question()` has
// resolved and registered a new listener. If we push all scripted lines
// synchronously, readline consumes them all on the first 'data' event
// (only the first line reaches the pending question; the rest are lost)
// and the stream ends before later questions are even asked. Deferring
// each push to its own macrotask via setImmediate paces the lines out one
// per prompt, matching how a real interactive terminal would behave.
function scriptedStreams(lines) {
  const queue = [...lines];
  const input = new Readable({
    read() {
      const line = queue.shift();
      setImmediate(() => {
        if (line === undefined) {
          this.push(null);
        } else {
          this.push(`${line}\n`);
        }
      });
    },
  });
  const output = new Writable({
    write(chunk, enc, cb) {
      cb();
    },
  });
  return { input, output };
}

test('buildStandingEntries skips error-handling when a sniffer detects it, prompts the rest', async () => {
  const repoRoot = path.join(FIXTURES, 'standing-detect-basic');
  // 5 prompts in order: done-means, high-risk-paths, naming, performance, logging
  // (error-handling is skipped because standing-detect-basic has Result<> usage).
  const { input, output } = scriptedStreams(['', 'src/custom/', '', '', 'winston']);

  const entries = await buildStandingEntries(repoRoot, { input, output });

  assert.equal(entries.length, 6);

  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));

  assert.equal(byId['done-means'].status, 'default');
  assert.equal(byId['done-means'].value, 'tests pass + CI green');

  assert.equal(byId['high-risk-paths'].status, 'confirmed');
  assert.equal(byId['high-risk-paths'].value, 'src/custom/');

  assert.equal(byId['error-handling'].status, 'detected');
  assert.equal(
    byId['error-handling'].value,
    'Services return a Result/Either type rather than throwing exceptions'
  );

  assert.equal(byId['naming-convention'].status, 'default');
  assert.equal(byId['naming-convention'].value, '');

  assert.equal(byId['performance-target'].status, 'default');
  assert.equal(byId['performance-target'].value, 'not measured');

  assert.equal(byId['logging-convention'].status, 'confirmed');
  assert.equal(byId['logging-convention'].value, 'winston');
});

test('buildStandingEntries asks all 6 questions when nothing is detected', async () => {
  const repoRoot = path.join(FIXTURES, 'empty-repo');
  const { input, output } = scriptedStreams(['', '', '', '', '', '']);

  const entries = await buildStandingEntries(repoRoot, { input, output });

  assert.equal(entries.length, 6);
  assert.ok(entries.every((e) => e.status !== 'detected'));
});
