import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import assert from "node:assert/strict";
import { generateRecoveryKey, recoveryKeyFingerprint, recoveryKeyFingerprints } from "../src/crypto/recoveryKeys.js";
import {
  generateAccountMasterKey,
  generateWorkspaceCryptoId,
  wrapMasterKey,
  unwrapMasterKey,
} from "../src/crypto/workspaceCrypto.js";
import { createPasswordWrapper } from "../src/crypto/passwords.js";

// Local, isolated Docker project only. Real client-generated material crosses
// SQL's validator/RPC/storage boundary and comes back to WebCrypto for unlock.
const container = process.env.HIBI_SQL_TEST_CONTAINER || "supabase_db_class-manager-data-safety";
if (!/^supabase_db_[a-zA-Z0-9_-]+$/.test(container)) throw new Error("Use a local Supabase test container.");
const owner = "55555555-5555-4555-8555-555555555555";
const workspaceCryptoId = generateWorkspaceCryptoId();
const masterKey = generateAccountMasterKey();
const recovery = await generateRecoveryKey();
const wrapperId = crypto.randomUUID();
const wrapper = {
  wrapperId,
  type: "recovery",
  recoveryFingerprint: await recoveryKeyFingerprint(recovery.secret),
  ...(await wrapMasterKey({ masterKey, wrappingSecret: recovery.secret, workspaceCryptoId, wrapperId })),
};
const legacyWrapperId = crypto.randomUUID();
const legacyWrapper = {
  wrapperId: legacyWrapperId,
  type: "recovery",
  recoveryFingerprint: (await recoveryKeyFingerprints(recovery.secret))[1],
  ...(await wrapMasterKey({
    masterKey,
    workspaceCryptoId,
    wrapperId: legacyWrapperId,
    wrappingSecret: recovery.secret,
  })),
};
const passwordWrapper = await createPasswordWrapper({
  masterKey,
  workspaceCryptoId,
  password: "synthetic violet canyon lantern",
});
const replacement = await createPasswordWrapper({
  masterKey,
  workspaceCryptoId,
  password: "synthetic forest river meadow",
});
const sqlValue = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const sql = `begin;
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data)
values ('${owner}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','synthetic-recovery@example.test','x','{}','{}');
insert into public.workspace_encryption_profiles (owner_id,workspace_crypto_id,protocol_version,schema_version,migration_status)
values ('${owner}','${workspaceCryptoId}',1,2,'active');
set local role authenticated;
set local request.jwt.claim.sub = '${owner}';
set local request.jwt.claim.role = 'authenticated';
select public.add_workspace_key_wrapper('${owner}', ${sqlValue(passwordWrapper)});
select public.add_workspace_key_wrapper('${owner}', ${sqlValue(wrapper)});
select 'WRAPPER:' || jsonb_build_object('wrapperId',wrapper_id,'type',wrapper_type,'keyVersion',key_version,'wrapperVersion',wrapper_version,'nonce',nonce,'wrappedKey',wrapped_key)::text from public.workspace_key_wrappers where wrapper_id='${wrapperId}';
select public.add_workspace_key_wrapper('${owner}', ${sqlValue(legacyWrapper)});
select public.replace_workspace_password_wrapper('${owner}','${passwordWrapper.wrapperId}',${sqlValue(replacement)});
select 'PURGED:' || (not exists(select 1 from public.workspace_key_wrappers where wrapper_id='${passwordWrapper.wrapperId}'))::text;
select 'AUDIT:' || (exists(select 1 from public.workspace_key_wrapper_revocations where wrapper_id='${passwordWrapper.wrapperId}'))::text;
select 'READONLY:' || (not has_table_privilege('authenticated','public.workspace_key_wrapper_revocations','INSERT,UPDATE,DELETE'))::text;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666666';
select 'ISOLATED:' || (not exists(select 1 from public.workspace_key_wrapper_revocations where owner_id='${owner}'))::text;
rollback;`;
let output;
try {
  output = execFileSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
} catch (error) {
  // The child-process error embeds SQL ciphertext; do not attach it to exported logs.
  /* eslint-disable preserve-caught-error -- The child error contains the SQL test payload. */
  throw new Error("Isolated SQL recovery integration failed: " + String(error.stderr).split("\n")[0], {
    cause: new Error("SQL test command failed"),
  });
  /* eslint-enable preserve-caught-error */
}
const row = output.split("\n").find((line) => line.startsWith("WRAPPER:"));
assert.ok(row, "SQL must return the stored wrapper");
const loaded = JSON.parse(row.slice(8));
assert.deepEqual(
  await unwrapMasterKey({ wrapper: loaded, wrappingSecret: recovery.secret, workspaceCryptoId }),
  masterKey,
);
assert.ok(output.includes("PURGED:true"));
assert.ok(output.includes("AUDIT:true"));
assert.ok(output.includes("READONLY:true"));
assert.ok(output.includes("ISOLATED:true"));
console.log(
  JSON.stringify({
    clientGeneratedRecoveryRegisteredAndUnlocked: true,
    legacyFingerprintAccepted: true,
    revokedPasswordMaterialPurged: true,
    metadataRetained: true,
    revocationMetadataOwnerIsolatedAndReadOnly: true,
  }),
);
masterKey.fill(0);
recovery.secret.fill(0);
