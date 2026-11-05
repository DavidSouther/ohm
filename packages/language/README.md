# @ohm-js/language

Editor data from Ohm semantic actions. Add a `roles` attribute to an existing grammar's semantics, or wrap existing actions, and get diagnostics, document symbols, definitions, references, rename and completion from one language service.

```js
import {addRoles, createLanguageService, roles} from '@ohm-js/language';

addRoles(semantics, {
  Assign: (name, _eq, _expr) => roles.ref(name, 'variable', {orDeclare: 'variable', after: true}),
  Var: name => roles.ref(name, 'variable'),
});
const service = createLanguageService(semantics, {start: 'Program'});
service.open('file:///a.calc', 1, 'a = 1;\nb = a;\n');
service.definition('file:///a.calc', offset);
```

The service parses with `recover: true`, so it keeps answering while a file is being typed. A reference that cannot resolve in a file with skipped input is reported as a hint, not an error.

Serve a service to an editor with [`@ohm-js/lsp`](../lsp).
