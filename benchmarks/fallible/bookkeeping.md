# Overhead of the opt-in `Fallible` expression (`B ! C`) in Ohm: measurements

Audience: maintainers of the Ohm fallible branches (`feat/fallible-v17-core` c775cb03, `feat/fallible-v17` d55d10ad). Baseline: `support/v17` at 4a40f38f. All numbers come from the archived [historical datasets](results/bookkeeping/README.md). Environment: Node v26.12.1, V8 14.6.202.34-node.40, darwin arm64 Apple M5 Max, 18 CPUs, 48 GB.

Provenance: this report preserves the original engineering measurement, transcribed from the engineering subagent's final report. It has not been independently re-measured. All source-level explanations and scan estimates below refer to **d55d10ad**, before the indexed recovery and memo-reuse changes. They do not describe the current engine. See [reproduction instructions](README.md).

## 1. Summary

"Generation" is read as two products. Grammar generation is `ohm.grammar(src)`: metagrammar parse, `buildGrammar`/`Builder`, analysis passes, recipe round trip. CST generation is `grammar.match(input, start, options)`. Ratios are fallible over reference, from interleaved measurements unless stated.

| Question | Result |
|---|---|
| Construction, source without `!`, branch vs baseline | 1.11x to 1.15x slower in 12 of 12 interleaved cells. Attributed to the new `Fallible` rule level in `ohm-grammar.ohm`, which every grammar source passes through. The ratio does not grow with source size (350 to 33,830 characters). |
| Construction, source with `!` vs the same source without | 1.00x (0.998x to 1.008x) |
| Matching, grammar without `!`, branch vs baseline (valid input, 1x to 300x) | Syntactic grammar `Prog`: 1.04x to 1.08x slower (12 of 12 cells). Lexical grammar `Lex`: 0.98x to 1.02x. Micro-grammars: lexical 0.97x to 1.02x, syntactic 1.015x to 1.055x. |
| Matching with `!` on valid input, `recover` not requested | 0.99x to 1.04x of the same grammar without `!`: not measurable |
| Matching with `{recover: true}` on valid input (one pass) | `Prog` 1.06x to 1.11x, `Lex` 1.11x to 1.18x. The cost is the same with or without `!` in the grammar, so it is paid for requesting recovery, not for using `!`. |
| Recovery on invalid input, one error | 2 passes; 1.13x to 1.43x the time of a valid input of the same size |
| Recovery on invalid input, errors proportional to size (1 per 10 statements/lines) | Passes = errors + 1 in every row. Superlinear: log-log exponent about 1.3 overall and 1.8 to 2.4 over the last decade. At 300x: `Prog` blocks 7.0x, `Prog` flat 5.8x, `Lex` 111x (80 s) the valid-input time. |
| Memory, valid input, no recovery | Retained heap +3% to +6% in every fallible configuration. Allocation +/-10%, inside noise. |
| Module load | 12.6 ms vs 13.3 ms, within noise |

Hypothesis verdicts:

- H1 (no-`!` regression within a few percent): refuted for construction (+11% to +15%), supported for lexical matching, borderline for syntactic matching (+4% to +8%).
- H2 (`!` without `recover` equals plain): supported.
- H3 (valid-input recovery is a constant factor with the same growth): supported.
- H4 (invalid-input cost superlinear when errors scale with input, near-linear when fixed): supported.
- H5 (one wide block costs more than many small blocks): refuted. Flat is 10% to 20% cheaper at 100x and 300x.
- H6 (`recoveryToken` lowers scan cost): refuted for this grammar. `bangTok` is 0% to 25% slower than `bang` in the dense regime.

## 2. Where the cost arises

Code was read from `git diff 4a40f38f4140 d55d10ad9661993027416dbbf18311446404f108` and attributed with deterministic counters plus a CPU profile.

**No `!` anywhere**

- **Construction.** Established by interleaved measurement; mechanism from the grammar diff. `Seq = Fallible*` and `Fallible = Iter "!" Iter | Iter "!" | Iter` add a rule application around every sequence element of every parsed grammar source. The metagrammar parse is 1.11x to 1.15x slower. `GrammarDecl.build` (the analysis passes) is only 0.02 to 0.1 ms of 2 to 14 ms, so the passes add nothing measurable.
- **Syntactic matching, +4% to +8%.** Measured; mechanism unresolved.
  - Candidates in the diff:
    - `this.recovery` tests in `enterApplication`, `exitApplication` and `eval`
    - `memoRec.isRecoveryTainted` read in `Apply.eval`
    - the `_recoveryTaint` compare and the `tokenEndOffset` store in `reallyEval`
    - `_suspendRecovery`/`_resumeRecovery` in `Not` and `Lookahead`
  - Micro-grammars show the effect is tied to syntactic context, not to predicates or per-application cost:
    - Lexical `~`, `&`, apply-per-char and `any*` all give 0.97x to 1.02x.
    - Every syntactic variant, including a bare `any*`, gives 1.015x to 1.055x.
  - No source change was allowed, so the line is unconfirmed.
- **Memory.** Retained heap +3% to +6%, which is +1.2 MB on 37.9 MB at 100x. This matches one extra field (`tokenEndOffset`) on about 135k memo records plus larger `MatchState` objects. The arithmetic fits but was not verified.

**`!` with `recover` not requested.** No measurable cost. `Fallible.eval` is `state.eval(B) && state.eval(C)`, and counters show +20 evals on 51,360 at 10x.

**Requesting recovery on valid input.**

- `matchRecovering` resets the memo table and does per-application and per-eval bookkeeping: `_tokenEnd` tracking with `inSyntacticContext()`, and a `_tokenEndStack` push/pop per application.
- The CPU profile shows `isSyntactic` at 12.8% self time on `Lex` and 4.0% on `Prog` during recovery.
- Counters are identical to the plain run except for evals (51,360 vs 51,380), so the cost is per-eval, not extra work.
- Recovery cannot reuse a plain match's memo table: a plain match followed by a recovering match on one matcher throws `matcherCannotRecover` (verified by script). Incremental re-matching and recovery are mutually exclusive.

**Recovering invalid input (the dominant term, from counters)**

1. One full pass per recovered error: passes = permits + 1. Cross-checked against `states - (rematch - 1)` in every row.
2. One extra full match per failed pass. `getRightmostFailures()` is called eagerly and re-matches, so `_match` calls equal passes (101 at 100 errors).
3. Each pass re-iterates the enclosing repetition, so earlier siblings are memo hits that still cost a lookup. Memo hits go from 13.8k (valid, 10x) to 603.6k (100 errors, 100x). Memo stores stay about 137k to 141k.
4. `Fallible.recover` calls equal E squared in every row: 100 at E=10, 10,000 at E=100, 1,000,000 at E=1000. 10.8M scan evals at E=1000.
5. `_invalidateMemoEntries` walks positions from 0 each pass (93.5M visits at E=1000). By CPU profile it is only 2% to 5% of self time. `MatchState.eval` (13% to 16%) and `Apply.eval` (4% to 7%) dominate.
6. Scans are about 11% of evals on `Prog`. `recoveryToken` adds evals per candidate (2,314 vs 1,239 scan evals at 10x) and does not shorten the scan for short statements.

With a fixed error count the extra cost is small. With errors proportional to size it is quadratic in the error count.

## 3. Procedure

- **Trees.**
  - Historical run: a detached baseline worktree of 4a40f38f4140 (since removed), and the read-only fallible checkout at d55d10ad. `git status --porcelain` before/after was a sanity assertion.
  - Published harness: a repo-relative archive of the baseline commit, an ancestor of this branch, and an in-repository [fixture](fixtures/fallible-before-reuse/README.md) holding the `d55d10ad` runtime sources; source fingerprints verify that both remain unchanged. No worktree metadata is created.
- **Grammars.**
  - `Prog` is syntactic, in variants `plain`, `bang` (`Stmt = Body ! ";"`, `Block = "{" Stmt* ! &"}" "}"`) and `bangTok` (adds `recoveryToken`).
  - `Lex` is lexical (`line = row ! "\n"`).
  - Ohm's own `ohm-grammar.ohm` (baseline copy for both trees) and synthetic N-rule grammars (10/100/1000) cover construction.
  - Equality of the variants up to `!` is asserted.
- **Inputs.**
  - Scale s is one of 1, 3, 10, 30, 100, 300.
  - `Prog` has s functions of 10 statements (`blocks`) or one function of 10s statements (`flat`). `Lex` has 100s lines.
  - Invalid regimes: one error in the middle (`invalid-single`), and one error per function or per 10 lines (`invalid-dense`).
  - Largest input: 88 KB (`Prog`), 638 KB (`Lex`).
- **Timing.**
  - `performance.now()` per call; first call recorded as cold.
  - Warmup 200 ms (at least 3 calls), then at least 15 and at most 400 timed calls within 400 ms (hard cap 6 s, minimum 3).
  - Grammar construction is excluded from match timings.
- **Process design.**
  - Per tree: 4 alternating-order repetitions of a `clean` process (only `plain/match`, construction and incremental) and an `all` process (every configuration).
  - `paired.mjs`, 4 processes each, strict rotation so drift cancels. Ratios are medians of per-iteration ratios, with IQR and spread of per-process medians.
  - Paired sets:
    - `nonrecover`: `plain/match` vs `bang/match`
    - `recover`: `plain/match`, `plain/recover`, `bang/recover` in rotation
    - `construct`: source with and without `!`
    - `dual`: both trees as separate module instances in one process, calls alternating, order flipped between processes
    - `micro`: micro-grammars, dual
  - The published full run executed `dual` and `micro` as separate invocations. The default paired invocation includes `dual`; `micro` is run separately.
- **Counters.** A separate instrumented process wraps `MatchState.eval`, `useMemoizedResult`, `getMatchResult`, `Apply.reallyEval`, `PosInfo.memoize`, `Matcher._match`, `_invalidateMemoEntries`, `Fallible.eval/scan/recover` and `RecoveryContext.chooseAttempt`. Grammars are built before counting.
- **Memory.** Separate process with `--expose-gc --min-semi-space-size=256 --max-semi-space-size=256`. Allocation is heap growth during one match (samples overlapping a GC are discarded). Retained is heap growth after a forced GC with the result alive. 7 repetitions.
- **Sanity assertions (14, all pass).**
  - Baseline pinned and detached.
  - Grammars identical up to `!`.
  - Identical CST signature (constructor names and child topology) for valid input in every configuration of both trees. Raw CST lengths, offsets and recovery fields are outside this historical signature; the subsequent [differential comparison](differential.mjs) checks those fields directly.
  - Recovering valid runs take 1 pass with 0 failures.
  - Plain grammar fails on invalid input; `bang` without recover reports the same message as plain and the baseline.
  - Recovered-failure count equals injected errors for `bang/recover` and `bangTok/recover` in every row.
  - Passes = failures + 1 (cross-checked with `MatchState` and `_match` counts).
  - A plain grammar with `recover` fails after one pass with a zero-width final failure.
  - Both source trees untouched.
  - At most half the memory samples discarded.
  - Incremental edit equals a fresh match.
  - Every expected timing cell present.

Feature test: `node benchmarks/fallible/feature-test.mjs` (from the repository root) runs the smoke profile (about 30 s) and passes. It runs `run.mjs` and `paired.mjs`, which write `results.json` and the report tables.

## 4. Environment and noise

The machine was not idle.

- Load average was 10.4/10.0/9.8 at the start and 7.8/8.9/10.1 at the end of the full run.
- A VS Code extension-host process held 230% to 730% CPU, and a security agent 30% to 110%.
- No heavy foreground work was started during runs. The Agent-based intent reviews ran during part of one run and read files only.

Interleaved processes show spreads of 0.2% to 17% (median about 3%). Non-interleaved cross-process cells show 4% to 50%, so the `class` columns in [report-tables.md](results/bookkeeping/report-tables.md) label nearly everything "within noise" and carry little information.

## 5. Matching results

Interleaved ratios on valid input ([report-paired.md](results/bookkeeping/report-paired.md), [report-paired-dual.md](results/bookkeeping/report-paired-dual.md)); ranges cover 1x to 300x:

| Comparison | `Prog` blocks | `Prog` flat | `Lex` |
|---|---|---|---|
| branch / baseline, grammar without `!` | 1.039x–1.059x | 1.043x–1.081x | 0.976x–1.015x |
| `bang/match` / `plain/match` | 0.990x–1.009x | 0.991x–1.026x | 0.998x–1.040x |
| `plain/recover` / `plain/match` | 1.069x–1.087x | 1.062x–1.106x | 1.111x–1.183x |
| `bang/recover` / `plain/match` | 1.063x–1.108x | 1.071x–1.107x | 1.113x–1.156x |

Per-iteration IQRs are typically 0.93 to 1.17, so single cells at 100x and 300x (60 samples) are inconclusive on their own. The consistency across cells is the evidence. Counters on valid input are identical between baseline and branch (5,037 evals, 1,386 memo hits, 1,296 stores at 1x; 51,360 evals at 10x; 526,830 at 100x).

Recovery on invalid input, `bang/recover` median and ratio to the baseline matching a valid input of the same size:

| scale | `Prog` blocks (E = s) | `Prog` flat (E = s) | `Lex` (E = 10s) |
|---|---|---|---|
| 1 | 0.49 ms, 1.40x (2 passes) | 0.47 ms, 1.34x | 1.92 ms, 1.51x (11 passes) |
| 10 | 5.4 ms, 1.49x (11) | 5.8 ms, 1.58x | 55 ms, 2.71x (101) |
| 30 | 23.9 ms, 1.91x | 23.3 ms, 1.92x | 429 ms, 6.96x |
| 100 | 132 ms, 2.68x (101) | 113 ms, 2.42x | 6.1 s, 28.9x (1001) |
| 300 | 1065 ms, 7.02x | 849 ms, 5.81x | 80.3 s, 111x |
| growth exponent, all / last two | 1.33 / 1.90 | 1.30 / 1.84 | 1.88 / 2.35 |

- `getRecoveredFailures()` after the match costs 0.89x to 1.14x of the match, within noise.
- Failed (unrecovered) matching stops at the first error: 0.2 to 0.5 ms at every scale on dense input.
- Memoization:
  - On valid input the baseline and branch have identical memo hits, stores and `reallyEval` counts (13,833 / 13,482 / 15,342 at 10x).
  - Recovery at E=100 (100x) does 603,602 hits vs 138,303 valid, with 136,474 stores vs 141,462.
  - The `hits` and `stores` counters include left-recursion seed operations and exclude tainted entries dropped.
  - A second `match()` on an unchanged matcher is a root memo hit (under 1 microsecond, both trees).
  - A one-character edit plus re-match costs 0.029 vs 0.032 ms (10x) and 0.112 vs 0.120 ms (100x), within noise.
  - Ohm cannot disable memoization, so no on/off cost is claimed.

## 6. Construction, memory, load

- **Construction** (interleaved, fallible / baseline, `!`-free sources; `ohm.grammar` and metagrammar parse):
  - `prog-plain`: 1.122x, 1.136x
  - `ohm-grammar.ohm`: 1.124x, 1.133x
  - `lex-plain`: 1.111x, 1.140x
  - `syn10`: 1.124x, 1.148x
  - `syn100`: 1.117x, 1.147x
  - `syn1000`: 1.113x, 1.113x
  - Absolute: 2.10 to 2.34 ms for the 756-character `Prog` grammar; 143.9 to 168.1 ms for 1000 rules.
  - `toRecipe` and `makeRecipe` ratios (non-interleaved) are 0.84x to 1.04x, within noise.
  - Phase breakdown (instrumented): the `Builder`/semantic-action share looked larger on the branch (0.31 vs 0.50 ms for `Prog`). This is a single non-interleaved measurement and unconfirmed.
- **Memory** (prog/blocks valid; KB allocated / retained):

  | config | 10x | 100x |
  |---|---|---|
  | baseline | 10,526 / 3,676 | 89,326 / 37,919 |
  | branch `plain/match` | 10,444 / 3,788 | 95,143 / 39,078 |
  | branch `bang/recover` | 10,432 / 3,883 | 97,841 / 39,472 |

  - Retained growth (1.03x to 1.06x) is the stable signal. Allocation ratios vary from 0.99x at 10x to 1.07x–1.10x at 100x and are treated as noise.
  - A recovered match retains as much as a successful valid match (3.7 to 3.9 MB at 10x), versus 0.2 to 1.9 MB for the failing plain match, because it carries the full CST.
  - The `invalid-dense` 100x recovery allocation sample was discarded (a GC occurred in all 7 repetitions); retained 37.8 MB.
- **Load and cold start.**
  - Import of `index.mjs`: 12.6 ms (baseline) vs 13.3 ms (branch), IQR about 14%.
  - First match at 10x on `Prog`: 9.64 ms vs 9.95 ms (plain), 9.90 ms (`bang/match`), 10.8 ms (`bang/recover`), 16.5 ms for dense-invalid recovery.

## 7. Threats to validity, failures, open items

- Single machine, single Node version, loaded machine. Interleaving mitigates drift but not cross-core or thermal effects.
- A first full run was aborted after 4 minutes (transient log omitted from this archive).
  - Counters had attributed grammar construction to the first match.
  - The recovery-capable cells shared a process with the no-`!` regression cells.
  - Both were fixed. In the second run, non-interleaved in-process cells showed spurious `bang/match` overhead of up to +14%, which vanished under rotation (0.99x to 1.04x). The interleaved tables are authoritative.
- Non-interleaved comparisons are weak evidence: the `class` columns, incremental, failed-match-with-message, load and cold start. Spreads of 10% to 50% exceed several measured effects. The failed-match-with-message ratio (1.04x to 1.19x) and the incremental ratios (1.07x to 1.10x) are therefore unresolved, not refuted.
- Counters and CPU profiles come from instrumented/profiled runs; no absolute timing was taken from them.
- `Prog` and `Lex` are synthetic, with regular error injection. Not measured: clustered errors, unterminated blocks (recovery by insertion), nested blocks with `recoveryStop`, parameterized rules, `trace()`.
- Unresolved: the cause of the +4% to +8% syntactic-grammar regression. A follow-up could bisect in a scratch worktree, for example by making `isRecoveryTainted` an own field of every memo record, or by hoisting the `this.recovery` tests.
- WASM: `packages/wasm/src/Compiler.js` rejects fallibles (`assertNoFallibles`); read, not benchmarked.
- Memory allocation figures depend on the 256 MB semi-space. Retained-heap figures carry about 5% run-to-run noise.
- The v18 `eliminateLookaheads` construction path (`Builder.lookahead` now defines a non-enumerable property on the double-`Not`) was raised by intent review but not measured.
- No CI regression threshold is asserted. The harness reports and asserts structure, not timing.
- Historical session state: measurement stopped at a green feature test; the research and plan drafts were not part of the measurement evidence.
