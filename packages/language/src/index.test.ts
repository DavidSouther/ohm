import test from 'ava';

import {addRoles, createLanguageService, roles} from './index.ts';

test('public surface is exported', t => {
  t.is(typeof addRoles, 'function');
  t.is(typeof createLanguageService, 'function');
  t.is(typeof roles.scope, 'function');
});
