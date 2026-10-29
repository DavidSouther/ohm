// Instrumentation shared by the experiment scripts. Counts expression
// evaluations (MatchState#eval calls) and match runs (MatchState#getMatchResult
// calls, split into primary passes and failure-message passes) without
// modifying tracked source: prototypes are patched at runtime.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  ensureTree,
  fixtureTree,
  treeMetadata,
} from '../../../../benchmarks/fallible/lib/trees.mjs';

// The fallible runtime is the frozen in-repository fixture of commit d55d10ad;
// the baseline is extracted from this branch's own history, of which it is an ancestor.
// Neither depends on the checkout's HEAD.
export {FALLIBLE_COMMIT} from '../../../../benchmarks/fallible/lib/trees.mjs';
export const BASELINE_COMMIT = '4a40f38f414023d57934d108efccd4c5eea5b546';

/** Fingerprint of the fixture source actually loaded, for the paper checker. */
export function fallibleFingerprint() {
  return treeMetadata(fixtureTree()).status;
}

async function load(root) {
  const ohm = await import(pathToFileURL(join(root, 'index.mjs')).href);
  const {MatchState} = await import(pathToFileURL(join(root, 'src', 'MatchState.js')).href);
  const counts = {evals: 0, passes: 0, messagePasses: 0};
  const origEval = MatchState.prototype.eval;
  MatchState.prototype.eval = function (expr) {
    counts.evals++;
    return origEval.call(this, expr);
  };
  const origGMR = MatchState.prototype.getMatchResult;
  MatchState.prototype.getMatchResult = function () {
    if (this.positionToRecordFailures !== undefined) counts.messagePasses++;
    else counts.passes++;
    return origGMR.call(this);
  };
  function measure(fn) {
    counts.evals = 0;
    counts.passes = 0;
    counts.messagePasses = 0;
    const value = fn();
    return {value, ...counts};
  }
  return {ohm, measure};
}

export async function counters() {
  const branch = await load(join(fixtureTree(), 'packages', 'ohm-js'));
  const baseline = await load(join(ensureTree(BASELINE_COMMIT), 'packages', 'ohm-js'));
  return {branch, baseline};
}
