import { expect, test } from "@playwright/test";

for (const phase of ["idle", "encryption"]) {
  test(`saves attendance after a connection closes during ${phase} and preserves it across reloads`, async ({
    page,
  }) => {
    await page.goto("/tests/e2e/fixtures/device-recovery.html");
    const opens = await page.evaluate(async (phase) => {
      const recoveryModule = "/src/cloud/deviceRecoveryStore.js";
      const domainModule = "/src/domain/index.js";
      const { createDeviceRecoveryStore } = await import(recoveryModule);
      const { createStarterState, createStudent, createClassLogRow } = await import(domainModule);
      const nativeCrypto = globalThis.crypto;
      /** @type {IDBDatabase} */
      let database;
      let opens = 0;
      let armed = false;
      const indexedDb = {
        open(name, version) {
          opens++;
          const request = globalThis.indexedDB.open(name, version);
          request.addEventListener("success", () => (database = request.result));
          return request;
        },
      };
      const store = createDeviceRecoveryStore(indexedDb, {
        getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
        subtle: {
          generateKey: nativeCrypto.subtle.generateKey.bind(nativeCrypto.subtle),
          decrypt: nativeCrypto.subtle.decrypt.bind(nativeCrypto.subtle),
          encrypt(algorithm, key, data) {
            if (armed && phase === "encryption") {
              armed = false;
              database.close();
            }
            return nativeCrypto.subtle.encrypt(algorithm, key, data);
          },
        },
      });
      const state = createStarterState();
      state.students = [
        createStudent({ id: "ana", code: "A", fullName: "Ana Prueba", isIndividual: true }),
        createStudent({ id: "luis", code: "L", fullName: "Luis Prueba", isIndividual: true }),
      ];
      state.classLog = [
        createClassLogRow({ id: "previous", studentId: "ana", classDate: "2026-11-06", hours: 1, attendance: "P" }),
      ];
      await store.stageMutation({ ownerId: "owner", workspace: { state }, mutation: { operationId: "before" } });
      if (!database) throw new Error("The first save did not open its database.");
      armed = true;
      if (phase === "idle") database.close();
      const after = {
        ...state,
        classLog: [
          ...state.classLog,
          createClassLogRow({ id: "present", studentId: "ana", classDate: "2026-11-07", hours: 1, attendance: "P" }),
          createClassLogRow({ id: "absent", studentId: "luis", classDate: "2026-11-07", hours: 1, attendance: "A" }),
        ],
      };
      await store.stageMutation({
        ownerId: "owner",
        workspace: { state: after },
        mutation: { operationId: "attendance" },
      });
      return opens;
    }, phase);
    expect(opens).toBe(2);
    await page.reload();
    const restored = await page.evaluate(async () => {
      const recoveryModule = "/src/cloud/deviceRecoveryStore.js";
      const { createDeviceRecoveryStore } = await import(recoveryModule);
      const store = createDeviceRecoveryStore();
      const mutations = await store.listMutations("owner");
      const cached = await store.loadWorkspaceCache("owner");
      const [backup] = await store.list("owner");
      const copy = await store.load("owner", backup.id);
      return {
        operations: mutations.map((item) => item.id),
        previousAttendance: mutations[0].workspace.state.classLog.map((row) => row.id),
        cachedAttendance: cached.state.classLog.map((row) => [row.id, row.attendance]),
        backupAttendance: copy.state.classLog.map((row) => [row.id, row.attendance]),
      };
    });
    expect(restored.operations).toEqual(["before", "attendance"]);
    expect(restored.previousAttendance).toEqual(["previous"]);
    const expected = [
      ["previous", "P"],
      ["present", "P"],
      ["absent", "A"],
    ];
    expect(restored.cachedAttendance).toEqual(expected);
    expect(restored.backupAttendance).toEqual(expected);
  });
}

for (const firstWrite of ["capture", "stageMutation"]) {
  test(`preserves concurrent ${firstWrite} writes across tabs and reloads`, async ({ context }) => {
    let arrivals = 0;
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    await context.exposeBinding("recoveryKeyBarrier", async () => {
      if (++arrivals === 2) release();
      await barrier;
    });
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all(pages.map((page) => page.goto("/tests/e2e/fixtures/device-recovery.html")));
    const results = await Promise.all(
      pages.map((page, index) =>
        page.evaluate(
          async ({ index, firstWrite }) => {
            const recoveryModule = "/src/cloud/deviceRecoveryStore.js";
            const domainModule = "/src/domain/index.js";
            const { createDeviceRecoveryStore } = await import(recoveryModule);
            const { createStarterState } = await import(domainModule);
            const nativeCrypto = globalThis.crypto;
            const store = createDeviceRecoveryStore(globalThis.indexedDB, {
              getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
              subtle: {
                encrypt: nativeCrypto.subtle.encrypt.bind(nativeCrypto.subtle),
                decrypt: nativeCrypto.subtle.decrypt.bind(nativeCrypto.subtle),
                async generateKey(algorithm, extractable, usages) {
                  const candidate = await nativeCrypto.subtle.generateKey(algorithm, extractable, usages);
                  // Neither tab may write its candidate until both saw a missing key.
                  await globalThis.recoveryKeyBarrier();
                  return candidate;
                },
              },
            });
            const state = createStarterState();
            state.settings.hourlyRate = 111 + index;
            if (firstWrite === "capture") {
              return store.capture({ ownerId: "owner", state, revision: index + 1 });
            }
            return store.stageMutation({
              ownerId: "owner",
              workspace: { state, revision: index + 1 },
              mutation: { operationId: `operation-${index}` },
            });
          },
          { index, firstWrite },
        ),
      ),
    );
    expect(arrivals).toBe(2);
    expect(results).toHaveLength(2);
    await Promise.all(pages.map((page) => page.reload()));
    for (const page of pages) {
      const restored = await page.evaluate(async () => {
        const recoveryModule = "/src/cloud/deviceRecoveryStore.js";
        const { createDeviceRecoveryStore } = await import(recoveryModule);
        const store = createDeviceRecoveryStore();
        const copies = await store.list("owner");
        const loaded = await Promise.all(copies.map((copy) => store.load("owner", copy.id)));
        const mutations = await store.listMutations("owner");
        const cached = await store.loadWorkspaceCache("owner");
        return {
          rates: loaded.map((copy) => copy.state.settings.hourlyRate).sort(),
          mutations: mutations.map((item) => ({ id: item.id, rate: item.workspace.state.settings.hourlyRate })),
          cachedRate: cached?.state.settings.hourlyRate,
        };
      });
      if (firstWrite === "capture") {
        expect(restored.rates).toEqual([111, 112]);
      } else {
        expect(restored.mutations).toEqual(
          expect.arrayContaining([
            { id: "operation-0", rate: 111 },
            { id: "operation-1", rate: 112 },
          ]),
        );
        expect(restored.mutations).toHaveLength(2);
        const lastRate = restored.mutations[1].rate;
        expect(restored.cachedRate).toBe(lastRate);
        expect(restored.rates).toEqual([lastRate]);
      }
    }
  });
}
