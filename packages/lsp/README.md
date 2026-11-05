# @ohm-js/lsp

Serves a `@ohm-js/language` service over the Language Server Protocol with `vscode-jsonrpc`.

```js
import {serve} from '@ohm-js/lsp';

serve(service, {input: process.stdin, output: process.stdout});
```

Supported: full text sync, diagnostics with document versions, document symbols, definition, references, rename and completion.

`diskVfs(roots, extensions)` gives a service's `workspace.vfs` the files below some folders, streamed as the directories are walked. The server scans them on `initialized`, follows `workspace/didChangeWatchedFiles`, and reanalyzes and republishes documents that depend on an edited one after a short pause (`debounceMs`).
