// Ownership follows bindings, so failed alternatives and iteration frontiers
// remain distinguishable from diagnostics in the retained CST.
const ownership = new WeakMap();
const membership = new WeakMap();
const empty = [];

export function recoveriesOf(node) {
  return ownership.get(node) || empty;
}

export function inheritRecoveries(node, children) {
  let failures;
  for (const child of children) {
    const owned = ownership.get(child);
    if (owned) failures = failures ? failures.concat(owned) : owned;
  }
  if (failures) ownership.set(node, failures);
}

export function correctionOwns(node, recovered, nested = empty) {
  ownership.set(node, [recovered, ...nested]);
}

export function partitionRecoveries(failures, retained) {
  const retainedEffects = recoveriesOf(retained);
  if (!retainedEffects.length) return {owned: empty, discarded: failures};
  let identities = membership.get(retainedEffects);
  if (!identities) {
    identities = new Set(retainedEffects);
    membership.set(retainedEffects, identities);
  }
  const owned = [];
  const discarded = [];
  for (const failure of failures) {
    (identities.has(failure) ? owned : discarded).push(failure);
  }
  return {owned, discarded};
}
