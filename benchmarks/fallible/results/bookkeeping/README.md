# Historical increased-bookkeeping measurements

The files in this directory preserve the original full-run artifacts byte for
byte. The comparison is baseline `4a40f38f414023d57934d108efccd4c5eea5b546`
versus the initial fallible implementation
`d55d10ad9661993027416dbbf18311446404f108`, before the indexed recovery and
memo-reuse changes. See the [engineering report](../../bookkeeping.md) and
[reproduction commands](../../README.md).

- [results.json](results.json), [matching.csv](matching.csv), and
  [report-tables.md](report-tables.md): complete original full-run summary,
  including both baseline and fallible rows and environment/provenance metadata.
- [results-paired.json](results-paired.json) and
  [report-paired.md](report-paired.md): interleaved within-tree comparisons.
- [results-paired-dual.json](results-paired-dual.json) and
  [report-paired-dual.md](report-paired-dual.md): interleaved cross-tree comparisons.
- [results-paired-micro.json](results-paired-micro.json) and
  [report-paired-micro.md](report-paired-micro.md): interleaved micro-grammar comparisons.

The original paired JSON records the profile, Node version, and result rows;
its source-commit context comes from the accompanying full-run metadata and
engineering report. New paired runs additionally record source metadata.
Original metadata includes absolute paths in the snapshot of busiest processes;
those strings are historical evidence and are never used to locate runtime code.
Full-run raw process outputs, transient logs, and smoke outputs are excluded.
