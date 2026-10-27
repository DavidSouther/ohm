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
both pinned commits available as Git objects. No dependency installation or branch
switch is required to run the historical experiments.

From the repository root:

```sh
node doc/research/fallible-overhead/scripts/check_paper.mjs
node doc/research/fallible-overhead/scripts/experiments.mjs --pretty
```

The first command checks every experiment table cell, section coverage, citation
coverage, and result labels. The second prints all operation counts. Omitting
`--pretty` produces JSON with the full source revisions in `_meta`. The original
short `branchHead` metadata field is retained for the paper checker.

Both runtimes are extracted with `git archive` from the pinned commits into this
directory’s ignored `.cache/`, without using the checked-out runtime. The scripts
resolve paths relative to their own location and can run from any working directory.
To force a fresh extraction, delete this directory’s `.cache/` and run either
command again. Missing Git objects cause the run to fail; fetch the historical
commits from the repository remote before retrying.

For optional live DOI resolution (requires network access):

```sh
node doc/research/fallible-overhead/scripts/check_paper.mjs --online
```

The checker reproduces deterministic expression-evaluation and pass counts;
it does not measure wall-clock time or independently prove the paper’s theorems.
