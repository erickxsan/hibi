import assert from "node:assert/strict";
import { randomUUID, webcrypto } from "node:crypto";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { TextEncoder } from "node:util";
import { assertValidState, createStarterState } from "../src/domain/index.js";
import {
  canonicalWorkspaceHash,
  createManifest,
  decryptWorkspace,
  encryptWorkspace,
  generateAccountMasterKey,
  generateWorkspaceCryptoId,
} from "../src/crypto/index.js";

const FIVE_MIB = 5 * 1024 * 1024;
const SNAPSHOT_COUNT = 20;
const state = createStarterState();
for (let index = 0; index < 1040; index += 1) {
  state.students.push({
    id: `performance-student-${index}`,
    code: `PERF-${String(index).padStart(4, "0")}`,
    fullName: `Performance Student ${index}`,
    avatarId: "cat",
    groupIds: [],
    isIndividual: true,
    customHourlyRate: null,
    studentEmail: "",
    guardianPhone: "",
    phone: "",
    guardianContact: "",
    notes: `${index}:${"x".repeat(5000)}`,
    status: "Active",
  });
}
assertValidState(state);
const sourceBytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
assert(sourceBytes >= FIVE_MIB, `Expected a 5 MiB fixture, received ${sourceBytes} bytes.`);

const masterKey = generateAccountMasterKey(webcrypto);
const workspaceCryptoId = generateWorkspaceCryptoId(webcrypto);
const sourceHash = canonicalWorkspaceHash(state);
const startedAt = performance.now();
let encryptedBytes = 0;
for (let revision = 1; revision <= SNAPSHOT_COUNT; revision += 1) {
  const envelopes = await encryptWorkspace({ masterKey, workspaceCryptoId, state, cryptoApi: webcrypto });
  const manifest = await createManifest({
    masterKey,
    workspaceCryptoId,
    envelopes,
    workspaceRevision: revision,
    previousRoot: null,
    operationId: randomUUID(),
    cryptoApi: webcrypto,
  });
  const restored = await decryptWorkspace({ masterKey, workspaceCryptoId, envelopes, cryptoApi: webcrypto });
  assert.equal(canonicalWorkspaceHash(restored.state), sourceHash, `Snapshot ${revision} failed parity.`);
  encryptedBytes += new TextEncoder().encode(JSON.stringify({ envelopes, manifest })).byteLength;
}
const elapsedMs = performance.now() - startedAt;
assert(elapsedMs < 120_000, `The 5 MiB/20-snapshot test exceeded 120 seconds (${Math.round(elapsedMs)} ms).`);

process.stdout.write(
  `${JSON.stringify({ sourceBytes, snapshotCount: SNAPSHOT_COUNT, encryptedBytes, elapsedMs: Math.round(elapsedMs) })}\n`,
);
