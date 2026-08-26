# Security policy

## Supported version

Security fixes are applied to the latest revision of `main`.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include real student, guardian, authentication, or payment data in a report.

Send a private report to [hibicontact.old339@passinbox.com](mailto:hibicontact.old339@passinbox.com) with:

- the affected component and revision;
- reproduction steps using synthetic data;
- the expected impact;
- any suggested mitigation.

You should receive an acknowledgement within 5 business days. Details will remain private until a fix is available and coordinated disclosure is appropriate.

## Scope priorities

Reports involving cross-account access, Row Level Security bypasses, credential exposure, destructive imports, offline outbox replay, or unauthorized recovery snapshots receive the highest priority.

## End-to-end encryption

Cloud workspace content uses the versioned protocol described in
[`docs/E2EE_ARCHITECTURE.md`](./docs/E2EE_ARCHITECTURE.md). Supabase authentication and cryptographic unlock are
separate. Report any path that sends plaintext workspace content, an Account Master Key, a WebAuthn PRF result, or a
recovery secret over the network or stores it in logs/database as a critical vulnerability. Ciphertext substitution,
manifest bypass, rollback-witness bypass, legacy-client plaintext writes, and incomplete account erasure are also
critical.
