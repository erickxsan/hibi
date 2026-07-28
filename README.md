# hibi

A calm, minimalist class companion for students, groups, grades, attendance, class-by-class payments, collections, balances, and revenue projections.

The app now supports two modes:

- **Cloud mode:** Supabase accounts with Google registration and legacy email sign-in, one private workspace per account, live updates across devices, and revision checks that prevent silent concurrent overwrites.
- **Local fallback:** when cloud environment variables are absent, the app continues using this browser's `localStorage`.

No real student or guardian information is bundled in the source or production build.

## Run locally

```powershell
pnpm install
pnpm dev
```

Without a local `.env`, `pnpm dev` opens in local-only mode. Production builds fail closed when cloud credentials are missing, unless `VITE_ALLOW_LOCAL_MODE=true` was deliberately set for a private offline build. To exercise Google authentication and synchronization, configure Supabase as described in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Verify

```powershell
pnpm test
pnpm build
```

The SQL backend lives in [`supabase/migrations`](./supabase/migrations), and its security test procedure is documented in [`supabase/README.md`](./supabase/README.md).

## Existing data

Before changing from the local address to a hosted domain, download a JSON backup from **Setup → Preferences → Backup and reset**. Browser storage is isolated by domain, so the hosted site cannot automatically read records stored at `127.0.0.1`.

After signing into the hosted app, restore that JSON backup from the same Setup screen. If cloud mode is enabled on the original local address, the app also offers a one-time automatic migration into the signed-in account.

JSON backups are plaintext and may contain student, guardian, attendance, grade, and payment information. Store them privately.

## JSON imports

**Import records** is additive: it previews new records, exact duplicates, and possible conflicts before saving. Existing records are never removed, conflicts keep the current value by default, related IDs are remapped, and an identical file is not applied twice. **Restore full backup** remains a separate recovery operation that intentionally replaces the workspace after an explicit confirmation.
