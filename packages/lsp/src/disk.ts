import {opendir, readFile} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import type {ReadonlyVfs} from '@ohm-js/language';

const SKIPPED = new Set(['node_modules', '.git', 'dist']);

/**
 * The files below `roots` whose extension is in `extensions` (with the dot),
 * streamed as the directories are walked and read on demand, as the base of a
 * language service's file system.
 */
export function diskVfs(roots: readonly string[], extensions: readonly string[]): ReadonlyVfs {
  async function* walk(dir: string): AsyncGenerator<string> {
    for await (const entry of await opendir(dir)) {
      if (SKIPPED.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(path);
      else if (extensions.includes(extname(entry.name))) yield pathToFileURL(path).href;
    }
  }
  return {
    async *list() {
      for (const root of roots) yield* walk(root);
    },
    async read(uri) {
      try {
        return await readFile(fileURLToPath(uri), 'utf8');
      } catch {
        return undefined;
      }
    },
  };
}
