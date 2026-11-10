// Research fixture contracts, not a complete native project schema or merge driver.
export function sameJson(a, b) {
  const canonical = value => JSON.stringify(value, (_key, item) => item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0)) : item);
  return canonical(a) === canonical(b);
}

export function actorReferences(data) {
  const refs = [];
  for (const [index, placement] of (data.scene?.placements ?? []).entries()) {
    refs.push({ owner: placement, key: 'actor', path: `/scene/placements/${index}/actor`, placement: placement.id });
  }
  if (data.designExample?.performance) refs.push({ owner: data.designExample.performance, key: 'actor', path: '/designExample/performance/actor' });
  return refs;
}

export function unresolvedActorReferences(data) {
  const known = new Set(data.actorCatalogue ?? []);
  return actorReferences(data).filter(({ owner, key }) => !known.has(owner[key]))
    .map(({ owner, key, path, placement }) => ({ path, ...(placement === undefined ? {} : { placement }), missing: owner[key] }));
}

export function renameActor(data, oldId, newId) {
  if (data.actor.id !== oldId) throw new Error('Research rename source does not match actor definition');
  if (newId !== oldId && data.actorCatalogue.includes(newId)) throw new Error('Research rename destination already exists');
  data.actor.id = newId;
  let count = 0;
  for (const { owner, key } of actorReferences(data)) if (owner[key] === oldId) { owner[key] = newId; count++; }
  data.actorCatalogue = data.actorCatalogue.map(id => { if (id !== oldId) return id; count++; return newId; });
  return count;
}

export function duplicateIdentities(data) {
  const errors = [];
  for (const [path, entries] of [['/scene/placements', data.scene?.placements ?? []], ['/clip/frames', data.clip?.frames ?? []]]) {
    const seen = new Map();
    for (const [index, entry] of entries.entries()) {
      if (seen.has(entry.id)) errors.push({ keyword: 'uniqueIdentity', instancePath: `${path}/${index}/id`, firstPath: `${path}/${seen.get(entry.id)}/id`, id: entry.id });
      else seen.set(entry.id, index);
    }
  }
  return errors;
}

// Full-document allowed outcomes. Only independent appends have two allowed orders.
// Insertion/reversal means reversing the complete inserted sequence, preserving its
// original gap by identity. This is declared experimental intent, not a merge policy.
export function sequenceExpectations(fixture, label) {
  const result = structuredClone(fixture);
  if (label === 'adjacent') { result.scene.placements[0].x++; result.scene.placements[0].y++; }
  else if (label === 'simultaneous-add') {
    const left = { ...structuredClone(result.scene.placements[0]), id: 'authored-left' };
    const right = { ...structuredClone(result.scene.placements[0]), id: 'authored-right' };
    const reverse = structuredClone(result);
    result.scene.placements.push(left, right); reverse.scene.placements.push(right, left);
    return [result, reverse];
  } else if (label === 'reorder-edit') { result.scene.placements[0].x++; result.scene.placements.reverse(); }
  else if (label === 'frame-insert-reorder') {
    result.clip.frames.splice(1, 0, { ...structuredClone(result.clip.frames[0]), id: 'authored-insert' });
    result.clip.frames.reverse();
  } else if (label === 'frame-remove-edit') { result.clip.frames.shift(); result.clip.frames.at(-1).sound = 'authored.wav'; }
  else if (['edit-delete', 'same-id-placement-disjoint', 'same-id-frame-disjoint'].includes(label)) return [];
  else throw new Error('Unknown research sequence case: ' + label);
  return [result];
}

export function allowedSequenceResult(value, allowed) {
  return duplicateIdentities(value).length === 0 && allowed.some(expected => sameJson(value, expected));
}
