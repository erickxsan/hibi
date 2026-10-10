// Local synthetic verification only. No Supabase CLI or remote database accepted.
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const container = process.env.HIBI_SQL_TEST_CONTAINER || "supabase_db_hibi-data-remediation-20261007";
if (!["supabase_db_hibi-data-remediation-20261007", "supabase_db_class-manager-data-safety"].includes(container))
  throw new Error("Only the named local synthetic test containers are allowed.");
const args = [
  "exec",
  "-i",
  container,
  "psql",
  "-X",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-At",
  "-v",
  "ON_ERROR_STOP=1",
];
const sql = (input) =>
  execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
if (process.argv.includes("--reset-app")) {
  if (container !== "supabase_db_hibi-data-remediation-20261007")
    throw new Error("Reset is restricted to the isolated audit container.");
  sql(`drop schema if exists private cascade; drop schema public cascade;
    create schema public authorization postgres; grant usage on schema public to anon, authenticated, service_role;
    delete from auth.users; drop schema if exists supabase_migrations cascade;`);
  execFileSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-X",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "create extension if not exists pg_cron; grant usage on schema cron to postgres; grant all on all tables in schema cron to postgres;",
    ],
    { stdio: "pipe" },
  );
}
if (process.argv.includes("--refresh-functions")) {
  for (const name of ["202610070001_data_lifecycle_remediation.sql", "202610070002_preserve_snapshot_clocks.sql"]) {
    const migration = readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    for (const definition of migration.match(/create or replace function[\s\S]*?\$\$;/g) || []) sql(definition);
  }
  sql(
    "revoke all on function public.get_hibi_backend_contract() from public, anon, authenticated; grant execute on function public.get_hibi_backend_contract() to service_role;",
  );
}
if (process.argv.includes("--bootstrap-storage")) {
  // Clone only Storage's schema from the existing local stack, never its rows.
  const schema = execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_class-manager-data-safety",
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--schema-only",
      "--schema=storage",
      "--no-owner",
      "--no-privileges",
    ],
    { encoding: "utf8" },
  )
    .replace("CREATE SCHEMA storage;", "CREATE SCHEMA IF NOT EXISTS storage;")
    .replace(/CREATE POLICY hibi_block_pending_account_storage[\s\S]*?;/g, "");
  sql(schema);
}
if (process.argv.includes("--migrate")) {
  sql(
    "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key,name text); alter table supabase_migrations.schema_migrations add column if not exists name text;",
  );
  for (const filename of readdirSync(new URL("../supabase/migrations", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const version = filename.split("_")[0];
    if (
      process.argv.includes("--production-baseline") &&
      [
        "202609070001",
        "202609070002",
        "202610020001",
        "202610070001",
        "202610070002",
        "202610090001",
        "202610090002",
      ].includes(version)
    )
      continue;
    if (sql(`select count(*) from supabase_migrations.schema_migrations where version='${version}'`) === "1") continue;
    sql(
      `begin; ${readFileSync(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8")}\ninsert into supabase_migrations.schema_migrations(version,name) values('${version}','${filename.slice(version.length + 1, -4)}'); commit;`,
    );
    console.log(`Applied ${filename}`);
  }
}

if (process.argv.includes("--apply-reviewed-bundle"))
  throw new Error("The combined package is retired. Select --apply-phase-one or --apply-phase-two.");
for (const [flag, filename] of [
  ["--apply-phase-one", "produccion-fase-1-correcciones-2026-10-09.sql"],
  ["--apply-phase-two", "produccion-fase-2-retencion-2026-10-09.sql"],
]) {
  if (!process.argv.includes(flag)) continue;
  if (container !== "supabase_db_hibi-data-remediation-20261007")
    throw new Error("The bundle can only be tested in the isolated audit container.");
  sql(readFileSync(new URL(`../../outputs/auditoria-datos-2026-10-07/${filename}`, import.meta.url), "utf8"));
  console.log(`Reviewed ${flag} applied to the isolated local baseline; no remote execution.`);
}

if (process.argv.includes("--pgtap")) {
  for (const filename of readdirSync(new URL("../supabase/tests", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const output = sql(readFileSync(new URL(`../supabase/tests/${filename}`, import.meta.url), "utf8"));
    console.log(`${filename}\n${output}`);
    assert.doesNotMatch(output, /not ok|Looks like you (failed|planned)/);
  }
}

if (process.argv.includes("--lint")) {
  const diagnostics =
    sql(`select function.oid::regprocedure::text || ' | ' || diagnostic.level || ' | ' || diagnostic.message
    from pg_proc as function
    join pg_namespace as namespace on namespace.oid=function.pronamespace
    join pg_language as language on language.oid=function.prolang
    left join pg_trigger as trigger on trigger.tgfoid=function.oid and not trigger.tgisinternal
    cross join lateral extensions.plpgsql_check_function_tb(function.oid::regprocedure, coalesce(trigger.tgrelid,0)::regclass) as diagnostic
    where namespace.nspname in ('public','private') and language.lanname='plpgsql'
      and (function.prorettype <> 'trigger'::regtype or function.proname in (
        'set_encrypted_snapshot_expiry','preserve_rotated_snapshot_clock','preserve_migrated_snapshot_clock'))
      and diagnostic.level in ('warning','error');`);
  assert.equal(diagnostics, "", diagnostics);
  console.log("SQL lint: no warnings or errors in public/private PL/pgSQL routines and the new installed triggers");
}

if (!process.argv.includes("--concurrency")) process.exit(0);
const owner = randomUUID();
const keyA = randomUUID(),
  keyB = randomUUID();
const auth = `set local role authenticated; set local request.jwt.claim.sub='${owner}'; set local request.jwt.claim.role='authenticated';`;
const wrapper = (id) =>
  JSON.stringify({
    wrapperId: id,
    type: "password",
    wrapperVersion: 1,
    keyVersion: 1,
    nonce: "N".repeat(16),
    wrappedKey: "W".repeat(64),
    kdfAlgorithm: "pbkdf2-sha256",
    kdfIterations: 600000,
    kdfSalt: "S".repeat(43),
  });

async function holdTransaction(statement, competing) {
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  let output = "",
    error = "",
    signal;
  const ready = new Promise((resolve, reject) => {
    signal = resolve;
    child.once("error", reject);
    child.once("close", (code) => {
      if (!output.includes("LOCK_HELD")) reject(new Error(`Transaction failed (${code}): ${error}`));
    });
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("LOCK_HELD")) signal();
  });
  child.stderr.on("data", (chunk) => {
    error += chunk;
  });
  const completed = new Promise((resolve, reject) =>
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(error)))),
  );
  completed.catch(() => {});
  child.stdin.end(`begin; ${auth} ${statement}; select 'LOCK_HELD'; select pg_sleep(2); commit;`);
  await ready;
  const result = await competing();
  await completed;
  return result;
}

try {
  sql(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data)
    values('${owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${owner}@example.test','x','{}','{}');
    insert into public.workspace_encryption_profiles(owner_id,workspace_crypto_id,protocol_version,schema_version,migration_status)
    values('${owner}','${owner}',1,2,'active');
    insert into public.workspace_key_wrappers(owner_id,wrapper_id,wrapper_type,recovery_fingerprint,wrapper_version,key_version,nonce,wrapped_key)
    values('${owner}','${keyA}','recovery',repeat('F',43),1,1,repeat('N',16),repeat('W',64)),
    ('${owner}','${keyB}','recovery',repeat('G',43),1,1,repeat('N',16),repeat('W',64));`);
  await holdTransaction(`select public.revoke_workspace_key_wrapper('${owner}','${keyA}')`, async () => {
    assert.throws(
      () => sql(`begin; ${auth} select public.revoke_workspace_key_wrapper('${owner}','${keyB}'); commit;`),
      /cannot_revoke_last_workspace_key/,
    );
  });
  assert.equal(
    sql(`select count(*) from public.workspace_key_wrappers where owner_id='${owner}' and revoked_at is null`),
    "1",
  );
  const passwordId = randomUUID();
  sql(`begin; ${auth} select public.add_workspace_key_wrapper('${owner}','${wrapper(passwordId)}'); commit;`);
  await holdTransaction(
    `select public.replace_workspace_password_wrapper('${owner}','${passwordId}','${wrapper(randomUUID())}')`,
    async () => {
      assert.throws(
        () =>
          sql(
            `begin; ${auth} select public.replace_workspace_password_wrapper('${owner}','${passwordId}','${wrapper(randomUUID())}'); commit;`,
          ),
        /workspace_password_wrapper_conflict/,
      );
    },
  );
  assert.equal(
    sql(
      `select count(*) from public.workspace_key_wrappers where owner_id='${owner}' and wrapper_type='password' and revoked_at is null`,
    ),
    "1",
  );
  // Model rotation's profile lock and active-version update, then race an old-version addition.
  await holdTransaction(
    `reset role; select owner_id from public.workspace_encryption_profiles where owner_id='${owner}' for update; update public.workspace_encryption_profiles set active_key_version=2 where owner_id='${owner}'`,
    async () => {
      assert.throws(
        () =>
          sql(`begin; ${auth} select public.add_workspace_key_wrapper('${owner}','${wrapper(randomUUID())}'); commit;`),
        /invalid_workspace_key_wrapper/,
      );
    },
  );
  console.log(
    JSON.stringify({
      concurrentRevocation: "one key preserved",
      concurrentPasswordChange: "one password, explicit conflict",
      additionAgainstRotation: "old version rejected after account lock",
    }),
  );
} finally {
  // This named container contains only disposable synthetic audit data.
  sql(
    `delete from public.workspace_key_wrapper_revocations where owner_id='${owner}'; delete from public.workspace_key_wrappers where owner_id='${owner}'; delete from public.workspace_encryption_profiles where owner_id='${owner}'; delete from public.workspaces where owner_id='${owner}'; delete from auth.users where id='${owner}';`,
  );
}
