# Paired (interleaved) comparisons, fallible tree

Ratio = config / reference per iteration, median over pooled iterations (IQR in brackets); `proc spread` = (max - min) / median of the per-process median ratios.

## Matching on valid input

| workload | scale | reference | config | ref ms | config ms | ratio | IQR | n | proc spread |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prog/blocks | 1 | plain/match | bang/match | 0.363 | 0.363 | 0.999x | 0.960-1.034 | 1600 | 0.9% |
| prog/blocks | 3 | plain/match | bang/match | 1.114 | 1.114 | 0.999x | 0.970-1.030 | 1376 | 0.2% |
| prog/blocks | 10 | plain/match | bang/match | 3.910 | 3.858 | 0.997x | 0.928-1.065 | 399 | 1.2% |
| prog/blocks | 30 | plain/match | bang/match | 13.242 | 13.029 | 1.009x | 0.982-1.034 | 120 | 2.8% |
| prog/blocks | 100 | plain/match | bang/match | 52.929 | 56.186 | 1.000x | 0.942-1.116 | 60 | 9.4% |
| prog/blocks | 300 | plain/match | bang/match | 166.805 | 164.205 | 0.990x | 0.933-1.070 | 60 | 5.6% |
| prog/flat | 1 | plain/match | bang/match | 0.366 | 0.366 | 1.001x | 0.984-1.017 | 1600 | 0.3% |
| prog/flat | 3 | plain/match | bang/match | 1.074 | 1.076 | 1.000x | 0.976-1.026 | 1287 | 0.2% |
| prog/flat | 10 | plain/match | bang/match | 4.135 | 4.166 | 0.998x | 0.942-1.074 | 358 | 1.2% |
| prog/flat | 30 | plain/match | bang/match | 15.128 | 14.978 | 0.991x | 0.965-1.029 | 110 | 0.8% |
| prog/flat | 100 | plain/match | bang/match | 48.119 | 48.707 | 1.026x | 0.962-1.062 | 60 | 4.0% |
| prog/flat | 300 | plain/match | bang/match | 153.080 | 148.697 | 0.999x | 0.898-1.068 | 60 | 13.4% |
| lex/lines | 1 | plain/match | bang/match | 1.213 | 1.213 | 0.998x | 0.967-1.034 | 1255 | 0.1% |
| lex/lines | 3 | plain/match | bang/match | 3.953 | 4.020 | 1.012x | 0.921-1.097 | 389 | 4.9% |
| lex/lines | 10 | plain/match | bang/match | 18.746 | 19.136 | 1.022x | 0.967-1.114 | 85 | 4.7% |
| lex/lines | 30 | plain/match | bang/match | 61.833 | 64.964 | 1.040x | 0.939-1.095 | 60 | 7.5% |
| lex/lines | 100 | plain/match | bang/match | 217.296 | 229.301 | 1.018x | 0.926-1.087 | 60 | 5.0% |
| lex/lines | 300 | plain/match | bang/match | 676.887 | 693.626 | 1.021x | 0.929-1.116 | 36 | 8.0% |
| prog/blocks | 1 | plain/match | plain/recover | 0.363 | 0.394 | 1.077x | 1.046-1.125 | 1600 | 0.4% |
| prog/blocks | 1 | plain/match | bang/recover | 0.363 | 0.392 | 1.072x | 1.036-1.126 | 1600 | 1.8% |
| prog/blocks | 3 | plain/match | plain/recover | 1.132 | 1.214 | 1.080x | 1.028-1.113 | 1257 | 3.8% |
| prog/blocks | 3 | plain/match | bang/recover | 1.132 | 1.237 | 1.081x | 1.022-1.116 | 1257 | 4.5% |
| prog/blocks | 10 | plain/match | plain/recover | 4.114 | 4.449 | 1.086x | 1.029-1.141 | 351 | 0.7% |
| prog/blocks | 10 | plain/match | bang/recover | 4.114 | 4.547 | 1.090x | 1.027-1.161 | 351 | 0.9% |
| prog/blocks | 30 | plain/match | plain/recover | 12.555 | 13.524 | 1.074x | 1.049-1.102 | 114 | 1.7% |
| prog/blocks | 30 | plain/match | bang/recover | 12.555 | 13.597 | 1.078x | 1.060-1.101 | 114 | 1.6% |
| prog/blocks | 100 | plain/match | plain/recover | 51.235 | 53.835 | 1.069x | 0.994-1.133 | 60 | 2.8% |
| prog/blocks | 100 | plain/match | bang/recover | 51.235 | 55.109 | 1.108x | 0.997-1.159 | 60 | 4.2% |
| prog/blocks | 300 | plain/match | plain/recover | 171.697 | 182.012 | 1.087x | 0.984-1.185 | 60 | 4.3% |
| prog/blocks | 300 | plain/match | bang/recover | 171.697 | 173.524 | 1.063x | 0.978-1.150 | 60 | 7.2% |
| prog/flat | 1 | plain/match | plain/recover | 0.365 | 0.394 | 1.078x | 1.052-1.097 | 1600 | 0.2% |
| prog/flat | 1 | plain/match | bang/recover | 0.365 | 0.392 | 1.071x | 1.045-1.094 | 1600 | 0.5% |
| prog/flat | 3 | plain/match | plain/recover | 1.078 | 1.165 | 1.082x | 1.054-1.108 | 1348 | 0.4% |
| prog/flat | 3 | plain/match | bang/recover | 1.078 | 1.167 | 1.082x | 1.049-1.115 | 1348 | 0.7% |
| prog/flat | 10 | plain/match | plain/recover | 3.750 | 4.108 | 1.086x | 1.020-1.154 | 395 | 1.5% |
| prog/flat | 10 | plain/match | bang/recover | 3.750 | 4.106 | 1.090x | 1.026-1.157 | 395 | 0.9% |
| prog/flat | 30 | plain/match | plain/recover | 12.301 | 13.244 | 1.077x | 1.056-1.107 | 124 | 2.0% |
| prog/flat | 30 | plain/match | bang/recover | 12.301 | 13.276 | 1.078x | 1.055-1.100 | 124 | 0.6% |
| prog/flat | 100 | plain/match | plain/recover | 46.863 | 51.463 | 1.106x | 1.018-1.161 | 60 | 15.9% |
| prog/flat | 100 | plain/match | bang/recover | 46.863 | 53.184 | 1.107x | 1.007-1.177 | 60 | 14.3% |
| prog/flat | 300 | plain/match | plain/recover | 150.017 | 162.957 | 1.062x | 0.989-1.155 | 60 | 8.1% |
| prog/flat | 300 | plain/match | bang/recover | 150.017 | 169.037 | 1.078x | 1.010-1.184 | 60 | 4.0% |
| lex/lines | 1 | plain/match | plain/recover | 1.335 | 1.516 | 1.124x | 1.057-1.197 | 1068 | 1.5% |
| lex/lines | 1 | plain/match | bang/recover | 1.335 | 1.533 | 1.132x | 1.061-1.222 | 1068 | 1.2% |
| lex/lines | 3 | plain/match | plain/recover | 4.050 | 4.561 | 1.122x | 1.020-1.242 | 352 | 1.9% |
| lex/lines | 3 | plain/match | bang/recover | 4.050 | 4.587 | 1.143x | 1.074-1.238 | 352 | 3.1% |
| lex/lines | 10 | plain/match | plain/recover | 18.132 | 20.926 | 1.144x | 1.045-1.267 | 81 | 11.3% |
| lex/lines | 10 | plain/match | bang/recover | 18.132 | 20.352 | 1.152x | 1.012-1.283 | 81 | 8.9% |
| lex/lines | 30 | plain/match | plain/recover | 62.149 | 69.069 | 1.111x | 1.053-1.221 | 60 | 3.3% |
| lex/lines | 30 | plain/match | bang/recover | 62.149 | 71.585 | 1.114x | 1.063-1.173 | 60 | 2.2% |
| lex/lines | 100 | plain/match | plain/recover | 208.021 | 240.953 | 1.178x | 1.081-1.253 | 60 | 12.5% |
| lex/lines | 100 | plain/match | bang/recover | 208.021 | 228.079 | 1.128x | 1.024-1.214 | 60 | 3.9% |
| lex/lines | 300 | plain/match | plain/recover | 669.191 | 777.327 | 1.183x | 1.114-1.242 | 33 | 7.3% |
| lex/lines | 300 | plain/match | bang/recover | 669.191 | 800.984 | 1.156x | 1.059-1.282 | 33 | 16.9% |

## Construction: source with `!` over its `!`-free twin

| source | ratio | IQR | n | proc spread | plain ms | bang ms |
| --- | --- | --- | --- | --- | --- | --- |
| prog | 1.007x | 0.951-1.070 | 815 | 2.1% | 2.247 | 2.253 |
| syn10 | 0.999x | 0.959-1.057 | 1297 | 1.7% | 1.400 | 1.412 |
| syn100 | 1.006x | 0.985-1.039 | 141 | 1.8% | 13.408 | 13.643 |
| syn1000 | 1.008x | 0.946-1.068 | 60 | 2.5% | 155.679 | 158.449 |
| lex | 0.998x | 0.940-1.074 | 1600 | 0.7% | 0.432 | 0.433 |
