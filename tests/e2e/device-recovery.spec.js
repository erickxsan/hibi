import { expect, test } from "@playwright/test";

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
