import {mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureTree} from './lib/trees.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export function comparisonTrees() {
  return [
    process.argv[2]
      ? resolve(process.argv[2])
      : ensureTree('d55d10ad9661993027416dbbf18311446404f108'),
    process.argv[3]
      ? resolve(process.argv[3])
      : ensureTree('befb31229bf290708ab614bc790ebaf1169bafa5'),
  ];
}

export function outputPath(name) {
  const output = resolve(process.argv[4] || join(here, 'output/reuse', name));
  mkdirSync(dirname(output), {recursive: true});
  return output;
}
