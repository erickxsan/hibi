const CHANNEL_NAME = "hibi:e2ee:migration:v1";
const LEASE_PREFIX = "hibi:e2ee:migration:v1:";
const LEASE_TTL_MS = 2 * 60 * 1000;
const activeOwners = new Set();

export class WorkspaceMigrationInProgressError extends Error {
  constructor() {
    super("Another Hibi tab is already securing this workspace. Keep that tab open and try again when it finishes.");
    this.name = "WorkspaceMigrationInProgressError";
    this.code = "migration_in_progress";
  }
}

function parseLease(storage, key, now) {
  try {
    const value = JSON.parse(storage?.getItem?.(key) || "null");
    return value?.token && Number(value.expiresAt) > now ? value : null;
  } catch {
    return null;
  }
}

async function withStorageLease(ownerId, task, { storage, now, token, channel }) {
  const key = `${LEASE_PREFIX}${ownerId}`;
  const timestamp = now();
  if (activeOwners.has(ownerId) || parseLease(storage, key, timestamp)) throw new WorkspaceMigrationInProgressError();
  activeOwners.add(ownerId);
  try {
    storage?.setItem?.(key, JSON.stringify({ token, expiresAt: timestamp + LEASE_TTL_MS }));
    if (parseLease(storage, key, now())?.token !== token) throw new WorkspaceMigrationInProgressError();
    channel?.postMessage?.({ type: "started", ownerId, token, at: timestamp });
    return await task();
  } finally {
    activeOwners.delete(ownerId);
    try {
      if (parseLease(storage, key, now())?.token === token) storage?.removeItem?.(key);
    } catch {
      // Private browsing can deny storage access; the in-process guard still applies.
    }
    channel?.postMessage?.({ type: "finished", ownerId, token, at: now() });
  }
}

export async function runExclusiveWorkspaceMigration(
  ownerId,
  task,
  {
    navigatorApi = globalThis.navigator,
    BroadcastChannelApi = globalThis.BroadcastChannel,
    storage = globalThis.localStorage,
    now = Date.now,
    randomUUID = () => globalThis.crypto?.randomUUID?.() || `${now()}-${Math.random()}`,
  } = {},
) {
  const token = randomUUID();
  let channel = null;
  try {
    channel = BroadcastChannelApi ? new BroadcastChannelApi(CHANNEL_NAME) : null;
  } catch {
    channel = null;
  }
  try {
    const execute = () => withStorageLease(ownerId, task, { storage, now, token, channel });
    if (!navigatorApi?.locks?.request) return await execute();
    let acquired = false;
    const result = await navigatorApi.locks.request(
      `${CHANNEL_NAME}:${ownerId}`,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) return undefined;
        acquired = true;
        return execute();
      },
    );
    if (!acquired) throw new WorkspaceMigrationInProgressError();
    return result;
  } finally {
    channel?.close?.();
  }
}
