# Quality gate

Every pull request and every push to `main` runs three GitHub Actions workflows.

## Required checks

- **Quality gate / Lint, types, tests, coverage, build**: ESLint, Prettier, incremental JavaScript type checking, all Vitest suites, coverage thresholds, and a production Vite build.
- **Quality gate / Chromium E2E**: browser tests for persistence, onboarding, archives, encrypted recovery and pending operations.
- **Database gate / Migrations, lint, pgTAP**: a clean Supabase reset, schema lint, RLS tests, mutation idempotency tests, and normalized import tests.
- **Security gate / CodeQL SAST** and **Security gate / Secret scan**: static analysis and repository-history secret detection.
- **Security gate / Dependency review**: blocks pull requests that introduce moderate-or-higher vulnerable dependencies.
- **Security gate / Audit all dependency advisories**: audits the complete locked dependency graph on push, pull request and the weekly schedule.

Configure these job names as required branch-protection checks for `main`. Require at least one approving review and dismissal of stale approvals; `CODEOWNERS` routes sensitive database, auth, cloud, and workflow changes to the repository owner.

## Local commands

```sh
pnpm install
pnpm quality
pnpm test:components
pnpm exec playwright install chromium
pnpm test:e2e
```

With Docker running:

```sh
supabase start
pnpm test:db
supabase stop --no-backup
```

The JavaScript typecheck covers every production module in `src`, plus build/E2E configuration. Contracts for persistence adapters, crypto sessions and common UI props are checked across layers. Tests themselves are excluded. This remains an incremental JavaScript migration: `strict:false` and `noImplicitAny:false` permit inferred `any`, so a passing check does not imply full strict typing. Do not exclude new application areas to make checks pass.

Coverage minimums in `vite.config.js` are 58% statements, 60% lines and 52% branches/functions across all production source, including inactive screens. Vitest 4 uses AST-based V8 remapping: its branch/function denominator differs from Vitest 3, so the former 64% values were recalibrated against the new measurement rather than excluding code. Statement/line floors rise from the former 34%. Stronger separate gates protect domain (85% statements, 75% branches, 90% functions/lines) and crypto (90% statements/functions, 75% branches, 95% lines). A version change must record comparable baselines before altering these thresholds.

Regression tests cover recovery client→SQL→unlock, real password/recovery hooks, old-key backup passwords, recurrence phase/end dates, historical charges, cent arithmetic, two-client stale import previews, read-only mutations, locale state, accessibility and disabled controls. A routed application test uses the real manager and persisted state. Database CI uses real generated wrappers rather than SQL string matching.

Build budgets inspect the static JavaScript import graph in Vite's manifest: at most 650 kB (190 kB gzip), each chunk below 500 kB, and all published onboarding illustrations below 300 kB. Dynamic routes and tutorial are loaded on demand. These byte limits complement functional tests; they do not certify production Web Vitals or performance on a physical low-end phone.
