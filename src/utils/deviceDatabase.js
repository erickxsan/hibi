// A closed connection is never reusable, including when it closes while Web Crypto
// is preparing a write. Retry only failures to START a transaction; committed writes
// and unrelated storage/crypto errors must not be replayed.
export function createDeviceDatabase(
  indexedDb,
  { name, version, upgrade, unavailableMessage, blockedMessage, onInvalidate = () => {} },
) {
  let current = null;
  const connectionErrors = new WeakSet();

  function invalidate(attempt) {
    if (attempt.invalidated) return;
    attempt.invalidated = true;
    if (current === attempt) {
      current = null;
      onInvalidate();
    }
  }

  function open() {
    if (!indexedDb?.open) return Promise.resolve(null);
    if (current) return current.promise;
    const attempt = { promise: null, invalidated: false };
    current = attempt;
    attempt.promise = new Promise((resolve, reject) => {
      const fail = (error) => {
        invalidate(attempt);
        reject(error);
      };
      let request;
      try {
        request = indexedDb.open(name, version);
      } catch (error) {
        fail(error);
        return;
      }
      request.onupgradeneeded = () => upgrade(request.result);
      request.onsuccess = () => {
        const database = request.result;
        // A blocked request can succeed after its promise has already rejected.
        // Close that orphan so it cannot block a future upgrade or deletion.
        if (attempt.invalidated) {
          database.close();
          return;
        }
        database.onclose = () => invalidate(attempt);
        database.onversionchange = () => {
          invalidate(attempt);
          database.close();
        };
        resolve({
          transaction(...args) {
            try {
              return database.transaction(...args);
            } catch (error) {
              if (error?.name === "InvalidStateError") {
                connectionErrors.add(error);
                invalidate(attempt);
              }
              throw error;
            }
          },
        });
      };
      request.onerror = () => fail(request.error || new Error(unavailableMessage));
      request.onblocked = () => fail(new Error(blockedMessage));
    });
    return attempt.promise;
  }

  function isConnectionError(error) {
    return connectionErrors.has(error);
  }

  /**
   * @template {unknown[]} Args
   * @template Result
   * @param {(...args: Args) => Promise<Result>} operation
   * @returns {(...args: Args) => Promise<Result>}
   */
  function retry(operation) {
    return async (...args) => {
      try {
        return await operation(...args);
      } catch (error) {
        if (!isConnectionError(error)) throw error;
        return operation(...args);
      }
    };
  }

  return { open, retry, isConnectionError };
}
