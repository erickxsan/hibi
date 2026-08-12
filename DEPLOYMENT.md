# hibi cloud deployment

The recommended free stack is Supabase for authentication/database and Cloudflare Pages for the Vite frontend. A custom domain is optional.

## 1. Create and configure Supabase

1. Create a Supabase project.
2. Apply every file in `supabase/migrations/` in filename order, preferably by linking the Supabase CLI and running `supabase db push`. The `202608120001_normalized_workspace_entities.sql` migration backfills existing JSON workspaces into normalized tables. Deploy it before the matching frontend; old open tabs will fail closed on save until refreshed.
3. In **Authentication → URL Configuration**, set the production Site URL to `https://usehibi.pages.dev/` and add these redirect URLs:
   - `http://127.0.0.1:4173/`
   - `https://usehibi.pages.dev/`
   - the custom HTTPS domain, if one is used
4. Create a Google Cloud project and configure its OAuth consent screen for **hibi**. Create a **Web application** OAuth client with:
   - Authorized JavaScript origin: `https://usehibi.pages.dev`
   - Authorized redirect URI: the callback URL shown in Supabase **Authentication → Providers → Google**, normally `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
5. Copy the Google Client ID and Client Secret into the Supabase Google provider settings and enable the provider. Keep the secret only in Google/Supabase dashboards—never in Vite or Cloudflare environment variables.
6. hibi exposes Google registration and legacy email/password sign-in. It does not expose email registration or password recovery until custom SMTP is configured. The Supabase demonstration mailer is not suitable for public accounts.
7. Optionally protect legacy password sign-in with hCaptcha. Set `VITE_HCAPTCHA_SITE_KEY` in the deployed frontend before enabling hCaptcha in Supabase, or password sign-in will be rejected.
8. Copy the Project URL and the public publishable key. Never use the service-role/secret key in this frontend.
9. Deploy the administrative deletion function after the database migrations:

   ```sh
   supabase secrets set HIBI_ALLOWED_ORIGINS=https://usehibi.pages.dev
   supabase functions deploy delete-account --no-verify-jwt
   ```

   Supabase supplies the URL and publishable/secret keys to the function; the implementation also accepts the legacy
   anon/service-role names during the platform key migration. A secret or service-role key must never be copied into a
   `VITE_` variable. Add a custom production origin to `HIBI_ALLOWED_ORIGINS` when one is introduced.

Create `.env.local` from `.env.example`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
# Optional, only if hCaptcha is enabled in Supabase:
# VITE_HCAPTCHA_SITE_KEY=YOUR_PUBLIC_HCAPTCHA_SITE_KEY
```

Restart the Vite server after changing environment variables.

## 2. Validate account isolation

Follow the two-account procedure in `supabase/README.md`. With Docker Desktop and the Supabase CLI running, execute `pnpm test:db`. Do not publish until both accounts can only read their own workspace, direct table writes are denied, and the revision-conflict test succeeds.

## 3. Deploy to Cloudflare Pages

Use these project settings:

- Framework preset: **Vite**
- Build command: `pnpm test && pnpm build`
- Build output directory: `dist`
- Project name: **usehibi**
- Production branch: **main**
- Build runtime variables: `NODE_VERSION=22.16.0` and `PNPM_VERSION=11.7.0`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and—only when Supabase CAPTCHA is enabled—`VITE_HCAPTCHA_SITE_KEY`

The files in `public/` add anti-indexing and browser security headers during the build. Cloudflare Pages supplies SPA fallback automatically when no top-level `404.html` is present. After the first deployment, add the final Pages URL to Supabase's allowed redirect URLs and test first-time Google registration, returning Google login, legacy email login, sign-out, and a second browser/device.

## 4. Move existing local records

Because `localStorage` is tied to an exact origin, use this safe sequence:

1. Open the current local app and download a JSON backup.
2. Open the hosted site and create/sign into the correct account.
3. Use **Setup → Preferences → Restore JSON backup**.
4. Confirm student, grade, class, and payment totals before deleting any local copy.

## Operational notes

- Supabase Free projects may pause after inactivity; monitor the project before a scheduled class.
- Realtime replays small entity patches; per-entity revision checks protect same-record edits without rejecting unrelated concurrent changes.
- Export periodic backups and keep them in protected storage.
- Do not remove Auth users from the dashboard. The protective `RESTRICT` constraints are intentional. Hibi's
  authenticated **Delete account and data** flow tombstones the account, removes owned Storage objects through the
  Storage API, erases every registered owner table, hard-deletes Auth in the Edge Function, and retains a minimal
  pseudonymous receipt containing only hashes and timestamps for 90 days.
- **Reset workspace** is recoverable, not permanent deletion. Server snapshots are limited to 20 revisions and have a
  30-day window enforced by the scheduled `pg_cron` purge. Encrypted device copies are limited to 8; expired copies are
  purged when Hibi next opens on that device. The deprecated JSON workspace document is scrubbed and is not an extra
  recovery copy.
- Keep the support contact monitored for privacy and ARCO requests even though routine account deletion is now
  available inside the app.
- Public launch pages are available at `/privacy.html` and `/terms.html`. Review them for the operator's jurisdiction and keep the published support mailbox available.
- A `pages.dev` hostname can run an External/In-production Google OAuth client, but it cannot provide the DNS ownership Google expects for a verified production brand. A later verified custom domain is recommended to remove the unverified-brand limitation.
- Before leaving Google OAuth testing mode or promoting hibi publicly, publish a reviewed privacy notice and define consent, access, retention, and deletion procedures appropriate to the students' jurisdiction.
