// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { DEPLOY_CHECK_INTERVAL_MS, entryScriptOf, isNewDeployAvailable, watchForNewDeploy } from "./deployedVersion.js";

// What `vite build` publishes: the theme script, then the hashed entry module.
const builtIndex = (hash) => `<!doctype html><html lang="es"><head>
  <script src="/theme-boot.js"></script>
  <script type="module" crossorigin src="/assets/index-${hash}.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/supabase-x1.js">
  </head><body><div id="root"></div></body></html>`;

function htmlResponse(html, { ok = true, type = "text/html; charset=utf-8" } = {}) {
  return { ok, headers: new Headers({ "content-type": type }), text: async () => html };
}

/** A tab that loaded `hash`, with a document whose visibility the test controls. */
function fakeWindow(hash = "aaa111", fetchImpl = vi.fn(async () => htmlResponse(builtIndex(hash)))) {
  const loaded = new DOMParser().parseFromString(builtIndex(hash), "text/html");
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    querySelector: (selector) => loaded.querySelector(selector),
  });
  return {
    document,
    fetch: fetchImpl,
    DOMParser,
    location: { href: "https://hibi.example/classes?tab=week" },
    navigator: { onLine: true },
  };
}

const showTab = async (win, state = "visible") => {
  win.document.visibilityState = state;
  win.document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => Promise.resolve());
};

describe("deployed version check", () => {
  it("reads the entry module of a built index.html", () => {
    expect(entryScriptOf(new DOMParser().parseFromString(builtIndex("abc123"), "text/html"))).toBe(
      "/assets/index-abc123.js",
    );
    expect(entryScriptOf(new DOMParser().parseFromString("<p>Offline</p>", "text/html"))).toBe("");
  });

  it("asks the server, past every cache, for the published page", async () => {
    const win = fakeWindow(
      "aaa111",
      vi.fn(async () => htmlResponse(builtIndex("bbb222"))),
    );
    expect(await isNewDeployAvailable("/assets/index-aaa111.js", win)).toBe(true);
    const [url, init] = win.fetch.mock.calls[0];
    expect(new URL(url).origin + new URL(url).pathname).toBe("https://hibi.example/");
    expect(new URL(url).searchParams.get("hibi-version-check")).toBeTruthy();
    expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });

  it("says nothing when the build is the same or the page cannot be read", async () => {
    const current = "/assets/index-aaa111.js";
    const cases = [
      async () => htmlResponse(builtIndex("aaa111")),
      async () => htmlResponse(builtIndex("bbb222"), { ok: false }),
      async () => htmlResponse(builtIndex("bbb222"), { type: "application/json" }),
      async () => htmlResponse("<html><body>Captive portal</body></html>"),
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ];
    for (const fetchImpl of cases) {
      expect(await isNewDeployAvailable(current, fakeWindow("aaa111", vi.fn(fetchImpl)))).toBe(false);
    }
    const offline = fakeWindow("aaa111", vi.fn());
    offline.navigator.onLine = false;
    expect(await isNewDeployAvailable(current, offline)).toBe(false);
    expect(offline.fetch).not.toHaveBeenCalled();
    expect(await isNewDeployAvailable("", fakeWindow())).toBe(false);
  });

  it("checks when the tab is shown again, at most every few minutes, and reports a new build once", async () => {
    let published = "aaa111";
    const win = fakeWindow(
      "aaa111",
      vi.fn(async () => htmlResponse(builtIndex(published))),
    );
    const onNewDeploy = vi.fn();
    const stop = watchForNewDeploy(onNewDeploy, { win });

    await showTab(win);
    expect(win.fetch).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + DEPLOY_CHECK_INTERVAL_MS);
    await showTab(win, "hidden");
    expect(win.fetch).not.toHaveBeenCalled();
    await showTab(win);
    await vi.waitFor(() => expect(win.fetch).toHaveBeenCalledTimes(1));
    expect(onNewDeploy).not.toHaveBeenCalled();

    published = "bbb222";
    await showTab(win);
    expect(win.fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + DEPLOY_CHECK_INTERVAL_MS);
    await showTab(win);
    await vi.waitFor(() => expect(onNewDeploy).toHaveBeenCalledOnce());

    vi.setSystemTime(Date.now() + DEPLOY_CHECK_INTERVAL_MS);
    await showTab(win);
    expect(win.fetch).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does nothing on a page without a built entry module (development)", async () => {
    const win = fakeWindow();
    win.document.querySelector = () => null;
    const stop = watchForNewDeploy(vi.fn(), { win, minIntervalMs: 0 });
    await showTab(win);
    expect(win.fetch).not.toHaveBeenCalled();
    stop();
  });
});
