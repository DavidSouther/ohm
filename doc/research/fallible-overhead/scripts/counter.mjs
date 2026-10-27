// Instrumentation shared by the experiment scripts. Counts expression
// evaluations (MatchState#eval calls) and match runs (MatchState#getMatchResult
// calls, split into primary passes and failure-message passes) without
// modifying tracked source: prototypes are patched at runtime.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, renameSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OHM_REPO = join(here, '..', '..', '..', '..');
export const FALLIBLE_COMMIT = 'd55d10ad9661993027416dbbf18311446404f108';
export const BASELINE_COMMIT = '4a40f38f414023d57934d108efccd4c5eea5b546';
// Dependency-directory nesting keeps archived sources out of repository-wide linting.
const CACHE_DIR = join(here, '..', '.cache', 'node_modules');

// Both runtimes come from pinned Git objects, independently of the checkout's HEAD.
// Publish each complete extraction by renaming it into a commit-specific cache.
function archivedRoot(commit) {
  const destination = join(CACHE_DIR, commit);
  const root = join(destination, 'packages', 'ohm-js');
  if (existsSync(join(root, 'index.mjs'))) return root;
  mkdirSync(CACHE_DIR, {recursive: true});
  const temporary = mkdtempSync(join(CACHE_DIR, '.extract-'));
  try {
    const archive = execFileSync('git', [
      '-C',
      OHM_REPO,
      'archive',
      commit,
      'packages/ohm-js/src',
      'packages/ohm-js/dist',
      'packages/ohm-js/index.mjs',
      'packages/ohm-js/package.json',
    ]);
    execFileSync('tar', ['-x', '-C', temporary], {input: archive});
    try {
      renameSync(temporary, destination);
    } catch (error) {
      // Another process may have published the same complete archive first.
      if (!existsSync(join(root, 'index.mjs'))) throw error;
    }
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
  return root;
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
  const branch = await load(archivedRoot(FALLIBLE_COMMIT));
  const baseline = await load(archivedRoot(BASELINE_COMMIT));
  return {branch, baseline};
}
