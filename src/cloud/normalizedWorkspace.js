export const NORMALIZED_COLLECTIONS = Object.freeze([
  "groups",
  "students",
  "grades",
  "classLog",
  "classSchedules",
  "scheduleExceptions",
  "scheduleChanges",
]);

function sameEntity(left, right) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function collectionPatch(previousItems, nextItems) {
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  const nextIds = new Set(nextItems.map((item) => item.id));
  const upserts = [];

  nextItems.forEach((item, position) => {
    if (!sameEntity(previousById.get(item.id), item)) upserts.push({ data: item, position });
  });

  return {
    upserts,
    deletes: previousItems.filter((item) => !nextIds.has(item.id)).map((item) => item.id),
  };
}

function expectedForChanges(changes, versions, collection) {
  const current = versions?.[collection] || {};
  const expected = {};
  changes.upserts.forEach(({ data }) => {
    expected[data.id] = Number(current[data.id] || 0);
  });
  changes.deletes.forEach((id) => {
    expected[id] = Number(current[id] || 0);
  });
  return expected;
}

export function buildWorkspacePatch(previous, next, versions = {}) {
  const patch = {};
  const expectedVersions = {};

  if (!sameEntity(previous.settings, next.settings)) {
    patch.settings = next.settings;
    expectedVersions.settings = {
      __settings__: Number(versions?.settings?.__settings__ || 0),
    };
  }

  for (const collection of NORMALIZED_COLLECTIONS) {
    const changes = collectionPatch(previous[collection] || [], next[collection] || []);
    if (!changes.upserts.length && !changes.deletes.length) continue;
    patch[collection] = changes;
    expectedVersions[collection] = expectedForChanges(changes, versions, collection);
  }

  return { patch, expectedVersions, empty: Object.keys(patch).length === 0 };
}

export function applyWorkspacePatch(state, patch) {
  let next = state;
  if (patch?.settings) next = { ...next, settings: patch.settings };

  for (const collection of NORMALIZED_COLLECTIONS) {
    const changes = patch?.[collection];
    if (!changes) continue;
    const deletedIds = new Set(changes.deletes || []);
    const upsertsById = new Map((changes.upserts || []).map(({ data }) => [data.id, data]));
    const existingIds = new Set((state[collection] || []).map((item) => item.id));
    const items = (state[collection] || [])
      .filter((item) => !deletedIds.has(item.id))
      .map((item) => upsertsById.get(item.id) || item);
    const additions = (changes.upserts || [])
      .filter(({ data }) => !existingIds.has(data.id))
      .sort((left, right) => left.position - right.position);
    for (const addition of additions) {
      items.splice(Math.min(addition.position, items.length), 0, addition.data);
    }
    next = { ...next, [collection]: items };
  }

  return next;
}

export function advanceWorkspaceVersions(versions, patch) {
  const next = Object.fromEntries(
    Object.entries(versions || {}).map(([key, value]) => [key, { ...value }]),
  );

  if (patch?.settings) {
    next.settings ||= {};
    next.settings.__settings__ = Number(next.settings.__settings__ || 0) + 1;
  }

  for (const collection of NORMALIZED_COLLECTIONS) {
    const changes = patch?.[collection];
    if (!changes) continue;
    next[collection] ||= {};
    changes.upserts.forEach(({ data }) => {
      next[collection][data.id] = Number(next[collection][data.id] || 0) + 1;
    });
    changes.deletes.forEach((id) => {
      delete next[collection][id];
    });
  }

  return next;
}

export function workspacePatchesOverlap(left, right) {
  if (left?.settings && right?.settings) return true;
  for (const collection of NORMALIZED_COLLECTIONS) {
    if (!left?.[collection] || !right?.[collection]) continue;
    const leftIds = new Set([
      ...left[collection].upserts.map(({ data }) => data.id),
      ...left[collection].deletes,
    ]);
    if (right[collection].upserts.some(({ data }) => leftIds.has(data.id))) return true;
    if (right[collection].deletes.some((id) => leftIds.has(id))) return true;
  }
  return false;
}
