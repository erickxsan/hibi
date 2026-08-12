import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const DELETE_CONFIRMATION = "DELETE MY ACCOUNT";
const RECENT_AUTH_SECONDS = 10 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReceiptRow = {
  request_id: string;
  owner_id: string | null;
  status: "pending" | "data_erased" | "completed";
  requested_at: string;
  data_erased_at: string | null;
  completed_at: string | null;
};

function firstEnvironmentKey(...names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (!value) continue;
    try {
      const keys = Object.values(JSON.parse(value)).filter((key): key is string => typeof key === "string");
      if (keys[0]) return keys[0];
    } catch {
      return value;
    }
  }
  throw new Error(`missing_${names[0].toLowerCase()}`);
}

const supabaseUrl = firstEnvironmentKey("SUPABASE_URL");
const publishableKey = firstEnvironmentKey(
  "SUPABASE_PUBLISHABLE_KEYS",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
);
const secretKey = firstEnvironmentKey("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");

const configuredOrigins = (Deno.env.get("HIBI_ALLOWED_ORIGINS") ?? "https://usehibi.pages.dev")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (/^https?:\/\/(127\.0\.0\.1|localhost|kong)(:|\/)/.test(supabaseUrl)) {
  configuredOrigins.push("http://127.0.0.1:3000", "http://127.0.0.1:4173", "http://127.0.0.1:5173");
}

const allowedOrigins = new Set(configuredOrigins);

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : configuredOrigins[0];
  return {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
  };
}

function json(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid_access_token");
  const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(atob(padded));
}

function latestAuthenticationTime(payload: Record<string, unknown>) {
  const candidates: number[] = [];
  if (typeof payload.auth_time === "number") candidates.push(payload.auth_time);
  if (Array.isArray(payload.amr)) {
    for (const method of payload.amr) {
      const timestamp =
        method && typeof method === "object" && "timestamp" in method
          ? (method as { timestamp?: unknown }).timestamp
          : null;
      if (typeof timestamp === "number") {
        candidates.push(timestamp);
      }
    }
  }
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function isNotFound(error: { status?: number; code?: string; message?: string } | null) {
  if (!error) return false;
  return error.status === 404 || error.code === "user_not_found" || /not found/i.test(error.message ?? "");
}

function safeErrorCode(phase: "data" | "auth" | "complete") {
  return `${phase}_deletion_failed`;
}

const serviceClient = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function purgeOwnedStorageObjects(ownerId: string) {
  while (true) {
    const { data, error } = await serviceClient.rpc("list_account_storage_objects", {
      p_owner_id: ownerId,
      p_limit: 1000,
    });
    if (error) throw error;
    const objects = (data ?? []) as Array<{ bucket_id: string; object_name: string }>;
    if (objects.length === 0) return;

    const pathsByBucket = new Map<string, string[]>();
    for (const object of objects) {
      const paths = pathsByBucket.get(object.bucket_id) ?? [];
      paths.push(object.object_name);
      pathsByBucket.set(object.bucket_id, paths);
    }
    await Promise.all(
      [...pathsByBucket].map(async ([bucketId, paths]) => {
        const { error: removeError } = await serviceClient.storage.from(bucketId).remove(paths);
        if (removeError) throw removeError;
      }),
    );
  }
}

async function recordFailure(requestId: string, ownerId: string, code: string) {
  await serviceClient.rpc("record_account_deletion_failure", {
    p_request_id: requestId,
    p_owner_id: ownerId,
    p_error_code: code,
  });
}

async function completeDeletion(requestId: string, ownerId: string) {
  const { data, error } = await serviceClient.rpc("complete_account_deletion", {
    p_request_id: requestId,
    p_owner_id: ownerId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function hardDeleteAuthUser(ownerId: string) {
  const { error } = await serviceClient.auth.admin.deleteUser(ownerId, false);
  if (error && !isNotFound(error)) throw error;
}

async function handleVerification(origin: string | null, requestId: string, receiptSecret: string) {
  const { data, error } = await serviceClient.rpc("get_account_deletion_receipt", {
    p_request_id: requestId,
    p_receipt_secret: receiptSecret,
  });
  if (error) return json(origin, 500, { code: "receipt_verification_failed" });

  const receipt = (Array.isArray(data) ? data[0] : data) as ReceiptRow | undefined;
  if (!receipt) return json(origin, 404, { code: "deletion_receipt_not_found" });

  if (receipt.status === "completed") {
    return json(origin, 200, {
      status: "completed",
      requestId: receipt.request_id,
      completedAt: receipt.completed_at,
      verified: true,
    });
  }

  if (receipt.status === "data_erased" && receipt.owner_id) {
    try {
      await purgeOwnedStorageObjects(receipt.owner_id);
      await hardDeleteAuthUser(receipt.owner_id);
      const completed = await completeDeletion(receipt.request_id, receipt.owner_id);
      return json(origin, 200, {
        status: "completed",
        requestId: receipt.request_id,
        completedAt: completed?.completed_at ?? new Date().toISOString(),
        verified: true,
      });
    } catch {
      await recordFailure(receipt.request_id, receipt.owner_id, safeErrorCode("auth"));
      return json(origin, 503, {
        code: "account_deletion_incomplete",
        status: "data_erased",
        retryable: true,
      });
    }
  }

  return json(origin, 202, {
    status: "pending",
    requestId: receipt.request_id,
    verified: false,
    retryable: true,
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    if (origin && !allowedOrigins.has(origin)) return json(origin, 403, { code: "origin_not_allowed" });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") return json(origin, 405, { code: "method_not_allowed" });
  if (origin && !allowedOrigins.has(origin)) return json(origin, 403, { code: "origin_not_allowed" });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(origin, 400, { code: "invalid_json" });
  }

  const action = body.action;
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const receiptSecret = typeof body.receiptSecret === "string" ? body.receiptSecret : "";
  if (!UUID_PATTERN.test(requestId) || !UUID_PATTERN.test(receiptSecret)) {
    return json(origin, 400, { code: "invalid_deletion_receipt" });
  }

  if (action === "verify") return handleVerification(origin, requestId, receiptSecret);
  if (action !== "delete") return json(origin, 400, { code: "invalid_action" });

  const authorization = request.headers.get("Authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  if (!accessToken || accessToken === authorization) {
    return json(origin, 401, { code: "authentication_required" });
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) return json(origin, 401, { code: "authentication_required" });

  let payload: Record<string, unknown>;
  try {
    payload = decodeJwtPayload(accessToken);
  } catch {
    return json(origin, 401, { code: "invalid_access_token" });
  }
  const authenticatedAt = latestAuthenticationTime(payload);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authenticatedAt || authenticatedAt > nowSeconds + 60 || nowSeconds - authenticatedAt > RECENT_AUTH_SECONDS) {
    return json(origin, 401, {
      code: "recent_authentication_required",
      message: "Sign out and sign in again before deleting the account.",
    });
  }

  if (body.confirmation !== DELETE_CONFIRMATION) {
    return json(origin, 400, { code: "account_deletion_not_confirmed" });
  }

  const ownerId = userData.user.id;
  const { data: begunData, error: beginError } = await userClient.rpc("begin_account_deletion", {
    p_request_id: requestId,
    p_expected_owner_id: ownerId,
    p_confirmation: DELETE_CONFIRMATION,
    p_receipt_secret: receiptSecret,
  });
  if (beginError) return json(origin, 409, { code: "account_deletion_could_not_start" });
  const begun = Array.isArray(begunData) ? begunData[0] : begunData;
  const effectiveRequestId = begun?.request_id ?? requestId;

  try {
    await purgeOwnedStorageObjects(ownerId);
  } catch {
    await recordFailure(effectiveRequestId, ownerId, "storage_deletion_failed");
    return json(origin, 503, {
      code: "account_storage_deletion_failed",
      status: "pending",
      retryable: true,
    });
  }

  const { error: eraseError } = await serviceClient.rpc("erase_account_data", {
    p_request_id: effectiveRequestId,
    p_owner_id: ownerId,
  });
  if (eraseError) {
    await recordFailure(effectiveRequestId, ownerId, safeErrorCode("data"));
    return json(origin, 503, {
      code: "account_data_deletion_failed",
      status: "pending",
      retryable: true,
    });
  }

  try {
    await hardDeleteAuthUser(ownerId);
  } catch {
    await recordFailure(effectiveRequestId, ownerId, safeErrorCode("auth"));
    return json(origin, 503, {
      code: "account_auth_deletion_failed",
      status: "data_erased",
      retryable: true,
    });
  }

  try {
    const completed = await completeDeletion(effectiveRequestId, ownerId);
    return json(origin, 200, {
      status: "completed",
      requestId: effectiveRequestId,
      receiptSecret,
      completedAt: completed?.completed_at ?? new Date().toISOString(),
      verified: true,
    });
  } catch {
    return json(origin, 503, {
      code: safeErrorCode("complete"),
      status: "data_erased",
      retryable: true,
    });
  }
});
