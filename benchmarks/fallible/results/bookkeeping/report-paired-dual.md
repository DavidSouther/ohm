# Paired (interleaved) comparisons, fallible tree

Ratio = config / reference per iteration, median over pooled iterations (IQR in brackets); `proc spread` = (max - min) / median of the per-process median ratios.

## Matching on valid input, within the fallible tree

| workload | scale | reference | config | ref ms | config ms | ratio | IQR | n | proc spread |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Regression check, both trees in one process, interleaved: fallible / baseline, `!`-free grammar

| workload | scale | baseline ms | fallible ms | ratio | IQR | n | proc spread |
| --- | --- | --- | --- | --- | --- | --- | --- |
| prog/blocks | 1 | 0.390 | 0.415 | 1.058x | 0.984-1.143 | 1600 | 1.2% |
| prog/blocks | 3 | 1.045 | 1.109 | 1.058x | 1.027-1.092 | 1443 | 0.9% |
| prog/blocks | 10 | 3.568 | 3.777 | 1.059x | 0.995-1.115 | 419 | 2.9% |
| prog/blocks | 30 | 13.110 | 13.674 | 1.045x | 1.018-1.075 | 117 | 3.2% |
| prog/blocks | 100 | 49.691 | 50.778 | 1.039x | 0.965-1.087 | 60 | 6.7% |
| prog/blocks | 300 | 151.562 | 166.929 | 1.052x | 0.981-1.141 | 60 | 5.4% |
| prog/flat | 1 | 0.364 | 0.396 | 1.062x | 1.001-1.122 | 1600 | 2.8% |
| prog/flat | 3 | 1.003 | 1.065 | 1.057x | 1.032-1.087 | 1491 | 1.7% |
| prog/flat | 10 | 3.586 | 3.696 | 1.043x | 0.982-1.097 | 429 | 9.5% |
| prog/flat | 30 | 11.842 | 12.542 | 1.051x | 1.031-1.078 | 130 | 2.8% |
| prog/flat | 100 | 45.246 | 49.168 | 1.081x | 1.007-1.134 | 60 | 5.6% |
| prog/flat | 300 | 151.046 | 155.303 | 1.043x | 0.973-1.127 | 60 | 5.0% |
| lex/lines | 1 | 1.231 | 1.241 | 1.010x | 0.960-1.061 | 1199 | 1.3% |
| lex/lines | 3 | 4.146 | 4.195 | 1.006x | 0.902-1.131 | 356 | 9.3% |
| lex/lines | 10 | 18.830 | 19.134 | 1.001x | 0.930-1.083 | 84 | 3.0% |
| lex/lines | 30 | 64.244 | 61.671 | 0.976x | 0.921-1.080 | 60 | 5.4% |
| lex/lines | 100 | 213.910 | 220.324 | 0.999x | 0.917-1.076 | 60 | 8.8% |
| lex/lines | 300 | 716.663 | 709.734 | 1.015x | 0.907-1.068 | 36 | 2.3% |

## Construction, both trees in one process, interleaved: fallible / baseline

| source (operation) | baseline ms | fallible ms | ratio | IQR | n | proc spread |
| --- | --- | --- | --- | --- | --- | --- |
| prog-plain (ohm.grammar) | 2.100 | 2.342 | 1.122x | 1.047-1.206 | 823 | 2.0% |
| prog-plain (metagrammar parse) | 1.641 | 1.843 | 1.136x | 1.036-1.225 | 1036 | 4.8% |
| ohm-grammar.ohm (ohm.grammar) | 5.958 | 6.341 | 1.124x | 0.928-1.299 | 305 | 4.7% |
| ohm-grammar.ohm (metagrammar parse) | 4.231 | 4.941 | 1.133x | 0.944-1.327 | 409 | 4.2% |
| lex-plain (ohm.grammar) | 0.394 | 0.445 | 1.111x | 1.060-1.180 | 1600 | 4.9% |
| lex-plain (metagrammar parse) | 0.267 | 0.301 | 1.140x | 1.083-1.202 | 1600 | 5.9% |
| syn10-plain (ohm.grammar) | 1.217 | 1.395 | 1.124x | 1.070-1.204 | 1384 | 5.2% |
| syn10-plain (metagrammar parse) | 0.869 | 0.997 | 1.148x | 1.107-1.202 | 1600 | 5.5% |
| syn100-plain (ohm.grammar) | 12.952 | 14.584 | 1.117x | 1.076-1.169 | 145 | 6.6% |
| syn100-plain (metagrammar parse) | 9.527 | 10.703 | 1.147x | 1.042-1.300 | 201 | 11.9% |
| syn1000-plain (ohm.grammar) | 143.874 | 168.108 | 1.113x | 1.048-1.204 | 60 | 12.1% |
| syn1000-plain (metagrammar parse) | 105.003 | 117.260 | 1.113x | 1.071-1.184 | 60 | 4.7% |

## Construction: source with `!` over its `!`-free twin

| source | ratio | IQR | n | proc spread | plain ms | bang ms |
| --- | --- | --- | --- | --- | --- | --- |
