# Fallible benchmark archive and harness

Run these commands from the Ohm repository root. The harness uses Node's standard
library and Git; no package installation or engine build is required.

The historical measurement compares baseline `4a40f38f4140` with the initial
fallible implementation `d55d10ad9661993027416dbbf18311446404f108`. Both default
sources are pinned. The harness extracts only `packages/ohm-js/{src,dist,index.mjs,package.json}`
into ignored `.cache/node_modules/<commit>` directories. It checks each cached
source fingerprint before reuse and records the selected commits in new results.
Those commits must be available in the local Git history. Cached archives can be
removed and recreated without changing a checkout or Git worktree metadata.

- [Baseline results](results/baseline/README.md) contain only baseline rows, with
  the original measurement environment and metadata preserved.
- [Bookkeeping results](results/bookkeeping/README.md) preserve the complete
  historical datasets and paired comparisons.
- [Engineering report](bookkeeping.md) explains the historical mechanisms and
  evidence limits. Its scan estimates apply to the initial implementation.

```sh
# Check the complete historical harness with smaller inputs.
node benchmarks/fallible/feature-test.mjs

# Reproduce the full unpaired measurement (can take a long time).
node benchmarks/fallible/run.mjs --profile=full --out benchmarks/fallible/out-full

# Reproduce the three published paired datasets.
node benchmarks/fallible/paired.mjs --profile=full --sets=nonrecover,recover,construct --out benchmarks/fallible/out-full
node benchmarks/fallible/paired.mjs --profile=full --sets=dual --tag=-dual --out benchmarks/fallible/out-full
node benchmarks/fallible/paired.mjs --profile=full --sets=micro --tag=-micro --out benchmarks/fallible/out-full

# Regenerate a report for newly measured results.
node benchmarks/fallible/regen-report.mjs benchmarks/fallible/out-full
```

`run.mjs` accepts `--baseline <root>` and `--fallible <root>` overrides, but requires
the historical commits and unchanged runtime sources: its pass-count assertions
and full-scan instrumentation describe that implementation. `paired.mjs` accepts
the same overrides for timing other revisions, and records their Git metadata.
For example, `--fallible .` explicitly times the current checkout. The shared
`worker.mjs` also supports newer sources; historical scan-work estimates become
`null` when the source revision or dirty runtime files do not match the original.
The [current-engine comparison](performance.md) uses this shared worker.

```sh
# CPU profile of the historical implementation; add --fallible=. to profile HEAD.
node --cpu-prof --cpu-prof-dir=benchmarks/fallible/out-profile benchmarks/fallible/profile.mjs prog blocks invalid-dense 100 20
node benchmarks/fallible/profile.mjs --summarize benchmarks/fallible/out-profile/<file>.cpuprofile
```

Create `out-profile` before running a CPU profile. Historical timings depend on
Node/V8, the CPU, machine load, and warmup; re-running the same workloads does not
promise identical elapsed times. Original raw per-process samples (about 11 MB),
transient logs, and smoke outputs are omitted. The summary datasets retain pooled
statistics, per-process medians, counters, memory samples, and environment metadata.
