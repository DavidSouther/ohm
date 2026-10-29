# Baseline benchmark results

These are the baseline rows from the historical full benchmark, measured at
`4a40f38f414023d57934d108efccd4c5eea5b546` on 2026-10-27 with Node v26.12.1,
V8 14.6.202.34-node.40, and an Apple M5 Max. The machine was loaded; these are
measurements from that environment, not timing thresholds.

[results.json](results.json) contains baseline construction, grammar phase
breakdown, import/cold-start, matching, deterministic counters, memory, and
incremental matching data. [matching.csv](matching.csv) contains only baseline
matching rows. The JSON retains the original `meta` object unchanged, including
the other measured tree, to preserve the measurement's provenance. Its two sanity
records concern only the baseline; the full comparison's assertions are not
presented as standalone baseline assertions.

Matching uses synthetic `Prog` (blocks and flat) and `Lex` grammars at scales
1, 3, 10, 30, 100, and 300. The `clean` subset runs without recovery-capable
configurations sharing the process. The `all` subset is a separate process.
Construction uses the baseline Ohm grammar, `Prog`, and synthetic grammars with
10/100/1000 rules. See [workloads.mjs](../../lib/workloads.mjs) and
[profiles.mjs](../../lib/profiles.mjs) for exact sources and budgets.

From the repository root, run a small standalone baseline counter measurement:

```sh
BASELINE=$(node --input-type=module -e "import {ensureTree, BASELINE_COMMIT} from './benchmarks/fallible/lib/trees.mjs'; console.log(ensureTree(BASELINE_COMMIT));")
mkdir -p benchmarks/fallible/out-baseline
node benchmarks/fallible/worker.mjs --tree="$BASELINE" --label=baseline --mode=counters --profile=smoke > benchmarks/fallible/out-baseline/counters.json
node benchmarks/fallible/worker.mjs --tree="$BASELINE" --label=baseline --mode=timing --subset=clean --profile=smoke --ohmgrammar="$BASELINE/packages/ohm-js/src/ohm-grammar.ohm" > benchmarks/fallible/out-baseline/timing.json
```

Use `--profile=full` for the original budgets. Worker output contains raw samples;
the full [historical runner](../../README.md) repeats and pools those samples for
both trees. The checked-in files are a deterministic selection of the original
summary data: filter every array by `tree === 'baseline'`, retain the baseline
`breakdown`, retain the original `meta`, and keep the two baseline sanity checks.
