# Frozen fallible runtime before recovery reuse

This directory holds a frozen copy of `packages/ohm-js/{src,dist,index.mjs,package.json}`
exactly as at commit `d55d10ad9661993027416dbbf18311446404f108` (branch
`feat/fallible-v17`), extracted with `git archive`. That commit is the initial
fallible implementation, before indexed recovery and recovery-work reuse, and it is
not an ancestor of this branch. The copy lets the benchmark harness and the
complexity paper's experiments run that implementation without the commit being
present in Git.

- Purpose: the "before" runtime of the benchmark comparisons, the subject of the
  historical pass-count assertions and full-scan instrumentation in `run.mjs`, and
  the implementation analyzed by
  [the complexity paper](../../../../doc/research/fallible-overhead/paper.md).
- Provenance: [`.benchmark-source.json`](.benchmark-source.json) records the source
  commit and a SHA-256 fingerprint of the four copied paths, computed by
  `fingerprint()` in [`lib/trees.mjs`](../../lib/trees.mjs). Fingerprint
  `0a90a9d00239593bff5fd888956f03340992e525f1343461496f3c0210a8158d`.
- Frozen: do not edit, format or rebuild these files. The harness and the paper
  checker refuse to run when the fingerprint no longer matches. Linting and
  formatting ignore this directory.
