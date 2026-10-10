// Public, read-only publication gate. Never sends a deletion or a receipt.
import assert from "node:assert/strict";
const base = process.env.HIBI_BACKEND_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.HIBI_PUBLIC_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const origin = process.env.HIBI_APP_ORIGIN || "https://usehibi.pages.dev";
if (!base || !key)
  throw new Error("Set HIBI_BACKEND_URL and HIBI_PUBLIC_KEY to the target project's public configuration.");
const endpoint = new URL("functions/v1/delete-account", `${base.replace(/\/$/, "")}/`);
const preflight = await fetch(endpoint, {
  method: "OPTIONS",
  headers: {
    Origin: origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,apikey,content-type",
  },
  signal: AbortSignal.timeout(15000),
});
assert.equal(preflight.status, 204, "Deletion endpoint preflight is unavailable");
assert.equal(preflight.headers.get("access-control-allow-origin"), origin, "Frontend origin is not permitted");
const response = await fetch(endpoint, {
  headers: { apikey: key, Origin: origin },
  signal: AbortSignal.timeout(15000),
});
assert.equal(response.status, 405, "Endpoint or matching database migrations are unavailable");
const body = await response.json();
assert.equal(body.backendVersion, "data-lifecycle-2026-10-09-staged-v1");
assert.equal(body.schemaVersion, body.backendVersion);
console.log(
  JSON.stringify({
    deletionEndpoint: "available",
    backendVersion: body.backendVersion,
    databaseContract: "matches",
    origin,
  }),
);
