# Failed join reporting position

Given this fallible grammar

```ohm
Names {
  Start = "name" ! ";"
}
```

and the input `name\n wrong`, Ohm looks for a semicolon at the `w` in `wrong`. `B ! C` recognizes the same inputs as `B C`, and the rightmost failure is at position 6 (line 2, column 2), where the join looks for the semicolon. The packrat parser memoizes failures at that rightmost position. With or without recovery, the reported diagnostic is position 4 (line 1, column 5), the end of the guard `name`, before the join.

For a literal join or an alternation of literals, finding that position only requires subtracting the implicit space before the failed join. For join expressions that include lookaheads, negations or rules that might not consume input, two mechanisms are needed: a proof that the join retains a terminal whenever it succeeds (`JoinTerminalRetention.js`), and diagnostic-position proposals carried by failure groups and recovery failure summaries (`FailureGroup.js`).

## Failure position and diagnostic position

The **failure position** is the furthest input index where the parser records an unmet expectation. The **diagnostic position** is the input index reported for the error. In the opening example, the failure position is 6, where the join looks for a semicolon. The guard's last retained terminal ends at index 4. This reports the diagnostic `expected ";"` just after `name`. The parser still uses the failure position to select expectations and, during recovery, the attempts eligible for a retry.

The join starts at the input position where the guard ends. The diagnostic can go at the end of the last retained terminal, a nonempty terminal match that survives in the successful guard. Implicit space, predicates, and matches in discarded alternatives contribute no retained terminal. Explicitly matched space can be retained. If the opening guard ends with an empty syntactic rule, the parser skips the newline and space on entry to that rule. The guard then ends at index 6, and its last retained terminal still ends at index 4.

The span discarded during recovery answers a separate question. If the input is `name bad;`, the parser can skip `bad`, match the real semicolon, and continue. The skipped interval covers `bad`. The diagnostic can still point just after `name`, and a strict failure can use that same diagnostic position without performing a skip.

## Did the join fail at its starting point?

The guard must succeed with a retained terminal ending past the start of the fallible expression. The join must have at least one strong failure at its failure position. Strong failures contribute to the reported expectations. Take the length of the shortest implicit space span immediately preceding those failures. Subtract it from their shared index. The result must equal the input position where the guard ends. The span used to compute the diagnostic position extends back to the retained terminal end.

The parser measures implicit space as it matches. That lets it account for comments skipped by the grammar and for spaces matched as explicit terminals. Using the shortest span preserves the evidence of a path that reached the failure through explicit input.

The join also needs its own record of terminal progress. Consider input `a xz` after the guard `"a"`. As a single terminal, `"xy"` fails at the `x` without completing a match. As a sequence, `"x" "y"` completes the first terminal and fails at the `z`. Reporting that second failure at the guard boundary would hide how far the join got. A complete terminal in an abandoned join alternative counts too. A terminal inspected inside a predicate or during implicit space skipping contributes no such progress.

## What would a successful join retain?

A failed join cannot demonstrate what a successful match would retain. On `a x`, both `"a" ! ";"` and `"a" ! &";"` retain the same guard and fail at the `x` expecting a semicolon. For the literal join, the diagnostic position is just after the `a`. The lookahead checks for a semicolon at the current position, so its diagnostic position is the index of the `x`. A negation also checks a condition without consuming input. Either kind of predicate can appear inside a join that consumes elsewhere.

The proof looks for a guarantee that success retains a nonempty terminal. Nonempty literals, character ranges, and character classes supply it directly. A case-insensitive match can supply it when its argument is known to be a nonempty literal. A sequence can prove the guarantee through any factor, and a choice must prove it for every alternative. One-or-more repetition and lexical wrappers inherit the guarantee from their operand. Optional and zero-or-more expressions can succeed without matching their operands. For a rule application, the proof follows the rule in the effective grammar and reasons from the facts known about its arguments. The same parameterized rule can have a consuming join in one application and a zero-width join in another.

A cycle or a limit on proof depth or visits can leave consumption unproved. The diagnostic then uses the failure position. A top-level proof starts with a fresh allowance and no active applications, so its result can be reused for the same join and resolved arguments in the same grammar. An inconclusive subproof can depend on the active applications or the remaining allowance. Giving argument classification and rule traversal separate allowances can let a mandatory terminal establish consumption even when an expensive argument exceeds its allowance.

## Which failure determines the diagnostic position?

Several alternatives can reach the same failure position. The group for that position can have no proposal, one agreed diagnostic position, or a recorded disagreement. Only strong failures contribute to that decision. A probe failure can be incidental if it occurs where the successful optional expression ends. If the probe reached farther, its failure can still be strong.

A strong guard failure can share a new join proposal when both failures are at the same index and the guard group's space-adjusted position is at or before the retained terminal end. The guard group must have no existing proposal or disagreement.

Use the proposed position only when the strong paths agree. On `a x`, one rule can reach a fallible join `"a" ! ";"` and propose the end of `a`. A competing rule with the ordinary sequence `"a" ";"` supplies an independent failure at `x`. Both expect a semicolon. The diagnostic lists the expectation once and uses the failure position. The same rule applies when nested joins propose different boundaries. In either case, the disagreement survives a merge into an enclosing join.

## What memoization must preserve

The parser gathers the boundary evidence during evaluation, while it can still see what the guard retained and what the join attempted. A recovery pass can gather it as it runs. A strict failure can gather it during the pass that collects expectations. The proposed diagnostic position stays with the failure group after the parser discards the failed match.

Replaying a memoized result must restore both kinds of terminal progress and the failure evidence. Relative offsets preserve the failure position, the ends of the last retained terminal and the farthest completed terminal during the attempt, and any proposed diagnostic position. A failure at the rule's entrance takes its preceding implicit space from the current invocation. A failure group can supply expectations and boundary evidence only for the failure position where it collected them. When evidence is missing, the parser can collect it again at the saved failure position using the original input and the same recovery decisions.
