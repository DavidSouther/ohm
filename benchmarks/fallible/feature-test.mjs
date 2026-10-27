#!/usr/bin/env node
/**
 * Feature test: the Fallible overhead benchmark runs end to end, reproducibly.
 *
 * Story: a maintainer of the Ohm fallible branches runs one command. The
 * command builds the comparison (pinned baseline support/v17 archive vs the pinned
 * historical fallible archive), measures construction, matching (three regimes), memoization
 * counters, memory and incremental re-match, asserts that every configuration
 * matched the same inputs, and emits results.json plus report tables.
 *
 * Usage: node benchmarks/fallible/feature-test.mjs   (smoke profile, a few minutes)
 * Full publication run: node benchmarks/fallible/run.mjs --profile=full
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out-smoke');
fs.rmSync(out, {recursive: true, force: true});

const run = spawnSync(
  process.execPath,
  [path.join(here, 'run.mjs'), '--profile=smoke', '--out', out],
  {stdio: 'inherit'}
);
assert.equal(run.status, 0, 'run.mjs exits 0 (all sanity assertions pass)');

const paired = spawnSync(
  process.execPath,
  [path.join(here, 'paired.mjs'), '--profile=smoke', '--out', out],
  {stdio: 'inherit'}
);
assert.equal(paired.status, 0, 'paired.mjs exits 0');
const pr = JSON.parse(fs.readFileSync(path.join(out, 'results-paired.json'), 'utf8'));
assert.ok(
  pr.rows.some(
    r => r.kind === 'match' && r.config === 'bang/match' && Number.isFinite(r.ratioMedian)
  ),
  'paired bang/match ratio'
);
assert.ok(
  pr.rows.some(
    r => r.kind === 'match' && r.config === 'bang/recover' && Number.isFinite(r.ratioMedian)
  ),
  'paired bang/recover ratio'
);
assert.ok(
  pr.rows.some(r => r.kind === 'construct' && Number.isFinite(r.ratioMedian)),
  'paired construction ratio'
);

const results = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
assert.equal(results.meta.node, process.version, 'Node version recorded');
assert.match(results.meta.trees.baseline.commit, /^4a40f38f/, 'baseline commit');
assert.match(results.meta.trees.fallible.commit, /^[0-9a-f]{8}/, 'fallible commit');
assert.equal(results.meta.profile, 'smoke');

assert.ok(results.sanity.length >= 10, 'sanity checks recorded');
for (const c of results.sanity) assert.ok(c.ok, `sanity: ${c.name} :: ${c.detail}`);

for (const section of [
  'construction',
  'load',
  'matching',
  'counters',
  'memory',
  'incremental',
]) {
  assert.ok(
    Array.isArray(results[section]) && results[section].length > 0,
    `section ${section}`
  );
}

// Regimes present, with dispersion statistics and pass counts.
const regimes = new Set(results.matching.map(r => r.regime));
for (const r of ['plain-valid', 'bang-valid', 'invalid-single', 'invalid-dense']) {
  assert.ok(regimes.has(r), `regime ${r}`);
}
for (const r of results.matching) {
  assert.ok(r.stats.median > 0 && r.stats.n >= 3, `stats for ${r.config}@${r.scale}`);
  assert.ok('p25' in r.stats && 'p75' in r.stats && 'mad' in r.stats, 'dispersion');
}
const scales = new Set(results.matching.map(r => r.scale));
assert.ok(scales.size >= 3, 'at least three input scales');
for (const name of [
  'recovered-failure-count',
  'passes-equal-failures-plus-one',
  'tracked-source-untouched',
  'same-cst-valid',
]) {
  assert.ok(
    results.sanity.some(c => c.name === name),
    `sanity check ${name} present`
  );
}
assert.ok(
  results.matching.some(
    r => r.regime.startsWith('invalid') && Number.isFinite(r.growthExponent)
  ),
  'growth exponent for a recovering regime'
);
const recov = results.counters.filter(
  c => c.regime.startsWith('invalid') && c.recover && c.config.startsWith('bang')
);
assert.ok(
  recov.length > 0 && recov.every(c => c.passes >= 2),
  'recovering runs have >= 2 passes'
);

const report = fs.readFileSync(path.join(out, 'report-tables.md'), 'utf8');
for (const h of [
  '## Construction',
  '## Matching',
  '## Counters',
  '## Memory',
  '## Incremental',
]) {
  assert.ok(report.includes(h), `report table ${h}`);
}
console.log('feature test: PASS');
