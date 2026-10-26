/* eslint-disable no-console */
/*
  Timings for `B ! C` recovery, for comparison only; not a gate.

    node test/_bench-fallible.js [path/to/ohm-js-17.5.0/dist/ohm.cjs]

  The optional argument is a published ohm-js build to compare valid input
  parse time against. The file name starts with `_` so ava does not run it.
*/

import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import process from 'node:process';

import * as ohm from '../index.mjs';

const RECOVER = {recover: true};

const HDL = String.raw`
Hdl {
  Chip = "CHIP" name "{" Parts "}"
  Parts = "PARTS:" Part* ! &"}"
  Part = PartBody ! ";"
  PartBody = name "(" ListOf<Wire, ","> ")"
  Wire = name "=" name
  name = letter alnum*
}`;
const HDL_PLAIN = HDL.replace('Part* ! &"}"', 'Part* &"}"').replace(
  'PartBody ! ";"',
  'PartBody ";"'
);

function chip(numParts, numBroken) {
  const broken = new Set();
  for (let i = 0; i < numBroken; i++) broken.add(Math.floor((i * numParts) / numBroken));
  const parts = [];
  for (let i = 0; i < numParts; i++) {
    parts.push(broken.has(i) ? `  Nand(a=a b=b, out=w${i});` : `  Nand(a=a, b=b, out=w${i});`);
  }
  return `CHIP Big {\n PARTS:\n${parts.join('\n')}\n}\n`;
}

// Small inputs, each with recovered errors.
const CORPUS = {
  'chip, two broken parts': [
    `Chips {
      Chip = "CHIP" name "{" Part* "}"
      Part = PartBody ! ";"
      PartBody = name "(" name ")"
      name = letter alnum*
    }`,
    'CHIP A { N(a b); M(c); X(; }',
  ],
  'block, three errors': [
    `Exact {
      Block = "{" Stmt* ! &"}" "}"
      Stmt  = Body ! ";"
      Body  = ident
      ident = letter+
    }`,
    '{\naaa;\nb b;\nc c;\nddd;\nxxx\n}',
  ],
  'blocks, thirty strays': [
    `Blocks {
      Prog = Sub*
      Sub = "sub" "{" Stmt* ! &"}" "}"
      Stmt = StmtBody ! ";"
      StmtBody = Let | Do
      Let = "let" letter
      Do = "do" letter
    }`,
    'sub { ' + '; '.repeat(30) + '}',
  ],
};

// Median time in ms of `fn` over `runs` runs, after warm-up.
function time(fn, runs = 15) {
  for (let i = 0; i < 3; i++) fn();
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const ms = x => x.toFixed(2);

console.log(`node ${process.version}, ${new Date().toISOString()}\n`);

// 1. Valid input, against a published ohm-js.
const valid = chip(480, 0);
const g = ohm.grammar(HDL);
const local = time(() => g.match(valid));
console.log(`Valid 13 KB chip (${valid.length} bytes), median ms:`);
console.log(`- this build, fallible grammar, no recover: ${ms(local)}`);
const recovering = time(() => g.match(valid, undefined, RECOVER));
console.log(`- this build, fallible grammar, recover: ${ms(recovering)}`);
console.log(
  `- this build, plain grammar: ${ms(time(() => ohm.grammar(HDL_PLAIN).match(valid)))}`
);
if (process.argv[2]) {
  const published = createRequire(import.meta.url)(process.argv[2]);
  const pg = published.grammar(HDL_PLAIN);
  console.log(
    `- ohm-js ${published.version}, plain grammar: ${ms(time(() => pg.match(valid)))}`
  );
}

// 2. Recovered parse time for each corpus input.
console.log('\nRecovered corpus inputs, median ms:');
for (const [name, [source, input]] of Object.entries(CORPUS)) {
  const cg = ohm.grammar(source);
  const n = cg.match(input, undefined, RECOVER).getRecoveredFailures().length;
  console.log(
    `- ${name} (${n} errors): ${ms(time(() => cg.match(input, undefined, RECOVER)))}`
  );
}

// 3. The 13 KB chip with broken parts.
console.log('\n13 KB chip with recover, median ms:');
for (const broken of [0, 10, 100, 300]) {
  const input = chip(480, broken);
  const n = g.match(input, undefined, RECOVER).getRecoveredFailures().length;
  const t = time(() => g.match(input, undefined, RECOVER), 7);
  console.log(`- ${broken} broken parts (${n} errors): ${ms(t)}`);
}
