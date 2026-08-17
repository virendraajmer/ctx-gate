'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { detectDotnet } = require('../../src/detectors/dotnet');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

test('detectDotnet finds csproj/sln and target framework', () => {
  const facts = detectDotnet(path.join(FIXTURES, 'dotnet-basic'));
  assert.equal(facts.detected, true);
  assert.equal(facts.solutionFiles.length, 1);
  assert.equal(facts.projects.length, 1);
  assert.equal(facts.projects[0].targetFramework, 'net8.0');
});

test('detectDotnet returns null when there is no csproj/sln', () => {
  const facts = detectDotnet(path.join(FIXTURES, 'empty-repo'));
  assert.equal(facts, null);
});
