import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const requestId = "11111111-1111-4111-8111-111111111111";
const effectiveId = "22222222-2222-4222-8222-222222222222";
const secret = "33333333-3333-4333-8333-333333333333";
const source = ts.transpileModule(
  readFileSync(new URL("../../supabase/functions/delete-account/index.ts", import.meta.url), "utf8").replace(
    /^import .*\n/,
    "",
  ),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;

function endpoint({ status = "pending", failure = "", contract = true } = {}) {
  const calls = [];
  const service = {
    rpc: vi.fn(async (name) => {
      calls.push(name);
      if (name === failure) return { error: new Error("Synthetic outage") };
      if (name === "get_hibi_backend_contract")
        return { data: contract ? "data-lifecycle-2026-10-09-staged-v1" : null };
      if (name === "get_account_deletion_receipt")
        return { data: [{ request_id: effectiveId, owner_id: status === "completed" ? null : "owner", status }] };
      if (name === "list_account_storage_objects") return { data: [] };
      if (name === "complete_account_deletion") return { data: [{ completed_at: "2026-10-08T00:00:00Z" }] };
      return { data: null };
    }),
    auth: {
      admin: {
        deleteUser: vi.fn(async () => {
          calls.push("deleteAuth");
          return failure === "deleteAuth" ? { error: { status: 503 } } : {};
        }),
      },
    },
  };
  let handler;
  runInNewContext(source, {
    createClient: () => service,
    Deno: {
      env: {
        get: (name) =>
          name === "SUPABASE_URL"
            ? "https://synthetic.example.test"
            : name.startsWith("SUPABASE_")
              ? "synthetic-key"
              : undefined,
      },
      serve: (value) => {
        handler = value;
      },
    },
    Response,
    Date,
    atob,
  });
  const invoke = (method = "POST", body = { action: "verify", requestId, receiptSecret: secret }) =>
    handler(
      new Request("https://synthetic.example.test/functions/v1/delete-account", {
        method,
        headers: { Origin: "https://usehibi.pages.dev", "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }),
    );
  return { service, calls, invoke };
}

describe("deletion Edge Function interruptions", () => {
  it.each(["pending", "data_erased", "completed"])(
    "reconciles %s without requiring an Auth session",
    async (status) => {
      const api = endpoint({ status });
      const result = await api.invoke();
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ status: "completed", requestId: effectiveId, verified: true });
      if (status === "pending")
        expect(api.calls).toEqual([
          "get_account_deletion_receipt",
          "list_account_storage_objects",
          "erase_account_data",
          "deleteAuth",
          "complete_account_deletion",
        ]);
      if (status === "data_erased") expect(api.calls).not.toContain("erase_account_data");
      if (status === "completed") expect(api.calls).toEqual(["get_account_deletion_receipt"]);
    },
  );
  it.each(["list_account_storage_objects", "erase_account_data", "deleteAuth", "complete_account_deletion"])(
    "retains the effective request ID after %s fails",
    async (failure) => {
      const api = endpoint({ failure });
      const result = await api.invoke();
      expect(result.status).toBe(503);
      expect(await result.json()).toMatchObject({ requestId: effectiveId, retryable: true });
      if (["list_account_storage_objects", "erase_account_data"].includes(failure))
        expect(api.calls).not.toContain("deleteAuth");
    },
  );
  it("rejects a new deletion without a bearer token", async () => {
    const api = endpoint();
    const result = await api.invoke("POST", {
      action: "delete",
      requestId,
      receiptSecret: secret,
      confirmation: "DELETE MY ACCOUNT",
    });
    expect(result.status).toBe(401);
    expect(api.calls).toEqual([]);
  });
  it("checks the database contract through GET and permits the exact frontend preflight", async () => {
    const api = endpoint();
    expect((await api.invoke("OPTIONS")).status).toBe(204);
    expect((await api.invoke("GET")).status).toBe(405);
    expect((await endpoint({ contract: false }).invoke("GET")).status).toBe(503);
  });
});
