# Hibi redesign integration

## Safe baseline

- Production baseline: `198153b340cf3a9a6e9383c32b9152553c3ad2c9`
- Integration branch: `codex/integrate-hibi-redesign`
- Redesign reference: `9d188b93a1285267de5d59fbf72317b76545d105`
- Launcher-only redesign commit: `57f1e904e716caed255a1751ea58ee71cd6c392c`
- Production baseline: 51 Vitest tests passing; Vite production build passing.
- Redesign baseline: 52 Vitest tests passing; Vite production build passing.

## Compatibility map

| Surface | Integration decision |
| --- | --- |
| App shell, desktop sidebar, mobile navigation, dashboard, design tokens, responsive layout, companion art | Reuse from the redesign and connect to production state. |
| Students, Groups, Classes, Payments, Settings | Adapt to the production actions, validation, unsaved-change protection, complete record fields, and existing data semantics. |
| Authentication, account menu, cloud states | Preserve production implementation and apply only compatible redesign styling. |
| Supabase client, revisioned workspace repository, Realtime subscription, RLS ownership | Preserve unchanged. |
| Grades | Preserve the complete production workflow and restyle/adapt it for multiple-group enrollment. |
| Legacy Setup and Class Log behavior | Preserve all capabilities inside the redesigned routes; retain compatibility for `/setup` and `/class-log`. |
| JSON import/export and browser-to-cloud migration | Preserve unchanged, then extend the canonical normalizer additively for new optional fields. |
| Mock or seed data from the redesign | Never copy into production or deployment. |

## External services and public configuration

- Supabase Auth, Postgres, Realtime, and RPC persistence.
- Google OAuth configured through Supabase; the client secret remains outside this repository.
- Cloudflare Pages deployment from GitHub branch `main`.
- Public Vite variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and optional `VITE_HCAPTCHA_SITE_KEY`.
- Deliberate private/local builds may use `VITE_ALLOW_LOCAL_MODE=true`; the public deployment must not.

## Data strategy

- Continue storing one owner-scoped, revisioned JSONB workspace per account.
- Keep schema version `1` while additions remain optional fields accepted by the existing database shape constraint.
- Normalize legacy `student.groupId` into `student.groupIds` without changing student IDs.
- Keep students with no group usable for individual classes without requiring manual edits.
- Backfill a class row's optional group reference only when it can be inferred safely from its legacy student relationship.
- Store avatar choices as stable optional identifiers and render a fallback for legacy students.
- Do not mutate the production database during development or preview verification.

## Rollback

1. Keep `main` at the current production baseline until preview verification passes.
2. Deploy the integration branch to a Cloudflare preview first.
3. Before production promotion, export a test workspace and verify a round-trip restore.
4. If the frontend must be rolled back, redeploy commit `198153b` or revert the integration merge. Existing JSONB documents remain valid because new fields are optional and legacy fields are normalized at the application boundary.
5. If a future SQL migration becomes necessary, create a separate additive migration with a tested down/compatibility path before production execution. No SQL migration is required for the initial redesign integration.

## UX changes after redesign stabilization

| Original problem | Implemented change | Workflow and data effect |
| --- | --- | --- |
| The redesign exposed polished tabs and actions that were partly static. | Connected every student/group detail tab, payment shortcut, class-history link, editor, and destructive action to the production actions and derived data. | Removes dead ends without changing record ownership or IDs. |
| Students could only be represented by one group in legacy records. | Added an additive `groupIds` compatibility layer plus an independent individual-class flag. | Legacy `groupId` values are retained during normalization; students can now take individual classes, multiple groups, or both. |
| Mobile Back could leave the app while the More menu was open. | Made the More menu a history-backed overlay with Escape, outside-click, focus return, and Back handling. | Navigation behavior changes only while the overlay is open; stored data is unaffected. |
| Switching from a dirty new-class form to History could leave hidden draft values behind. | Reset the discarded draft after confirmation. | Prevents an accidental later save of values the user already chose to discard. |
| Settings in the redesign omitted several production controls. | Restored reporting dates, alert thresholds, projection window, safe import preview, export, and cloud/local privacy controls inside the redesigned cards. | Existing settings and backups remain compatible; imports are capped at 5 MB and require confirmation. |
| Payment totals were difficult to connect to their source records. | Added a direct detailed-history action and an in-place mark-paid action with a saving state. | Reuses the existing class-record payment model; no duplicate payment source of truth was introduced. |
| Student initials did not provide an on-brand identity across workflows. | Added one shared, keyboard/touch-accessible animal-avatar component and compact selector. | Stores only a stable optional `avatarId`; legacy students use a cat fallback and require no manual edit. |
| Route changes and saves felt abrupt. | Added a short route settle and one-time cat success reaction. | Motion is decorative, non-blocking, and disabled by the existing reduced-motion rules. |

## Verification record

- Synthetic legacy fixtures cover no-group, single-group, several-group, individual, multi-group, incomplete optional values, grades, notes, class history, payments, and settings.
- Browser coverage includes desktop and mobile production workflows, direct legacy URLs, browser refresh, mobile Back, horizontal overflow, and console errors.
- English and Spanish routes are audited separately; the language selector remains in Settings (and authentication, where it is needed before sign-in).
- Production database writes are excluded from local and preview verification. `VITE_FORCE_LOCAL_MODE=true` is development-only and ignored by production builds.
