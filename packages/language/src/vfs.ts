import type {ReadonlyVfs} from './types.ts';

/** A file system whose open documents shadow a read-only base, such as the disk. */
export interface OverlayVfs extends ReadonlyVfs {
  /** Sets the text of an open document, which wins over the base. */
  set(uri: string, text: string): void;
  /** Drops an open document; the base copy, if any, shows through again. */
  delete(uri: string): void;
  has(uri: string): boolean;
}

export const emptyVfs: ReadonlyVfs = {
  async *list() {},
  read: async () => undefined,
};

/** A file system over fixed contents, for tests and for hosts that already hold their files. */
export function createMemoryVfs(files: Readonly<Record<string, string>>): ReadonlyVfs {
  return {
    async *list() {
      yield* Object.keys(files);
    },
    read: async uri => files[uri],
  };
}

export function createOverlayVfs(base: ReadonlyVfs = emptyVfs): OverlayVfs {
  const open = new Map<string, string>();
  return {
    set: (uri, text) => void open.set(uri, text),
    delete: uri => void open.delete(uri),
    has: uri => open.has(uri),
    async read(uri) {
      return open.has(uri) ? open.get(uri) : await base.read(uri);
    },
    async *list() {
      yield* open.keys();
      for await (const uri of base.list()) if (!open.has(uri)) yield uri;
    },
  };
}
