# The Cost of Fallible Expressions: Complexity of Permit-Driven Error Recovery in Packrat Parsing, with an Analysis of Ohm

*Historical analysis, 2026-10-27. Implementation analyzed: Ohm branch `feat/fallible-v17`, commit `d55d10ad`; baseline `support/v17`, commit `4a40f38f`.*

> Historical scope: all implementation claims and measurements below concern commit
> `d55d10ad`, whose runtime sources are preserved in the in-repository [fixture](../../../benchmarks/fallible/fixtures/fallible-before-reuse/README.md),
> compared with baseline [`4a40f38f`](https://github.com/DavidSouther/ohm/tree/4a40f38f414023d57934d108efccd4c5eea5b546).
> Subsequent implementation work is covered in the [current performance report](../../../benchmarks/fallible/performance.md).
> See the [reproduction instructions](README.md) for the historical experiments.

## Abstract

A *fallible expression* `B ! C` extends a parsing expression grammar (PEG) with an opt-in recovery point: it behaves as the sequence `B C` until a failed parse permits it to skip input up to the *join expression* `C`. The design studied here runs a sequence of complete packrat passes, each of which permits exactly one new recovery point at the farthest failure of the previous pass. The design goal is that each reported diagnostic equals the message a plain parse would give once earlier errors are repaired; this paper does not prove that property. This paper gives a formal model of the operator and its pass driver, and analyzes the time and space it adds to grammar construction, matching and CST generation, and diagnostic collection. For the general design, the number of passes is at most `|K| + 1`, where `|K| ≤ f·(n+1)·a` counts recovery keys (fallible occurrences `f`, input length `n`, argument instances `a`), and at least `r + 1` for `r` distinct recovery keys in the accepted parse. A family is exhibited on which any accepted parse needs `Ω(n)` passes. The driver's acceptance on that family is observed, not proven. For the Ohm implementation, plain-mode matching, and the first pass of a recovering match when that pass triggers no recovery event, perform exactly the evaluations of the desugared grammar, and grammars without `!` match with the same evaluation count as the baseline. Grammar construction costs a constant number of extra evaluations per sequence factor (+7.9 % on the grammar measured). The implementation does not keep the packrat time bound once recovery is active. It never memoizes an application whose evaluation performed a recovery or evaluated a fallible inside a predicate. Two proven constructions force `2^Ω(n)` evaluations: one recovery beneath a two-way backtracking choice, and a fallible inside `&` on *error-free* input. A third, `d` nested blocks each missing a closer, is proven under a hypothesis on the pass count that is observed for `d ≤ 10`. The one-recovery backtracking family also requires exponentially many simultaneously live recovery-log entries, despite having one distinct accepted recovery key and two primary passes. On the measured flat-list family with `k` errors, excess evaluation count fits `a·k + b·k²` (fit error 2.2 %). The informal flat-list argument separates actual per-pass traversal from repeated recoveries; a tight `Θ(k·m)` traversal term additionally requires errors to be sufficiently spread through the `m` items. Proofs about the implementation are proofs about a model obtained by code inspection; every empirical count is reproduced by a script.

## 1. Introduction

Packrat parsing gives PEGs a linear-time guarantee by memoizing every rule application at every input position [1], [2]. Ohm is a PEG-based parser generator with this design and with support for left recursion [3]. Labeled failures extend PEG error reporting with failure labels and catch sets [5]; later work attaches recovery expressions to labels to resume parsing within a pass [6], [7]. Restart-based PEG recovery also predates this design: [6], Section 5, discusses repeated parsing in Parboiled and farthest-failure contextual recovery in Rüfenacht’s work. The operator studied here uses a particular repeated-pass policy. A grammar author marks a recovery point by writing `B ! C`, and recovery is driven from *outside* the parse by repeated passes. Each pass permits one more recovery point at the farthest failure of the previous pass. The appeal of this design is semantic. Its stated goal is that the *i*-th diagnostic is the error a plain parse reports after the first *i*−1 errors are repaired, so that the first diagnostic of a recovering parse equals the plain parse's error message. The implementation's test suite checks this on specific inputs [4]. This paper treats it as a design goal, not a proven property, and Observation 28 records a case where several diagnostics collapse into one.

The cost of that property is the subject of this paper. The phrase "overhead added to generation" is read in three parts:

- **G1, grammar construction:** parsing grammar source with the extended meta-grammar, building expression trees, and running static checks.
- **G2, match and CST generation:** the pass driver, memoization, left recursion, recovery scans, and `_fail` node construction.
- **G3, diagnostic collection:** `getRecoveredFailures`.

Code generation by the Wasm backend lies outside the analysis except for the check that rejects `!`.

**Contributions.**

1. A formal semantics of `B ! C` parameterized by a permit set, together with the pass driver (Section 3).
2. Upper and lower bounds on the number of passes, a sufficient condition for cross-pass memo validity, and a quadratic lower bound within an explicit whole-application replay model (Section 4).
3. Equivalence results showing that the implementation's evaluation sequence is unchanged in the absence of recovery events (Section 5).
4. Two unconditional and one conditional exponential evaluation lower bounds for recovering mode, plus an exponential peak recovery-log-space consequence of the one-recovery construction (Section 5).
5. Reproducible operation counts that corroborate each bound (Section 6).

**Epistemic labels.**

- **Theorem**, **Proposition**, **Lemma** and **Corollary** carry proofs.
- **Claim (informal)** carries an argument that falls short of a proof.
- **Conjecture** is unproven.
- **Observation** reports a measured count, tied to an experiment identifier `E*` reproduced by `scripts/experiments.mjs`.

Results about the implementation are proved against a model of the code at commit `d55d10ad` [4], obtained by inspection. Fidelity of that model is a threat to validity (Section 7).

## 2. Background

### 2.1 PEGs and packrat parsing

A PEG is a recognition-based formalism with prioritized choice: where a CFG chooses nondeterministically, a PEG commits to the first alternative that succeeds [2]. Every PEG admits a linear-time parser [2]. A packrat parser achieves this bound by memoizing intermediate results, which gives "linear parse time" despite backtracking and unlimited lookahead [1], [9]. Memoization costs space: packrat parsers "require O(n) space for memoization", and cut operators reduce that storage [8]. Heap consumption from memoization has led implementers to abandon packrat parsing despite the possibility of exponential-time parsing without it [10]. Operational semantics of PEGs and of PEG matching machines appear in [12], [13].

### 2.2 Left recursion

Packrat parsing can be extended to left-recursive rules by seeding a memo entry with failure and growing it [11]. That extension can yield "super-linear parse times for some left-recursive grammars" [11]. A conservative semantic extension of PEGs for left recursion is given and proven in [12]. Ohm implements seed growth (`growSeedResult`) with an "involved applications" set that suppresses memoization inside an active left recursion [4].

### 2.3 Error reporting and recovery in PEGs

Labeled failures, "inspired by exception handling", let a PEG define different kinds of failure, each of which an ordered choice may catch [5]. Recovery expressions attached to labels "reach a synchronization point in the input and resume parsing" [6]. Labels and recovery expressions can be inserted automatically [7]. This paper derives no comparative complexity bounds from [5]–[7]. For LR parsers, earlier advanced recovery techniques were considered to have poor typical performance and an unbounded worst case. CPCT+ repairs 98.37 % of a 200,000-file corpus within a 0.5 s timeout [15].

### 2.4 Ohm

Ohm separates grammars from semantic actions [3]. Its matcher (`MatchState`) evaluates parsing expressions by recursive descent. It memoizes *applications* (rule instances, keyed by rule name and actual parameters) in a per-position table (`PosInfo`). Each entry records the *examined length*: the farthest input offset the application read. Ohm's incremental parsing invalidates memo entries whose examined interval intersects an edit [14]. The fallible extension reuses that invalidation routine between passes [4].

## 3. Formal Model

### 3.1 Syntax and keys

Let `G` be a grammar with rule instances `R` and fallible occurrences `F`, with `f = |F|`. Let `w` be the input, with `n = |w|`. A fallible occurrence `φ ∈ F` written `B ! C` has a *guarded expression* `B` and a *join expression* `C`. Ohm requires both to have arity 1, and `B` may not be a predicate [4].

**Definition 1 (recovery key).** A *recovery key* is a triple `κ = (φ, i, α)`, where `φ ∈ F` is a fallible occurrence, `i ∈ [0, n]` is the position at which `φ` is evaluated, and `α` is the actual-argument tuple of the enclosing rule application, or `⊥` when that rule is not parameterized. `K` denotes the set of keys reachable in any pass. When `a` bounds the number of distinct argument tuples that reach a rule containing a fallible, with `a = 1` for unparameterized grammars, `|K| ≤ f·(n+1)·a`.

### 3.2 Judgement

Evaluation is a judgement `⟨e, i⟩ ⇒[Π, σ, ν; q] o`, with these components:

- `Π ⊆ K` is the *permit set* of the pass.
- `σ` is the *stop stack*: the join expressions of the fallibles whose attempt is in progress.
- `ν ∈ {0, 1}` records whether evaluation is inside a predicate (`&`, `~`) or a recovery scan.
- `q` is the start position of the current enclosing rule application; it records progress before the fallible begins.
- The outcome `o` is either `j` (success, ending at position `j`) or `✗` (failure).

Every PEG operator other than `!` follows the standard rules [2], [12] and threads `Π`, `σ`, `ν` and `q` unchanged, except that `&e` and `~e` evaluate `e` with `ν = 1`, and entering a rule application at position `j` sets `q = j` for that application’s body.

For a failed attempt, `ρ` denotes the farthest failure position reached inside the attempt. `scan(φ, i, σ, q)` is the partial function that searches forward for `C` (Section 3.4).

```
            ⟨B C, i⟩ ⇒[Π, σ, 1; q] o
(F0)  ───────────────────────────────────  ν = 1: inside a predicate or scan, `!` is a sequence
        ⟨B ! C, i⟩ ⇒[Π, σ, 1; q] o

        ⟨B, i⟩ ⇒[Π, σ·C, 0; q] j     ⟨C, j⟩ ⇒[Π, σ·C, 0; q] k
(F1)  ─────────────────────────────────────────────────
        ⟨B ! C, i⟩ ⇒[Π, σ, 0; q] k

        ⟨B C, i⟩ ⇒[Π, σ·C, 0; q] ✗      κ = (φ, i, α) ∉ Π
(F2)  ─────────────────────────────────────────────────    records attempt (κ, ρ)
        ⟨B ! C, i⟩ ⇒[Π, σ, 0; q] ✗

        ⟨B C, i⟩ ⇒[Π, σ·C, 0; q] ✗    κ ∈ Π    scan(φ, i, σ, q) = k
(F3)  ─────────────────────────────────────────────────────    yields a `_fail` node over the skipped input
        ⟨B ! C, i⟩ ⇒[Π, σ, 0; q] k

        ⟨B C, i⟩ ⇒[Π, σ·C, 0; q] ✗    κ ∈ Π    scan(φ, i, σ, q) undefined
(F4)  ─────────────────────────────────────────────────────────
        ⟨B ! C, i⟩ ⇒[Π, σ, 0; q] ✗
```

In rule F3, when `B` is an iteration `B'*` or `B'+`, the elements matched by the failed attempt are kept. Ohm re-evaluates them, with the stop stack extended by `C`, before the scan; keeping the prefix does not require recomputation in the general design.

**Definition 2 (desugaring).** `δ(G)` replaces each `B ! C` by an unflattened sequence node `(B C)`. Under `Π = ∅`, rules F1 and F2 coincide with the sequence rule, so `⟨e, i⟩ ⇒[∅, σ, ν; q] o` holds iff `⟨δ(e), i⟩ ⇒ o` holds in `δ(G)`.

### 3.3 Pass driver

The driver maintains a permit set `Π_t` and an attempt store `A_t`. The attempt store is kept across passes because, in the implementation, an application memoized in an earlier pass does not run again and therefore does not record its attempts again [4].

1. Start with `Π_1 = ∅` and `A_1 = ∅`.
2. Pass `t` parses `w` under `Π_t` and adds the attempts recorded by F2 to `A_t`. If the pass succeeds, the driver stops.
3. Otherwise, let `ρ_t` be the farthest failure position of the pass. The driver chooses `κ*_t ∈ A_t` with `ρ(κ*_t) = ρ_t` and `κ*_t ∉ Π_t`, preferring the greatest start position and then the greatest application depth. It sets `Π_{t+1} = Π_t ∪ {κ*_t}` and removes from `A_t` every attempt whose interval `[start, ρ]` contains `start(κ*_t)`.
4. If no candidate exists, the driver stops and reports failure, listing the recoveries made so far.

`P` denotes the number of passes.

### 3.4 Scan

`scan(φ, i, σ, q)` starts at the first token boundary after the farthest complete token of the failed attempt. At each candidate position `p` it does the following:

1. It tests `C` at `p`. If `C` matches, the skip region is `[start, p)`, and the result is defined only if the region together with `C` covers at least one code unit.
2. Otherwise, it tests every join expression on `σ`. When the fallible is nested within at least two blocks, it also tests the grammar's `recoveryStop` rule. If any of these matches, the scan stops.
3. Otherwise, it advances by one `recoveryToken` match if the grammar defines that rule, or by one code unit.

When the scan stops at position `p`, or reaches the end of the input (`p = n`), a *block* (a guarded `*`/`+` whose join expression is not a lookahead) may insert the missing join only if `p > i` or `i > q`. Thus input must have been consumed during the fallible or earlier in its enclosing application. If neither progress condition holds, or the fallible is not a block, the scan is undefined (rule F4). For example, `S = any* ! "}"` on empty input cannot insert a closer because `p = i = q = 0`. All scan evaluations run with `ν = 1` [4].

## 4. Complexity of the General Design

This section analyzes the design of Section 3, independent of Ohm's memo policy.

**Theorem 1 (termination and pass bound).** The driver terminates after `P ≤ |K| + 1 ≤ f·(n+1)·a + 1` passes, provided each pass terminates.

*Proof.* Every pass `t < P` ends in step 3, which adds a key `κ*_t ∉ Π_t` to the permit set, so `|Π_{t+1}| = |Π_t| + 1`. Every permit set is a subset of `K`. Hence at most `|K|` passes end in step 3, and the pass that follows them ends in step 2 or step 4. ∎

**Proposition 2 (pass lower bound).** If the accepted parse of the final pass applies rule F3 at `r` distinct keys, then `P ≥ r + 1`.

*Proof.* Rule F3 applies only at keys in `Π_P`. The permit set grows by exactly one key per pass, so `|Π_P| = P − 1`. Hence `r ≤ P − 1`. ∎

**Corollary 3 (tightness in `n`).** Some grammar families have `P = Ω(n)` whenever the driver accepts. On those families the upper bound of Theorem 1 is attained up to the factor `f·a`.

*Proof.* Consider `S = Item* end; Item = "a" ! ";"` with input `"b;"^k · "a;"^k`, so `n = 4k`. The only terminals are `"a"`, `";"` and `end`, and the guarded expression is not an iteration, so no block insertion occurs. Each `b` in an accepted parse must therefore lie inside a skip region of rule F3. Every code unit is a scan candidate (the grammar defines no `recoveryToken`), and a scan stops at the first candidate where `";"` matches. A skip region therefore contains no `";"`, and so covers at most one `b`. If the driver accepts, the accepted parse thus applies F3 at `r ≥ k` keys, and Proposition 2 gives `P ≥ k + 1 = Ω(n)`. Acceptance itself is not proven here. Theorem 1 gives `P = O(f·a·n)`, and `f = a = 1` for this family. ∎

Observation 30 (experiment E7) reports `P = k + 1` exactly on this family, and Observation 9 reports the same on the HDL family of experiment E2.

**Lemma 4 (memo validity across passes).** Let `D(A, i)` be the set of start positions of all fallible evaluations with `ν = 0` in the derivation of application `A` at position `i` under `(Π, σ, q)`. Suppose `start(κ*) ∉ D(A, i)` and the derivation applies neither F3 nor F4. Then the outcome of `A` at `i` under `(Π ∪ {κ*}, σ, q)` equals its outcome under `(Π, σ, q)`.

*Proof.* The proof is by induction on the derivation. Rules F2, F3 and F4 are the only rules whose premises mention `Π`, and they mention only the membership of the evaluated key. Every fallible evaluation in the derivation has a key whose position lies in `D(A, i)` and therefore differs from `κ*`, so each membership test has the same answer under both permit sets. Every other rule is independent of `Π`. Since F3 and F4 are not applied, the derivation does not consult `scan`, so its validity does not depend on `σ` beyond the stop stack the rules themselves pass on. The same derivation is therefore valid under `Π ∪ {κ*}`, and PEG evaluation is deterministic, so the outcomes agree. ∎

Lemma 4 gives a sufficient condition for reuse, not a necessary one. Applications whose dependence set excludes the new permit and which applied neither F3 nor F4 may be reused in the same context. Failure of this hypothesis alone does not show that an outcome changes or that every implementation must recompute it. The ancestors whose derivations include the new permit form its *spine*. Results that applied F3 or F4 also consult the scan context, which keying by rule instance and position alone does not capture.

**Proposition 5 (cost under whole-application replay).** Consider a restricted reuse model: an application result is reused across passes only when Lemma 4’s hypothesis holds; otherwise its body is replayed from its start, without continuation or iteration-suffix reuse. Let `J` be a set of passes that replay an iterating application, and let `m_t` be the actual number of elements visited by that replay in pass `t`. Then those replays cost `Ω(Σ_{t∈J} m_t)` element evaluations. If `Σ_{t∈J} m_t = Ω(P·m)`, the cost is `Ω(P·m)`.

*Proof.* The replay restriction requires the body to visit its `m_t` elements in pass `t`. Each visited element costs at least one evaluation, including a memo hit. Summing gives the stated lower bound. The `Ω(P·m)` specialization requires the additional traversal-sum hypothesis; it does not follow merely from the existence of `m` items in the input. ∎

**Corollary 6 (quadratic cost under whole-application replay).** On Corollary 3’s input `"b;"^k · "a;"^k`, with `k = Θ(n)`, the reuse model of Proposition 5 costs `Ω(n²)`, provided the driver accepts. Implementations that resume a pass mid-iteration or memoize iteration suffixes fall outside this model.

*Proof.* An unpermitted bad item fails and stops `Item*`, after which `end` fails. Permitting it lets its recovery consume through the next semicolon, exposing the next bad item. Thus, before acceptance, the driver must successively permit all `k` bad items. When the next key is permitted, the preceding root derivation includes that key’s position in its dependence set, so the restricted model replays the root from its start. The replay with `j` permitted bad items visits at least those `j` items, for `1 ≤ j ≤ k`. Proposition 5 therefore gives `Ω(Σ_{j=1}^k j) = Ω(k²) = Ω(n²)`. Early failed passes need not reach the valid suffix. Acceptance remains conditional, as in Corollary 3. ∎

**Proposition 7 (driver bookkeeping).** Choosing and permitting a key costs `O(|A_t|) ≤ O(|K|)` per pass, so `O(P·|K|)` in total. The design stores `O(|K|)` attempts and `O(P)` permits, in addition to the memo table.

*Proof.* The choice in step 3 is a linear scan over `A_t`, and the pruning is a second linear scan. `A_t` maps keys to records, so `|A_t| ≤ |K|`, and `|Π_t| < P`. ∎

**Claim 8 (informal; general worst-case and typical-case time).** Let `W_t` be the cost of pass `t` and `M_t` the cost of any per-pass message computation. By Theorem 1 and Proposition 7, the total time is `Σ_{t ≤ P} (W_t + M_t) + O(P·|K|)` with `P ≤ |K| + 1`.

- **Worst case:** if both a primary pass and its message computation cost `O(W)`, with packrat cost `W = O(|G|·n)`, the total is `O((|K| + 1)·(W + |K|))`, retaining the driver-bookkeeping term. Whether the per-pass bound holds depends on how the implementation memoizes context-dependent results (Section 5.4).
- **Typical case:** suppose `e` errors each need one permit and ideal reuse revisits at most `h` spine nodes per permit, at cost `O(c)` per node. The baseline plus this spine/recovery contribution is `O(W + e·h·c)`. This is a total-time bound only if traversal outside those nodes, message computations and driver bookkeeping are also bounded by that expression. Short spines and absence of backtracking or predicates alone do not establish these additional bounds.

*Argument.* The worst-case figure sums the assumed primary/message bounds and Proposition 7’s bookkeeping bound over at most `|K| + 1` passes. The typical-case contribution follows from the additional per-permit work assumption. Lemma 4 permits some reuse but does not prove that these are the only computations needed. The argument is informal because the ideal context-sensitive reuse policy is not known to be realized (Conjecture 2), and the remaining traversal, message and bookkeeping costs need separate bounds. ∎

## 5. The Ohm Implementation

The analysis below refers to commit `d55d10ad` [4]. The unit of cost is one call of `MatchState#eval`, the *evaluation count*. Outside its nested calls, each such call does `O(1)` work, with these exceptions:

- recovery-key string construction, which costs `O(|memo key|)` for parameterized rules;
- `activeJoin`, which substitutes parameters into `C` at `O(|C|)` cost for parameterized rules;
- filtering the recovery log, `O(m)` for `m` recoveries inside one attempt;
- the work in Section 5.3.

### 5.1 G1: grammar construction and analysis

The meta-grammar changes `Seq = Iter*` to `Seq = Fallible*`, with `Fallible = Iter "!" Iter | Iter "!" | Iter`, and adds `"!"` to the operator tokens.

**Proposition 10 (construction overhead).** Parsing grammar source with the extended meta-grammar adds `O(1)` evaluations per sequence factor, and remains linear in the length of the grammar source. Each static pass over expression trees (arity, nullability, application validity, parameter introduction and substitution, recipes, `toFailure`, `toString`, the Wasm `assertNoFallibles` check) visits each `Fallible` node once and recurses into `B` and `C`. These passes therefore keep their baseline complexity in `|G|`. An exception is `assertChoicesHaveUniformArity`, which calls `getArity` on both operands at each fallible. That check costs `O(|G|·h)`, where `h` is the nesting height of fallibles, the same form as the existing check for alternations.

*Proof.* For each sequence factor, `Fallible` is a memoized application. Its three alternatives each begin with `Iter` at the same position. The first evaluation of `Iter` is memoized, and the second and third alternatives reuse that entry. Each alternative then makes at most one terminal test (`"!"`) and, in the first alternative, one further `Iter`, which is the next factor and is memoized in its own right. This is `O(1)` evaluations per factor beyond the baseline, and packrat linearity [1], [2] is preserved because no new rule is left-recursive. For the static passes, the code adds one method per pass for `Fallible`, delegating to `this.fallible` and `this.join` [4]. `getArity` is a full recursion over its operand, so the arity check costs the sum of subtree sizes along fallible nesting chains, which is `O(|G|·h)`. ∎

Observation 11 quantifies Proposition 10 on one grammar: +461 evaluations (+7.9 %) to construct a grammar that contains no `!`.

### 5.2 G2 without recovery events

Ohm adds the following to every evaluation, whether or not a grammar uses `!`:

- `MatchState#eval` tests `this.recovery` on each successful evaluation;
- `enterApplication` and `exitApplication` each test `this.recovery` once;
- `Apply#eval` tests `memoRec.isRecoveryTainted`;
- `Apply#reallyEval` compares the taint counter twice and stores `tokenEndOffset`;
- predicates call `_suspendRecovery` and `_resumeRecovery`.

None of these calls `eval`.

**Theorem 12 (no-recovery equivalence).** Call a pass *taint-free* when it evaluates no fallible with `ν = 1` and applies neither F3 nor F4. Matching `G` in plain mode on a fresh matcher (an empty memo table), and the first pass of a recovering match whenever that pass is taint-free, perform the same sequence of `eval` calls as plain-mode matching of `δ(G)`. For a grammar with no fallibles, the commit performs the same sequence of `eval` calls as the baseline `4a40f38f`.

*Proof.* Plain mode: `Fallible#eval` with `state.recovery` undefined returns `state.eval(B) && state.eval(C)`, which is the call sequence of the sequence node `(B C)`. Recovering mode, taint-free first pass:

- Each fallible evaluated with `ν = 0` evaluates `B` then `C`, as in F1 and F2.
- Its other actions (pushing and popping failure info, recording the attempt, maintaining `_syncStack`, `_blockDepth` and `_tokenEnd`) make no `eval` call.
- Because no taint event occurs, the taint counter is constant throughout the pass. Every memoization condition in `reallyEval` therefore reduces to the baseline condition, and every left-recursion head is stored with `isRecoveryTainted = false`, so `Apply#eval` takes the baseline branches.
- `_prepareForRecovery` empties the memo table before pass 1, as a fresh plain match would.

Grammars without `!`: the diff from the baseline adds only the non-`eval` tests listed above. The taint counter is incremented only inside `Fallible#eval`, so it is constant, and every memo decision is the baseline decision. ∎

Theorem 12 asserts equality of call *sequences* by inspection; the experiments check only the counts. In both Theorem 12 and Observation 13, the count for `δ(G)` written in Ohm's surface syntax differs by the number of evaluations of fallibles that occur directly inside a sequence, because the builder flattens a nested sequence written in parentheses. This accounts for the constant +1 in E1.

**Corollary 14 (valid input).** On an input that `G` accepts, a recovering match runs one pass and costs exactly a plain match, provided no fallible is reachable under a predicate.

*Proof.* With no fallible reachable under a predicate, pass 1 evaluates no fallible with `ν = 1`. Its permit set is empty, so F3 and F4 never apply. The pass is therefore taint-free, and Theorem 12 applies. The pass succeeds because `δ(G)` accepts the input, so the driver stops after one pass. ∎

### 5.3 G2 per-pass costs of the driver

**Proposition 15 (match runs).** A recovering match runs `2P − 1` complete matches when it succeeds: `P` passes and `P − 1` message passes. When tracing, it runs one more.

*Proof.* `matchRecovering` calls `result.getRightmostFailures()` on every failing pass. Because the first match does not record failures, that call re-runs `matcher._match` with `positionToRecordFailures` set under the same `RecoveryContext`, which is one complete match. A succeeding pass computes no message, and tracing adds one final `runPass` with tracing enabled [4]. ∎

The message pass reuses the memo table, except for entries that lack failure information at the recorded position (`hasNecessaryInfo`). The plain matcher also computes failure messages lazily, but the driver forces this computation on every failing pass.

Between passes, `_invalidateMemoEntries(s, s+1)` with `s = start(κ*)` visits positions `0..s` and deletes each entry whose examined interval reaches past `s`. This realizes the condition of Lemma 4, using the examined interval as an over-approximation of `D(A, i)`. The over-approximation is sound because the permitted key belongs to a failed attempt, which read its start position (the input stream records a read even at the end of the input), so its start lies inside the examined interval of every enclosing application. The cost is `O(s)`, plus the number of keys enumerated at positions whose maximum examined length crosses `s`. Each deleted entry was created once, so deletions amortize against creation. `chooseAttempt` and `permit` are linear in the attempt store (Proposition 7).

**Proposition 16 (scan cost).** A scan that starts at position `p₀` visits at most `n − p₀ + 1` candidate positions. At each candidate it makes one `spaces` evaluation, at most one evaluation of `C`, at most `|σ| + 1` stop-marker evaluations, and at most one `recoveryToken` evaluation.

*Proof.* The loop variable `p` strictly increases: `nextCandidate` returns either the end of a `recoveryToken` match that made progress, or `tokenStart + 1` with `tokenStart ≥ p`. The loop stops after `p = n`. The per-candidate calls can be read from the code of `scan` [4]. ∎

All scan evaluations run with `ν = 1`. Applications they evaluate are memoized unless they themselves contain a fallible. A scan that runs to the end of the input visits `O(n − p₀ + 1)` candidates. A matching lower bound requires a bounded-advance assumption covering both token and whitespace jumps; an unbounded `recoveryToken` can cross the whole suffix in one match. Candidate count is distinct from the work inside token, space, stop and join evaluations.

### 5.4 G2 with recovery events: the taint rule

Ohm keeps a counter `_recoveryTaint` and increments it in two cases: when a permitted fallible enters recovery (rules F3 and F4), and when a fallible is evaluated with `ν = 1` (rule F0). `reallyEval` does not memoize an application whose evaluation changed the counter. A left-recursion head that changed it is stored for seed growth and then deleted on its next lookup. The rule is sound: it prevents reuse of results that depend on `σ`, and of results computed under `ν = 1`, which recorded no attempts. It is also coarse. The counter is monotone, and every application whose dynamic extent contains a taint event is excluded, including every ancestor on the application stack.

**Theorem 17 (exponential cost of one recovery under backtracking).** Consider the grammar `S = E end; E = "(" E ")" "a" | "(" E ")" "b" | X; X = "x" ! ";"` and the input `w_d = "("^d · "y;" · ")b"^d`, of length `3d + 2`. A recovering match of `w_d` evaluates `E` at least `2^d` times in its second pass. The input contains one error.

*Proof.* Pass 1 fails. `X` at position `d` fails at `d` (`"x"` against `y`). No expression consumes input past position `d`, so `ρ_1 = d`. The only attempt with `ρ = d` is `(X, d)`, because attempts of `X` at positions `j < d` fail at `j`. The driver therefore permits `(X, d)`.

In pass 2, `E` at `d` fails its first two alternatives at `y`. Its third alternative applies `X`, which fails its attempt and recovers: the scan finds `";"` at `d + 1`. This application of F3 increments the taint counter. Every application whose extent contains that recovery is therefore not memoized, including every application of `E` at a position `j ≤ d`, by induction on `d − j`. For `j < d`, an evaluation of `E` at `j` matches `"("` and evaluates `E` at `j + 1` in its first alternative. After that, `")"` matches and `"a"` fails against `b`. The second alternative then evaluates `E` at `j + 1` again, with no memo entry to reuse. Writing `N(j)` for the number of evaluations of `E` at `j`, this gives `N(0) ≥ 1` and `N(j + 1) ≥ 2·N(j)`, so `N(d) ≥ 2^d`. Each of those evaluations of `E` at `d` repeats the recovery scan. ∎

Theorem 17 shows that the evaluation count of a recovering match with a single error is `2^Ω(n)`. A plain match of the corrected input is linear (column "valid, plain" in E3).

**Theorem 18 (exponential cost on error-free input).** Consider the grammar `S = E end; E = &P "(" E ")" "a" | &P "(" E ")" "b" | "x"; P = "(" ! any` and the valid input `v_d = "("^d · "x" · ")b"^d`. A recovering match of `v_d` runs one pass and evaluates `E` at least `2^d` times. A plain match evaluates `E` `O(d)` times.

*Proof.* Every evaluation of `&P` evaluates the fallible in `P` with `ν = 1`, which increments the taint counter under rule F0, even though the fallible succeeds. Every evaluation of `E` at `j < d` begins its first alternative with `&P`, so no such evaluation is memoized. The first alternative matches `"("`, evaluates `E` at `j + 1`, matches `")"`, and fails at `"a"`. The second alternative re-evaluates `E` at `j + 1`. As in Theorem 17, `N(d) ≥ 2^d`. No failure is final, so the driver stops after one pass. In plain mode no taint exists, Theorem 12 applies, and packrat memoization bounds the evaluations of `E` by a constant per position. ∎

Theorem 18 means that using `recover: true` can change the time complexity on *correct* input. Reachability beneath `&` or `~` can invalidate the evaluation-equivalence guarantee, which explains Corollary 14’s conservative hypothesis. It does not by itself imply a changed asymptotic class: Theorem 18 also uses recursive two-way backtracking to obtain exponential duplication.

**Theorem 19 (exponential cost of nested missing closers).** Consider the grammar `S = Stmt*; Block = "{" Stmt* ! "}"; Stmt = Block | Simple; Simple = "x" ";"` and the input `"{"^d · "x;"`, which has `d` unclosed blocks. Suppose the final pass permits all `d` block keys. Then the final pass evaluates the block nested at depth `d − 1` at least `2^{d−1}` times. The hypothesis holds whenever `P = d + 1`.

*Proof.* The fallible occurrence is evaluated only at positions `1..d`, after each `"{"`, so the grammar has exactly `d` reachable keys. If `P = d + 1`, then `|Π_P| = d` and every key is permitted.

In the final pass, consider the block at depth `j < d − 1`. Its attempt evaluates `Stmt*`, which applies the block at depth `j + 1`. That inner block succeeds by recovery, so its evaluation increments the taint counter and is not memoized. The attempt then fails, because `"}"` is absent at the end of the input. The key is permitted, so F3 applies. The guarded expression is an iteration, so `recover` re-evaluates `Stmt*` to keep the matched prefix, and this applies the block at depth `j + 1` a second time. The scan then reaches the end of the input, and the block recovers by inserting the missing join. Hence `N(j + 1) ≥ 2·N(j)` and `N(0) ≥ 1`. ∎

Theorem 19 combines the taint rule with re-evaluation of the kept prefix, a choice specific to the implementation. The general design (rule F3) requires the prefix to be *kept*, but it does not require the prefix to be *recomputed*.

**Claim 20 (informal; flat-list traversal and repeated recovery).** Suppose a top-level iteration of `m` items contains `k ≥ 1` errors, each recovered in a different item, with no recovery beneath a backtracking choice or predicate. Assume acceptance after `P = k + 1` primary passes, bounded item-visit cost outside recovery, and comparable recovery cost `Θ(c)` per execution. Let `m_t` count the actual item visits in each primary or message run after the first primary pass, and let `V = Σ_t m_t`. If message runs add at most a constant factor to the primary traversal and recovery work, and every later primary pass revisits the earlier recovered items, the evaluation count has the informal accounting `W + Θ(V) + Θ(k²·c)`, where `W` is the first primary pass’s evaluation count.

*Argument.* Taint prevents memoization of applications containing a recovery, but a failing pass may stop at the next unpermitted error. Its traversal charge is therefore its actual `m_t`, not automatically `m`. Untainted items may be memo hits; recovered items repeat their recovery in later primary passes. With one newly permitted item per pass and earlier recoveries revisited, these passes execute `1 + 2 + ··· + k = Θ(k²)` recoveries, including first executions. The message-run assumption adds at most a constant factor. Under these uniform-cost and run-count assumptions, `V = O(k·m)`, giving an upper bound `O(W + k·m + k²·c)`. A tight traversal term `Θ(k·m)` requires the additional placement condition `V = Θ(k·m)`, for example that a constant fraction of the failing passes reaches a constant fraction of the list. The claim remains informal because these cost and message-run assumptions are not derived for arbitrary grammars. ∎

For clustered errors in `"b;"^k · "a;"^(m−k)` with `Item = "a" ! ";"` and constant-cost recovery, failed passes visit increasing bad prefixes and only the successful pass reaches the full valid suffix. The resulting evaluation count is `Θ(m + k²)`, rather than a universal `Θ(k·m)` traversal cost. Observation 21’s fit (maximum relative error 2.2 %) is evidence about E2’s fixed family, not a lower bound for every error placement.

### 5.5 Left recursion

**Proposition 22 (tainted left-recursion heads).** If the growth of a left-recursive head at position `i` contains a taint event, the grown result is used only by the evaluation that grew it. Every later request for the head at `i` regrows the seed from failure.

*Proof.* `reallyEval` stores the head's record with `isRecoveryTainted = true`, because the seed must stay visible during growth. On the next lookup, `Apply#eval` deletes a tainted record and calls `reallyEval`, which detects a new left recursion, memoizes a failure, and grows again [4]. ∎

Seed growth already costs one body evaluation per growth step, and the implementation of [11] admits super-linear behaviour. Proposition 22 multiplies that cost by the number of times the head is requested at the same position. Observation 23 reports the cost for a left-recursive sum.

### 5.6 Incrementality, G3, and space

**Proposition 24 (no incremental reuse).** A recovering match never reuses memo entries from an earlier match. It throws an error if the matcher's input changed since the last match, or if the memo table was filled by a plain match.

*Proof.* `_prepareForRecovery` throws in both cases and otherwise calls `_resetMemoTable` [4]. ∎

An editor that requests a recovering parse after each edit therefore pays a full parse plus recovery on every keystroke. The incremental reuse of [14] is available only in plain mode.

**Proposition 25 (G3 cost).** `getRecoveredFailures` costs `O(|T| + m log m)` on a successful result, where `|T|` is the number of CST nodes outside `_fail` subtrees and `m` is the number of recorded failures. Each call additionally copies the `m` cached entries. On a failed result the list is precomputed, at `O(m log m)` cost, from the recovery log of the final pass.

*Proof.* `collectRecoveredFailures` walks the CST and does not descend into failure nodes. `distinctByPosition` makes one pass with a hash set, then sorts. The result is cached, and each call returns `slice()` [4]. ∎

**Proposition 26 (space).** Let `L` be the maximum number of simultaneously retained recovery-log entries during any one pass. It counts dynamic entries, including duplicates left by backtracking, whereas `r` in Proposition 2 counts distinct keys in the accepted parse. In addition to the baseline memo table, a recovering match stores:

- `O(|K|)` attempt records and `O(P)` permits;
- one `MatchResult` per failing pass, retained by `RecoveredFailure` objects through their permitting pass;
- `O(h_s)` stop-stack entries, where `h_s` is the depth of active fallible attempts;
- `O(h_a)` token-end entries, where `h_a` is the depth of the application stack;
- `O(L)` recovery-log slots at peak within a pass; `L` is not bounded by `r`.

Each memo record gains one field (`tokenEndOffset`) in every mode. Tainted applications are not memoized, so recovery can *shrink* the memo table.

*Proof.* The structures in `RecoveryContext`, `RecoveredFailure`, `MatchState` and `reallyEval` give the listed storage [4]. Each successful dynamic recovery appends a fresh `RecoveredFailure`. Ordinary backtracking restores input and bindings without truncating the recovery log; recovery-specific cleanup does not eliminate all duplicates accumulated through failed alternatives. Thus distinct accepted keys do not bound its peak entry count. ∎

The expected-failure sets held by retained `MatchResult` objects contribute `O(P·φ)`, where `φ` bounds the size of one such set; this does not bound their entire reachable object graphs. More decisively, Theorem 17’s final primary pass performs at least `2^d` recoveries at the same key and retains their log entries simultaneously. Hence `L ≥ 2^d`, although `r = 1` and `P = 2`. This is an exponential peak-space lower bound during parsing, not a claim about storage reachable after the match returns. Small `P` alone therefore does not establish memo-table dominance over recovery storage; the baseline memo-space results of [8] do not bound `L`.

## 6. Empirical Sanity Checks

`scripts/experiments.mjs` counts `MatchState#eval` calls (`evals`), primary passes (`passes`) and message passes (`msg`) by patching prototypes at run time. It loads the `d55d10ad` runtime from the in-repository [fixture](../../../benchmarks/fallible/fixtures/fallible-before-reuse/README.md), a frozen copy of that commit’s `packages/ohm-js` sources, and baseline `4a40f38f`, an ancestor of the working checkout, through `git archive` into an ignored cache; neither depends on the checkout’s HEAD. The counts are deterministic. `scripts/check_paper.mjs` re-runs the script and compares every table below cell by cell. Wall-clock time is not measured. The parallel engineering session `2026-10-27-A` had published no benchmark results when this paper was written.

**Observation 11 (E0).** Constructing the `!`-free HDL grammar costs 461 more evaluations on the branch than on the baseline (+7.9 %), as predicted by Proposition 10. Matching with that grammar costs exactly the baseline count, as predicted by Theorem 12.

<!-- exp:E0 -->
| phase | grammar | baseline | branch |
|---|---|---|---|
| construct | HDL (no !) | 5838 | 6299 |
| construct | HDL (with !) | - | 6295 |
| match n=1631 | HDL (no !) | 18346 | 18346 |
| match n=6631 | HDL (no !) | 75106 | 75106 |

**Observation 13 (E1).** On valid input, plain mode and recover mode have identical evaluation counts, as predicted by Corollary 14, and each is one more than the textual desugaring because of sequence flattening (Section 5.2).

<!-- exp:E1 -->
| n | desugared | plain mode | recover mode | passes |
|---|---|---|---|---|
| 1631 | 18346 | 18347 | 18347 | 1 |
| 3271 | 36946 | 36947 | 36947 | 1 |
| 6631 | 75106 | 75107 | 75107 | 1 |

**Observation 9 (E2).** For an HDL chip of 240 parts with `k` broken parts, the driver runs `P = k + 1` passes and `k` message passes, which attains Proposition 2 and agrees with Proposition 15. It reports all `k` errors. The evaluation count grows superlinearly in `k`.

<!-- exp:E2 -->
| k | passes | msg | evals | evals/base | reported |
|---|---|---|---|---|---|
| 0 | 1 | 0 | 75107 | 1.00 | 0 |
| 1 | 2 | 1 | 75174 | 1.00 | 1 |
| 2 | 3 | 2 | 75877 | 1.01 | 2 |
| 4 | 5 | 4 | 77820 | 1.04 | 4 |
| 8 | 9 | 8 | 83830 | 1.12 | 8 |
| 16 | 17 | 16 | 104439 | 1.39 | 16 |
| 32 | 33 | 32 | 179363 | 2.39 | 32 |
| 64 | 65 | 64 | 465789 | 6.20 | 64 |

**Observation 21 (E2fit).** A least-squares fit of the excess evaluations in E2, `evals(k) − evals(0) = a·k + b·k²`, is consistent with Claim 20’s conditional repeated-recovery accounting on this fixed family. It does not establish a tight traversal bound for other error placements.

<!-- exp:E2fit -->
| a | b | max rel. error (k>=8) |
|---|---|---|
| 401 | 89.1 | 2.2% |

At `k = 64`, the quadratic term accounts for about 365,000 of the 390,682 excess evaluations.

In E3–E5, the retained table heading “ratio vs d-2” denotes the ratio to the previous measured row: at `d = 2` the denominator is depth 1; from `d = 4` onward it is depth `d − 2`.

**Observation 27 (E3).** One recovery beneath a two-way backtracking nest multiplies the evaluation count by a factor approaching 4 per two levels of depth, that is, about 2 per level, as predicted by Theorem 17. A plain match of the corrected input stays linear.

<!-- exp:E3 -->
| d | valid, plain | one error, recover | passes | ratio vs d-2 |
|---|---|---|---|---|
| 1 | 70 | 179 | 2 | - |
| 2 | 102 | 305 | 2 | 1.70 |
| 4 | 166 | 877 | 2 | 2.88 |
| 6 | 230 | 2889 | 2 | 3.29 |
| 8 | 294 | 10661 | 2 | 3.69 |
| 10 | 358 | 41473 | 2 | 3.89 |

**Observation 28 (E4).** With `d` nested blocks each missing a closer, the driver runs `P = d + 1` passes, which establishes the hypothesis of Theorem 19 for `d ≤ 10`. The evaluation count grows by about 2.1 per level. Only one diagnostic is reported for `d` missing closers. All `d` recoveries are zero-width at the end of the input and carry the same message, and `distinctByPosition` merges them. This loss of diagnostics is incidental to this paper and is recorded for the engineering follow-up.

<!-- exp:E4 -->
| d | valid, recover | d missing, recover | passes | msg | reported | ratio vs d-2 |
|---|---|---|---|---|---|---|
| 1 | 74 | 150 | 2 | 1 | 1 | - |
| 2 | 105 | 335 | 3 | 2 | 1 | 2.23 |
| 4 | 167 | 1497 | 5 | 4 | 1 | 4.47 |
| 6 | 229 | 6391 | 7 | 6 | 1 | 4.27 |
| 8 | 291 | 27653 | 9 | 8 | 1 | 4.33 |
| 10 | 353 | 121011 | 11 | 10 | 1 | 4.38 |

**Observation 29 (E5).** On *valid* input with a fallible beneath `&`, recover mode runs a single pass but grows by a factor of 4 per two levels, as predicted by Theorem 18. Plain mode stays linear.

<!-- exp:E5 -->
| d | plain mode | recover mode | passes | ratio vs d-2 |
|---|---|---|---|---|
| 1 | 79 | 108 | 1 | - |
| 2 | 123 | 238 | 1 | 2.20 |
| 4 | 211 | 978 | 1 | 4.11 |
| 6 | 299 | 3878 | 1 | 3.97 |
| 8 | 387 | 15418 | 1 | 3.98 |
| 10 | 475 | 61518 | 1 | 3.99 |

**Observation 30 (E7).** On the family of Corollary 3, the driver runs exactly `k + 1` passes and reports `k` diagnostics, with `n = 4k`.

<!-- exp:E7 -->
| n | k | passes | reported |
|---|---|---|---|
| 4 | 1 | 2 | 1 |
| 16 | 4 | 5 | 4 |
| 64 | 16 | 17 | 16 |
| 256 | 64 | 65 | 64 |

**Observation 23 (E6).** On a left-recursive sum of 64 items with `k` broken items, `P = k + 1` again. The evaluation count rises from 1747 to 15200 at `k = 16`, a factor of 8.7, for 17 passes. This corroborates Proposition 22’s repeated seed-growth mechanism. Claim 20’s bounded item and message costs are not established for this seed-growth family.

<!-- exp:E6 -->
| k | passes | msg | evals | reported |
|---|---|---|---|---|
| 0 | 1 | 0 | 1747 | 0 |
| 1 | 2 | 1 | 1820 | 1 |
| 2 | 3 | 2 | 2572 | 2 |
| 4 | 5 | 4 | 4136 | 4 |
| 8 | 9 | 8 | 7504 | 8 |
| 16 | 17 | 16 | 15200 | 16 |

## 7. Threats to Validity

- **Model fidelity.** Theorems 12 and 17–19 and Propositions 10, 15, 16 and 22–26 are proved against a model of the code obtained by inspection, not against a mechanized semantics. A misreading of the code would invalidate a proof without being detected. Observations 9–30 give independent evidence that the model matches the code on the measured families. That evidence is not a proof for other grammars.
- **Cost unit.** The evaluation count ignores per-call constant factors, including the branch tests added in Section 5.2. It also ignores the non-`eval` work listed at the start of Section 5: key strings, `substituteParams`, memo invalidation, the attempt store, and garbage collection. Theorem 12 shows that the *number* of evaluations is unchanged without recovery; it does not show that wall-clock time is unchanged. Wall-clock overhead is left to the engineering session.
- **Typical case.** Claims 8 and 20 require ideal-reuse or uniform-cost assumptions beyond the absence of a backtracking choice or predicate above recovery. Error placement determines actual traversed prefixes; short spines do not bound message or driver costs. These conditional arguments are not evidence that practical grammars avoid exponential cost. Many expression grammars contain alternatives with a shared prefix, such as a call and a parenthesized expression. Such prefixes can support repeated evaluation after recovery; Theorem 17 supplies a specific recursively nested family with exponential duplication. No survey of real grammars was made.
- **Experiment scale.** The families are small, `n ≤ 6631` with depth at most 10. Ratios such as 3.89 and 4.38 are finite-size estimates of asymptotic growth constants.
- **Citations.** Bibliographic records and abstracts were checked, with targeted author/preprint body checks for labeled reporting ([5], Section 4), recovery expressions and earlier restart/context recovery ([6], Sections 2.2 and 5), seed growth ([11], Section 3 and Figures 3–9), and examined intervals/invalidation ([14], Sections 3.1.3 and 3.3). These selected body checks are not an exhaustive literature review or independent verification of every bibliographic field. Other source claims retain their abstract/metadata evidence limits; no novelty or diagnostic-guarantee comparison follows from unread bodies.
- **Unproven design goal.** The diagnostic-equality property that motivates the multi-pass design is not proven here. Observation 28 shows that the number of reported diagnostics can be smaller than the number of recoveries.
- **Moving target.** The implementation is unreleased. The analyzed sources are the in-repository fixture of `d55d10ad`, not the checked-out runtime. The checker verifies that the experiment metadata matches the fixture’s recorded source commit `d55d10ad` and content fingerprint, independently of the checkout’s HEAD.

## 8. Related Work

Packrat parsing [1] and PEGs [2] establish the linear-time baseline that Sections 4 and 5 measure against. Rats! obtains linear time through memoization in an imperative setting [9]. Cut operators [8] and sliding-window memoization [10] reduce memo space. The taint rule moves in the same direction as these, toward a smaller memo table, but for soundness rather than for space, and the time cost of Theorems 17–19 is the price. Left-recursive packrat parsing [11], [12] already gives up strict linearity for some grammars; Proposition 22 shows how recovery interacts with seed growth. Labeled failures [5] extend error reporting with labels and catch sets; [6]–[7] add recovery expressions that resume parsing within a pass. Such a strategy avoids this driver’s repeated-primary-pass factor, but the cited results checked here do not establish this paper’s particular diagnostic-equality goal. No incompatibility with that goal follows from one-pass operation. Repeated parsing is also an existing PEG recovery technique: [6], Section 5, discusses Parboiled’s location/repair/resynchronization parses and Rüfenacht’s farthest-failure contextual recovery. Those designs supply relevant restart/context precedents; the one-new-permit-at-farthest-failure policy studied here is more specific. The targeted review establishes neither equivalent diagnostic guarantees nor priority for this policy. Incremental packrat parsing [14] is the mechanism that the driver reuses for cross-pass invalidation, and Proposition 24 shows that it cannot be used across edits in recovering mode. Repair-based recovery for LR parsers [15] addresses similar cost concerns with a time budget instead of a structural bound. The operational semantics of [13] suggests a target for mechanizing the model of Section 3.

## 9. Conclusion and Conjectured Remedies

The general design costs at most `|K| + 1` passes and at least `r + 1` passes. Within the restricted whole-application replay model of Proposition 5, increasing traversed prefixes give a quadratic lower bound on the accepted flat-list family with `Θ(n)` errors. Lemma 4 supplies a sufficient reuse condition, not a universal invalidation or re-evaluation rule. For Ohm, Theorem 12 and Corollary 14 give equal evaluation counts under their taint-free and predicate-reachability hypotheses, while grammar construction costs a constant number of extra evaluations per sequence factor. Once recovery fires, or a fallible lies beneath a predicate, the coarse taint rule removes memoization along entire spines, and the evaluation count can become exponential in nesting depth on the constructed families. Theorem 17 also gives exponential peak recovery-log space with one distinct accepted key. Flat-list traversal instead depends on the sum of actual visited prefixes, and a tight `Θ(k·m)` term requires an error-placement condition.

**Conjecture 1.** Memoizing a tainted result within a pass, keyed additionally by the identity of the stop stack, the predicate flag `ν`, and a permit-set version, restores a per-pass bound of `O(|G|·n·s)`, where `s` is the number of distinct stop-stack contexts reached at a position. That bound would remove the exponential lower bounds of Theorems 17 and 18.

**Conjecture 2.** A context-valid reuse policy for recovered results whose dependence sets exclude the new permit could remove Claim 20’s repeated-recovery term. Lemma 4 does not itself prove this policy sound for recovered results, which it excludes. If it leaves item visits and their costs bounded as in Claim 20, the resulting evaluation-count upper bound would be `O(W + V) ⊆ O(W + k·m)`. A tight `Θ(k·m)` traversal term would still require the stated placement condition; message and driver costs need separate bounds before this is a total-time claim.

**Conjecture 3.** Keeping the prefix of a guarded iteration from the failed attempt, without re-evaluating it, removes the doubling in Theorem 19.

## References

[1] B. Ford, "Packrat parsing: simple, powerful, lazy, linear time, functional pearl," in *Proc. 7th ACM SIGPLAN Int. Conf. Functional Programming (ICFP '02)*, 2002, pp. 36–47, doi: 10.1145/581478.581483.

[2] B. Ford, "Parsing expression grammars: a recognition-based syntactic foundation," in *Proc. 31st ACM SIGPLAN-SIGACT Symp. Principles of Programming Languages (POPL '04)*, 2004, pp. 111–122, doi: 10.1145/964001.964011.

[3] A. Warth, P. Dubroy, and T. Garnock-Jones, "Modular semantic actions," in *Proc. 12th Symp. Dynamic Languages (DLS 2016)*, 2016, pp. 108–119, doi: 10.1145/2989225.2989231.

[4] Ohm contributors, "ohm-js, branch feat/fallible-v17," source code, [source directory](../../../benchmarks/fallible/fixtures/fallible-before-reuse/packages/ohm-js/src) (in-repository fixture), files `packages/ohm-js/src/{pexprs-evalFallible,Recovery,RecoveredFailure,MatchState,Matcher,MatchResult,pexprs-eval,PosInfo,Builder,buildGrammar}.js` and `ohm-grammar.ohm` [source: inspected at commit d55d10ad]; baseline `support/v17` at commit 4a40f38f.

[5] A. M. Maidl, F. Mascarenhas, S. Medeiros, and R. Ierusalimschy, "Error reporting in parsing expression grammars," *Sci. Comput. Program.*, vol. 132, pp. 129–140, 2016, doi: 10.1016/j.scico.2016.08.004.

[6] S. Medeiros and F. Mascarenhas, "Syntax error recovery in parsing expression grammars," in *Proc. 33rd Annu. ACM Symp. Applied Computing (SAC '18)*, 2018, pp. 1195–1202, doi: 10.1145/3167132.3167261.

[7] S. Q. de Medeiros, G. de Azevedo Alvez Junior, and F. Mascarenhas, "Automatic syntax error reporting and recovery in parsing expression grammars," *Sci. Comput. Program.*, vol. 187, Art. no. 102373, 2020, doi: 10.1016/j.scico.2019.102373.

[8] K. Mizushima, A. Maeda, and Y. Yamaguchi, "Packrat parsers can handle practical grammars in mostly constant space," in *Proc. 9th ACM SIGPLAN-SIGSOFT Workshop Program Analysis for Software Tools and Engineering (PASTE '10)*, 2010, pp. 29–36, doi: 10.1145/1806672.1806679.

[9] R. Grimm, "Better extensibility through modular syntax," in *Proc. 27th ACM SIGPLAN Conf. Programming Language Design and Implementation (PLDI '06)*, 2006, pp. 38–51, doi: 10.1145/1133981.1133987.

[10] K. Kuramitsu, "Packrat parsing with elastic sliding window," *J. Inf. Process.*, vol. 23, no. 4, pp. 505–512, 2015, doi: 10.2197/ipsjjip.23.505.

[11] A. Warth, J. R. Douglass, and T. Millstein, "Packrat parsers can support left recursion," in *Proc. 2008 ACM SIGPLAN Symp. Partial Evaluation and Semantics-Based Program Manipulation (PEPM '08)*, 2008, pp. 103–110, doi: 10.1145/1328408.1328424.

[12] S. Medeiros, F. Mascarenhas, and R. Ierusalimschy, "Left recursion in parsing expression grammars," *Sci. Comput. Program.*, vol. 96, pp. 177–190, 2014, doi: 10.1016/j.scico.2014.01.013.

[13] S. Medeiros and R. Ierusalimschy, "A parsing machine for PEGs," in *Proc. 2008 Symp. Dynamic Languages (DLS '08)*, 2008, pp. 1–12, doi: 10.1145/1408681.1408683.

[14] P. Dubroy and A. Warth, "Incremental packrat parsing," in *Proc. 10th ACM SIGPLAN Int. Conf. Software Language Engineering (SLE 2017)*, 2017, pp. 14–25, doi: 10.1145/3136014.3136022.

[15] L. Diekmann and L. Tratt, "Don't panic! Better, fewer, syntax errors for LR parsers," in *34th Eur. Conf. Object-Oriented Programming (ECOOP 2020)*, LIPIcs vol. 166, 2020, pp. 6:1–6:32, doi: 10.4230/LIPIcs.ECOOP.2020.6.
