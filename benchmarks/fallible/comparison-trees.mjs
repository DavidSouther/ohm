import {mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureTree, workingTree} from './lib/trees.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// Before: the frozen historical fixture. After: this checkout's packages/ohm-js.
export function comparisonTrees() {
  return [
    process.argv[2] ? resolve(process.argv[2]) : fixtureTree(),
    process.argv[3] ? resolve(process.argv[3]) : workingTree(),
  ];
}

export function outputPath(name) {
  const output = resolve(process.argv[4] || join(here, 'output/reuse', name));
  mkdirSync(dirname(output), {recursive: true});
  return output;
}
