import {emptyEffects} from './RecoveryEffects.js';

// Immutable summaries follow bindings through memo and cache reuse. They
// describe the retained CST without walking or materializing its children.
const ownership = new WeakMap();
const membership = new WeakMap();

export function recoveriesOf(node) {
  return ownership.get(node) || emptyEffects;
}

export function setRecoveries(node, effects) {
  if (effects !== emptyEffects) ownership.set(node, effects);
}

export function inheritRecoveries(node, children) {
  let effects = emptyEffects;
  for (const child of children) effects = effects.concat(recoveriesOf(child));
  setRecoveries(node, effects);
}

export function correctionOwns(node, recovered, nested = emptyEffects) {
  let effects = emptyEffects.append(recovered);
  if (nested.forEachUnique) effects = effects.concat(nested);
  else for (const failure of nested) effects = effects.append(failure);
  setRecoveries(node, effects);
}

export function partitionRecoveries(failures, retained) {
  const owned = recoveriesOf(retained);
  if (owned === emptyEffects) return {owned: emptyEffects, discarded: failures};
  let identities = membership.get(owned);
  if (!identities) {
    identities = new Set();
    owned.forEachUnique(failure => identities.add(failure));
    membership.set(owned, identities);
  }
  // Flatten only distinct discarded diagnostics. Stacking lazy predicates over
  // shared histories would revisit the same segment under growing filter contexts.
  let retainedEffects = emptyEffects;
  let discarded = emptyEffects;
  failures.forEachUnique(failure => {
    if (identities.has(failure)) retainedEffects = retainedEffects.append(failure);
    else discarded = discarded.append(failure);
  });
  return {owned: retainedEffects, discarded};
}
