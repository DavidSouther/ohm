# Recovery reuse: matched before/after benchmark

Original engineering benchmark workloads and worker, with a bounded live profile: scales 1, 3, 10, 30, 100; three alternating-order processes per tree; 30 ms warmup; 100 ms sample budget; 3–30 samples per cell. Matching below includes the original match operation; +diag cells are retained in results.json. Counters and memory run separately. No universal complexity claim follows from finite measurements.

| Workload | Regime | Scale | Before ms | After ms | Speedup |
| --- | --- | ---: | ---: | ---: | ---: |
| prog/blocks | valid | 1 | 0.655 | 2.618 | 0.250x |
| prog/blocks | valid | 3 | 1.976 | 8.370 | 0.236x |
| prog/blocks | valid | 10 | 6.745 | 29.748 | 0.227x |
| prog/blocks | valid | 30 | 22.302 | 87.218 | 0.256x |
| prog/blocks | valid | 100 | 79.796 | 320.442 | 0.249x |
| prog/flat | valid | 1 | 0.669 | 2.438 | 0.274x |
| prog/flat | valid | 3 | 1.976 | 7.793 | 0.254x |
| prog/flat | valid | 10 | 6.438 | 25.582 | 0.252x |
| prog/flat | valid | 30 | 20.021 | 79.134 | 0.253x |
| prog/flat | valid | 100 | 75.200 | 304.361 | 0.247x |
| prog/blocks | invalid-single | 1 | 0.758 | 2.433 | 0.312x |
| prog/blocks | invalid-single | 3 | 2.211 | 7.729 | 0.286x |
| prog/blocks | invalid-single | 10 | 6.933 | 28.742 | 0.241x |
| prog/blocks | invalid-single | 30 | 22.429 | 91.320 | 0.246x |
| prog/blocks | invalid-single | 100 | 89.432 | 330.560 | 0.271x |
| prog/flat | invalid-single | 1 | 0.627 | 2.443 | 0.257x |
| prog/flat | invalid-single | 3 | 2.027 | 8.079 | 0.251x |
| prog/flat | invalid-single | 10 | 7.065 | 29.171 | 0.242x |
| prog/flat | invalid-single | 30 | 21.540 | 85.423 | 0.252x |
| prog/flat | invalid-single | 100 | 83.579 | 327.618 | 0.255x |
| prog/blocks | invalid-dense | 1 | 0.715 | 2.227 | 0.321x |
| prog/blocks | invalid-dense | 3 | 2.284 | 7.747 | 0.295x |
| prog/blocks | invalid-dense | 10 | 9.131 | 27.688 | 0.330x |
| prog/blocks | invalid-dense | 30 | 38.409 | 89.269 | 0.430x |
| prog/blocks | invalid-dense | 100 | 240.585 | 310.142 | 0.776x |
| prog/flat | invalid-dense | 1 | 0.665 | 2.358 | 0.282x |
| prog/flat | invalid-dense | 3 | 2.156 | 7.685 | 0.281x |
| prog/flat | invalid-dense | 10 | 7.714 | 27.298 | 0.283x |
| prog/flat | invalid-dense | 30 | 33.765 | 84.553 | 0.399x |
| prog/flat | invalid-dense | 100 | 202.777 | 294.946 | 0.688x |
| lex/lines | valid | 1 | 2.145 | 5.079 | 0.422x |
| lex/lines | valid | 3 | 7.337 | 16.646 | 0.441x |
| lex/lines | valid | 10 | 29.529 | 59.848 | 0.493x |
| lex/lines | valid | 30 | 99.018 | 188.355 | 0.526x |
| lex/lines | valid | 100 | 338.183 | 682.215 | 0.496x |
| lex/lines | invalid-single | 1 | 2.193 | 4.744 | 0.462x |
| lex/lines | invalid-single | 3 | 7.724 | 16.220 | 0.476x |
| lex/lines | invalid-single | 10 | 28.027 | 63.495 | 0.441x |
| lex/lines | invalid-single | 30 | 103.174 | 198.507 | 0.520x |
| lex/lines | invalid-single | 100 | 335.790 | 677.294 | 0.496x |
| lex/lines | invalid-dense | 1 | 2.985 | 4.738 | 0.630x |
| lex/lines | invalid-dense | 3 | 13.377 | 16.981 | 0.788x |
| lex/lines | invalid-dense | 10 | 100.438 | 59.455 | 1.689x |
| lex/lines | invalid-dense | 30 | 821.853 | 178.179 | 4.613x |
| lex/lines | invalid-dense | 100 | 8857.823 | 655.655 | 13.510x |

Full distributions, per-process medians, plain-input checks, raw runs, work counters and memory samples are in results.json and raw/.
