# Recovery reuse: implementation and before/after results

2026-10-27. Before: `d55d10ad9661993027416dbbf18311446404f108`. After: `befb31229bf290708ab614bc790ebaf1169bafa5`, branch `perf/fallible-recovery-reuse`. Both source trees were clean and unchanged throughout the controlled run.

Recovery-count scaling improves substantially, with material constant-factor costs. On the paper's 240-part HDL input, 240 errors improve from **438.60 ms to 18.36 ms**, about **23.9× faster**, including diagnostic collection. The engineering Lex workload with 1,000 errors improves **13.5×**. Valid and sparse-error recovering inputs remain slower, and retained memory increases. The syntax-heavy Prog workload needs larger error counts before its time improvement outweighs the new bookkeeping.

## What changed

The implementation keeps the one-permit-at-a-time recovery policy and its diagnostic ordering. It reuses recovery-sensitive application results and stable iteration prefixes, shares recovery histories, indexes attempts, and skips unchanged attempt-state transformations using range mutation versions. Whole-pass failure summaries remove diagnostic re-matches. Source positions are indexed once, and recorded errors own detached snapshots. Transient evaluation indexes are released while compact permissions remain.

Pure subgrammars retain ordinary memoization. Stateful initialization and custom input streams use conservative evaluation. Active left-recursion boundaries keep the existing seed rules. This is not a uniform linear-time guarantee for every Ohm grammar.

## Engineering benchmark

The original engineering worker and workload generators were reused. The bounded live profile uses scales 1, 3, 10, 30 and 100; three fresh processes per tree and subset, alternating tree order; the original worker's 30 ms warmup target, 100 ms timing budget and 3–30 samples per cell. Values below are medians of the three process medians. Counters and memory run separately. Node was v26.12.1 on an Apple M5 Max.

This reruns a feasible live profile, rather than the original full profile's larger repetition budget and scale 300 across every workload. Load average changed from 22.0 to 9.2 during the run; raw distributions and process medians are retained. Small percentage differences should be read with that variation in mind.

Dense invalid input, `bang/recover`, at scale 100:

| Workload | Errors | Before ms | After ms | Change |
| --- | ---: | ---: | ---: | --- |
| Prog / blocks | 100 | 240.58 | 310.14 | 1.29× slower |
| Prog / flat | 100 | 202.78 | 294.95 | 1.45× slower |
| Lex / lines | 1,000 | 8,857.82 | 655.66 | 13.51× faster |

At the same scale, valid recovering Prog inputs are about 4.0× slower and single-error cases 3.7–3.9× slower. Valid and single-error recovering Lex inputs are about 2.0× slower. Without recovery requested, the clean-process valid-input point estimates are 4.4–9.4% slower. Those smaller plain-mode differences have substantial process-to-process variation.

Two-point time-growth exponents, using input characters between scales 30 and 100, improve from **1.50→1.02** for Prog/blocks, **1.47→1.02** for Prog/flat, and **1.93→1.06** for Lex. These finite measurements support improved scaling; they are not asymptotic proofs.

Full matching tables: [generated report](results/reuse/comparison/report.md). Raw samples, process medians, environment and source-state metadata: [results.json](results/reuse/comparison/results.json).

## Paper HDL workload and diagnostic materialization

The paper's original HDL grammar and generator were rerun with 240 parts and errors spread through the parts. Every operation includes `match` and `getRecoveredFailures()`, forcing diagnostic collection and the relevant CST arrays. The inputs match before/after within each row; the original generator removes one character per missing comma. This supplementary run uses one shared process, three warmups and five alternating samples per tree. Expression counters run only after all timing cells. CST signatures and diagnostic fields agree before/after.

| Broken parts | Before ms | After ms | Change | Before evals | After evals |
| --- | ---: | ---: | --- | ---: | ---: |
| 0 | 11.66 | 28.86 | 2.48× slower | 75,107 | 75,107 |
| 1 | 13.55 | 28.98 | 2.14× slower | 75,174 | 75,095 |
| 8 | 12.03 | 21.27 | 1.77× slower | 83,830 | 74,978 |
| 64 | 49.32 | 22.91 | 2.15× faster | 465,789 | 74,045 |
| 240 | 438.60 | 18.36 | 23.88× faster | 5,283,737 | 71,117 |

This directly exposes the tradeoff: completed-error work is reused as errors accumulate, while clean input still pays for additional bookkeeping per evaluation. Data: [hdl-results.json](results/reuse/hdl-results.json).

A separate supplementary check includes diagnostic collection for Lex and the original engineering scale-300 Prog cases. It uses one process, one warmup and three alternating samples, so its absolute times should not be pooled with the main profile:

| Workload | Errors | Before ms | After ms | Change |
| --- | ---: | ---: | ---: | --- |
| Lex / scale 100 / match + diagnostics | 1,000 | 5,898.62 | 442.71 | 13.32× faster |
| Prog / blocks / scale 300 / match + diagnostics | 300 | 1,323.89 | 749.08 | 1.77× faster |
| Prog / flat / scale 300 / match + diagnostics | 300 | 825.74 | 660.53 | 1.25× faster |

These checks show that the large-error gains survive materializing diagnostics. Data: [end-to-end-results.json](results/reuse/end-to-end-results.json).

## Work counts and adversarial cases

For the engineering Lex scale-100 dense case:

| Counter | Before | After |
| --- | ---: | ---: |
| Logical passes | 1,001 | 1,001 |
| MatchState evaluations | 25,433,142 | 1,611,930 |
| Recovery executions / scans | 1,000,000 | 1,000 |
| MatchState instances, including diagnostic re-matches | 2,001 | 1,001 |
| Position-table invalidation visits | 93,492,404 | 0 |

The original worker's `chooseAttemptScanned` field assumes a linear Map scan; it is not a valid work counter for the new indexed selection and is not used as evidence of index cost.

Review also found an independent-error family where expression evaluations were linear but attempt replay still performed quadratic index updates. After fixing it, 16/32/64/128 errors perform **47/95/191/383** index writes and **132/276/564/1,140** effect-segment visits. Unit tests check those operations rather than relying only on expression counts.

The paper's depth-10 adversarial families were rerun against both actual source versions. Diagnostics and pass counts agree:

| Family | Before evals | After evals | Passes, both |
| --- | ---: | ---: | ---: |
| One recovery beneath two-way backtracking | 41,473 | 569 | 2 |
| Fallible inside a predicate, valid input | 61,518 | 454 | 1 |
| Ten nested missing closers | 121,011 | 1,213 | 11 |

Data: [adversarial-results.json](results/reuse/adversarial-results.json). The original [paper experiment script](../../doc/research/fallible-overhead/scripts/experiments.mjs) was also rerun; its complete new output is [paper-experiments-after.json](results/reuse/paper-experiments-after.json). Its old excess-quadratic fit is no longer useful when excess evaluations become negative, so no speed claim relies on that fit.

## Allocation, retained memory and other costs

The original memory worker measures three samples at Prog/blocks scale 10, with forced GC and a 256 MiB semi-space setting. No samples were discarded. Decimal MB below are medians; these small memory samples are not a space-complexity proof.

| Recovering input | Allocated MB before→after | Retained MB before→after |
| --- | ---: | ---: |
| Valid, bang | 10.79 → 51.96 | 3.89 → 7.55 |
| One error, bang | 11.18 → 52.08 | 3.73 → 7.39 |
| Ten errors, bang | 14.02 → 48.78 | 3.72 → 7.01 |

The added summaries and cache structures have a real allocation cost despite releasing transient graph state. Reducing valid/sparse-input overhead is recorded as deferred profiling work. Grammar-construction point ratios range from 1.02× to 1.17× slower; source-module import medians are 34.32→48.15 ms. The one-character incremental rematch point estimate is 0.044→0.049 ms, and unchanged rematching is effectively equal. These ancillary measurements are noisy; distributions are in [analysis.json](results/reuse/comparison/analysis.json).

## Correctness and reproduction

Build and uncached root lint passed. The final package run passed **298 tests and four documentation tests**, with the same two known failures and one skip as the 276-test baseline. The external comparison matched **6,552 match/exception outcomes and 114 traces**, including raw CST fields, parameterized joins, predicates, LR, backtracking, missing closers, stateful indentation and source-coordinate edge cases. All **126** original counter-workload cells also matched success, CST signature/node count, diagnostic count, logical passes and failure messages. The complete outcome counts are in [differential results](results/reuse/differential-results.json); the [comparison analyzer](analyze.mjs) verifies the counter invariants against the archived samples.

From the repository root:

```sh
node benchmarks/fallible/compare.mjs
node benchmarks/fallible/analyze.mjs benchmarks/fallible/output/reuse/comparison
node benchmarks/fallible/hdl.mjs
node benchmarks/fallible/adversarial.mjs
node benchmarks/fallible/differential.mjs
```

The comparison scripts default to source archives of `d55d10ad` and `befb3122`,
so they reproduce the measured engine revisions even when run from a later commit.
They accept before root, after root and output path as positional arguments for
other source trees. Generated files go to ignored `output/`; the original
measurements above remain under `results/reuse/`. Historical JSON retains its
original workstation paths as provenance. The main comparison records source
revisions and checks that source state is unchanged throughout a run.

After relocating the harness, the paper checker passed all nine tables, the
differential check again matched 6,552 outcomes and 114 traces, and the comparison
analyzer reproduced the archived analysis byte for byte. A fresh
[HDL reproduction](results/reuse/hdl-reproduction.json) measured 445.09→21.41 ms
at 240 errors (20.8× faster), with identical expression counts to the original
run. Its valid-input medians were 9.84→23.15 ms. These independent samples confirm
the direction of the tradeoff; the tables above retain the original run.

`end-to-end.mjs` reruns the supplementary Lex and scale-300 Prog cases.
The full original scale-300 repetition profile, other Node/browser versions,
and a uniform bound over arbitrary LR/dependency/context structures were not
established by this run.
