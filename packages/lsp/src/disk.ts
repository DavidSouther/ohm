import {readdirSync, readFileSync} from 'node:fs';
import {extname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import type {ReadonlyVfs} from '@ohm-js/language';

const SKIPPED = new Set(['node_modules', '.git', 'dist']);

/**
 * The files below `roots` whose extension is in `extensions` (with the dot),
 * read from disk on demand, as the base of a language service's file system.
 */
export function diskVfs(roots: readonly string[], extensions: readonly string[]): ReadonlyVfs {
  const walk = (dir: string, out: string[]) => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (SKIPPED.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, out);
      else if (extensions.includes(extname(entry.name))) out.push(pathToFileURL(path).href);
    }
    return out;
  };
  return {
    list: () => roots.flatMap(root => walk(root, [])),
    read(uri) {
      try {
        return readFileSync(fileURLToPath(uri), 'utf8');
      } catch {
        return undefined;
      }
    },
  };
}
