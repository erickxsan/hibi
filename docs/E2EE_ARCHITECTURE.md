# Hibi end-to-end encryption protocol

Status: protocol v1, schema v1. This document is the implementation contract for `src/crypto`,
`src/cloud/encryptedWorkspaceRepository.js`, and
`supabase/migrations/202608250001_end_to_end_encryption_v2.sql`.

## Security boundary

Supabase authentication identifies the account. It does not unlock content. After authentication, Hibi requires one of:

- a passkey that returns a WebAuthn PRF result;
- a remembered-device AES key stored as a non-extractable `CryptoKey` in IndexedDB; or
- an optional recovery key with an offline checksum.

The browser then holds the Account Master Key (AMK) only for the unlocked session. Domain components receive the same
plain JavaScript state as before. Encryption and integrity checks happen below the domain layer, immediately before
persistence and immediately after loading. Network requests contain ciphertext, nonces, stable entity IDs, revisions,
version fields, manifests, and key wrappers, but never an AMK, PRF result, recovery secret, or domain value.

Production passkeys are bound to:

```text
Origin: https://usehibi.pages.dev
RP ID:  usehibi.pages.dev
```

The client rejects passkey registration and use from localhost, Cloudflare previews, and other origins. Development
builds can exercise the cryptographic and UI tests with mocked WebAuthn, but cannot create production credentials.

## Threat model

Hibi protects against a database reader, backup operator, accidental SQL disclosure, cross-account query, ciphertext
modification, entity substitution, partial replay, omitted entities, and rollback on a device that retains a verified
revision witness. RLS remains defense in depth and every mutation RPC rechecks `auth.uid()`, ownership, size, format,
idempotency, expected global revision, and expected entity revision.

The following are explicitly outside protocol v1:

- a malicious frontend release served to the user;
- a compromised unlocked browser, operating system, or authenticator;
- content intentionally exported as readable JSON or Excel;
- deletion of plaintext previously downloaded by a lost device; and
- detection by a completely new device of a full historical-state replay when no external witness exists.

## Key hierarchy and wrappers

The browser generates a uniformly random 256-bit AMK. It never derives the AMK from account, OAuth, JWT, email, or
password material. HKDF-SHA-256 derives independent 256-bit material using versioned purpose and context values:

- `entity`: collection/entity encryption;
- `manifest`: global integrity MAC; and
- `amk-wrapper`: passkey and recovery-key wrappers.

Entity derivation includes `workspaceCryptoId`, collection, entity ID, and key version. Wrapper derivation includes
`workspaceCryptoId`, wrapper ID, and key version. Changing a passkey adds a wrapper around the same AMK. Emergency
rotation creates a new AMK and key version, re-encrypts active entities and every retained snapshot, asks every active
passkey to wrap the new AMK, revokes old recovery wrappers, clears old device caches, and publishes the change in one
database transaction.

A remembered device generates its own non-extractable AES-256-GCM key. It wraps the AMK with account and workspace IDs
as authenticated data. The same key encrypts the device's last verified revision/root witness. Explicit sign-out,
account deletion, or **Forget this device** removes the wrapper, key, and witness.

Recovery keys contain 32 random bytes plus a four-byte SHA-256 checksum, encoded with human-friendly Crockford Base32.
Only an AMK wrapper and a short one-way fingerprint are stored remotely. The displayed secret is never recoverable by
Hibi support.

## Entity envelope

Each settings, group, student, grade, class record, schedule, exception, and recurring change is independently encrypted
with AES-256-GCM and a new random 96-bit nonce on every write. The authenticated data is canonical JSON containing:

```json
{
  "workspaceCryptoId": "…",
  "collection": "students",
  "entityId": "…",
  "entityRevision": 4,
  "schemaVersion": 1,
  "keyVersion": 1
}
```

The server stores only those exterior fields, nonce, ciphertext, owner ID, and timestamps. It has no columns for names,
contacts, class dates, grades, attendance, amounts, or payment dates.

## Global integrity and rollback witnesses

Hibi hashes the canonical exterior of each envelope, sorts leaves by collection/entity ID, and computes a binary Merkle
root. A manifest authenticates that root, the previous root, global revision, entity count, schema/key versions,
workspace ID, and operation UUID with an HMAC key derived from the AMK.

The remembered-device key encrypts the most recent verified revision and root. When a later revision is loaded, the
client verifies every retained event manifest and root link from that witness to the downloaded state. A lower revision,
different root for the same revision, gap, fork, invalid entity tag, invalid manifest root, or invalid MAC blocks writes.

## Synchronization and offline operation

The IndexedDB outbox is encrypted before optimistic state is exposed. Mutations carry encrypted upserts, authenticated
deletions, expected entity revisions, an operation UUID, and a new manifest. The server retains idempotency receipts.

On a global-revision conflict, the client downloads and verifies the remote envelopes. If touched entity revisions are
unchanged, it merges the remote plaintext state locally, recalculates the manifest over the combined encrypted state,
and retries. A changed touched entity remains a real conflict. Multiple offline edits keep predicted sequential
revisions and replay in order.

Realtime publishes only encrypted change events. Reconnect downloads recent encrypted events and decrypts/validates in
the browser; it never asks the server to inspect content.

## Transactional legacy migration

Migration begins only after the authenticated browser has loaded a valid legacy workspace and successfully created a
PRF passkey. `migration_started` blocks every old write path while preserving all original rows.

The browser encrypts active entities and each retained server snapshot, uploads them to owner-scoped staging tables,
downloads staging again, verifies every tag and manifest, reconstructs canonical state, and compares it byte-for-byte
with the source. The final RPC locks the profile, checks counts and settings, promotes staging, publishes revision 1,
scrubs the legacy document, removes normalized readable rows and old snapshots, and activates E2EE in one transaction.

Before finalization, any error calls the abort RPC, which removes only staging, the provisional profile, and wrappers.
The readable source remains untouched and writable again. After activation, triggers make old clients fail with
`encryption_required` instead of recreating plaintext.

## Backups, restore, and deletion

`.hibi` is the recommended backup. It contains encrypted envelopes, manifest, workspace crypto ID, and compatible
wrappers. Import verifies and decrypts locally, validates domain state, archives the current encrypted state, then
re-encrypts the selected state with fresh nonces. A different account can restore the file by supplying the source
recovery key or a compatible source passkey locally; Hibi unlocks the source wrapper in memory and re-encrypts the
validated state to the destination workspace without uploading source plaintext.

Readable JSON remains an explicitly labeled advanced export. Legacy JSON import is parsed, compared, and validated in
the browser, then encrypted before any network request. Excel reports remain readable local exports.

Verified account deletion registers and erases profiles, wrappers, entities, events, receipts, migration staging, and
snapshots before Auth deletion. Browser cleanup removes the outbox, recovery copies, encrypted cache, remembered AMK,
device key, and rollback witness.

## Release gates

Before production rollout:

1. Run `pnpm quality` and `pnpm test:e2e`.
2. Run `pnpm test:db` against a clean local Supabase database with Docker active.
3. Test real PRF creation/unlock, remembered-device unlock, recovery unlock, migration interruption, multiple tabs,
   offline replay, same-entity conflict, snapshot restore, rotation, and deletion on the target browser/authenticator
   matrix.
4. Inspect Supabase as an administrator and confirm that no readable domain values remain after migration.
5. Inspect browser network/log output and confirm that AMK, PRF results, recovery secrets, and plaintext are absent.
6. Do not activate rollout for a major browser/platform combination that supports neither PRF nor secure recovery.
