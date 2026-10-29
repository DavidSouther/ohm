# Fallible-expression complexity: historical costs and optimized reuse

[The paper](paper.md) preserves its original analysis of Ohm at fallible commit
`<original-fallible-commit>` against baseline
`<baseline-commit>` in Sections 3–6. Section 7 reviews the
corrected source inspected at `<corrected-source-commit>`, gives a fixed-grammar local-recovery bound
after diagnostic fix `<diagnostic-fix-commit>`, and separates prediction guidance from baseline
parser cost. Its nested-block counterexample refutes the general total bound
`O(n²+k log(n+1))` with a cubic dependency-invalidation lower bound. The dimensional
analysis also varies closed-block depth, leaf error count, error-local depth and
skipped span independently; cubic invalidation does not require missing closers. All current operation counts are reproducible. The
[performance report](../../../benchmarks/fallible/performance.md) contains archived
before/after timings measured at `<benchmark-snapshot-commit>`; the new probe does not remeasure them.

The [citation verification log](research/papers.md) records the original checks and
source-access limitations, dated 2026-10-27.

## Runtime boundary

The paper's counts and proofs predate the three-slot correction semantics and
mandatory real join matches introduced on 2026-10-30. The historical fixtures and
tables remain unchanged. The live probe below uses the checkout's current API,
reports success or failure for missing-join cases, and does not certify agreement
with those earlier tables.

## Reproduce

Requirements: Node.js 18 or newer, Git, `tar`, and a clone of this repository with
this branch's history. No dependency installation, build or branch switch is
required to run the historical experiments. The current-source probe uses the
checkout's `packages/ohm-js` sources and generated bootstrap modules; if those modules
are absent, follow the [contributor build instructions](../../../CONTRIBUTING.md)
(`pnpm build` in `packages/ohm-js`) first.

From the repository root:

```sh
node doc/research/fallible-overhead/scripts/check_paper.mjs
node doc/research/fallible-overhead/scripts/experiments.mjs --pretty
node doc/research/fallible-overhead/scripts/current-experiments.mjs
```

The first command checks all nine historical and nine earlier-runtime experiment tables,
section coverage, citation coverage, and result labels. The second prints the
historical operation counts. Omitting `--pretty` produces historical JSON with
the full source revisions, fixture path and fingerprint in `_meta`. The third
prints JSON for baseline suffix lookahead, three depth-10 adversarial families,
flat independent recovery, recovery-bearing recursive prediction, and corrected
nested diagnostics, actual nested invalidation visits, and the closed-depth/error,
error-locality and scan-distance controls, including the checkout revision and
Node version. It counts
matching evaluations, scan executions and position-version writes separately.
The nested table counts `Map.get` calls only during the first diagnostic
collection, after CST materialization and restoration of the evaluation counter.
Its legacy-policy control temporarily substitutes the former closure-filter
expression for `filterAfter` on the corrected runtime; it does not load a historical
checkout. The invalidation counter records actual `node.users` Set iterations, excluding
the initial root Set; it does not simulate a graph walk. Every prototype patch
is restored in `finally`. It also checks all 255 good/bad item placements with at most seven items.
`_meta.dimensionalControls` contains the 24-cell depth/error check count plus
mixed-depth, padding, placement and partially closed-block controls. No elapsed times are measured. The three-slot runtime changes these live counts. Tables in the paper remain tied
to its earlier runtime rather than being relabeled as new measurements.

The `<original-fallible-commit>` runtime is the frozen in-repository
[fixture](../../../benchmarks/fallible/fixtures/fallible-before-reuse/README.md),
whose manifest records that source commit and a content fingerprint. The checker
requires the experiment metadata to match both. The baseline `<baseline-commit>` is an
ancestor of this branch; it is extracted with `git archive` into the benchmark
harness's ignored `benchmarks/fallible/.cache/`. Neither historical runtime is the
checked-out one. The scripts resolve paths relative to their own location and can
run from any working directory. To force a fresh baseline extraction, delete that `.cache/` and
rerun the checker or the historical `experiments.mjs` command.

For optional live DOI resolution (requires network access):

```sh
node doc/research/fallible-overhead/scripts/check_paper.mjs --online
```

The checker reproduces deterministic expression-evaluation and pass counts;
it does not measure wall-clock time or independently prove the paper’s theorems.
