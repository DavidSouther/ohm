# Historical fallible-expression complexity analysis

[The paper](paper.md) analyzes Ohm at fallible commit
`d55d10ad9661993027416dbbf18311446404f108` against baseline
`4a40f38f414023d57934d108efccd4c5eea5b546`. Its claims and tables describe those
historical revisions. The [current performance report](../../../benchmarks/fallible/performance.md)
covers subsequent implementation work.

The [citation verification log](research/papers.md) records the original checks and
source-access limitations, dated 2026-10-27.

## Reproduce

Requirements: Node.js 18 or newer, Git, `tar`, and a clone of this repository with
this branch's history. No dependency installation, build or branch switch is
required to run the historical experiments.

From the repository root:

```sh
node doc/research/fallible-overhead/scripts/check_paper.mjs
node doc/research/fallible-overhead/scripts/experiments.mjs --pretty
```

The first command checks every experiment table cell, section coverage, citation
coverage, and result labels. The second prints all operation counts. Omitting
`--pretty` produces JSON with the full source revisions, the fixture path and its
fingerprint in `_meta`.

The `d55d10ad` runtime is the frozen in-repository
[fixture](../../../benchmarks/fallible/fixtures/fallible-before-reuse/README.md),
whose manifest records that source commit and a content fingerprint. The checker
requires the experiment metadata to match both. The baseline `4a40f38f` is an
ancestor of this branch; it is extracted with `git archive` into the benchmark
harness's ignored `benchmarks/fallible/.cache/`. Neither runtime is the checked-out
one. The scripts resolve paths relative to their own location and can run from any
working directory. To force a fresh baseline extraction, delete that `.cache/` and
run either command again.

For optional live DOI resolution (requires network access):

```sh
node doc/research/fallible-overhead/scripts/check_paper.mjs --online
```

The checker reproduces deterministic expression-evaluation and pass counts;
it does not measure wall-clock time or independently prove the paper’s theorems.
