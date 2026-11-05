# @ohm-js/lsp

Serves a `@ohm-js/language` service over the Language Server Protocol with `vscode-jsonrpc`.

```js
import {serve} from '@ohm-js/lsp';

serve(service, {input: process.stdin, output: process.stdout});
```

Supported: full text sync, diagnostics with document versions, document symbols, definition, references, rename and completion.
