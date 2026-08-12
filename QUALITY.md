# Quality gate

Every pull request and every push to `main` runs three GitHub Actions workflows.

## Required checks

- **Quality gate / Lint, types, tests, coverage, build**: ESLint, Prettier, incremental JavaScript type checking, all Vitest suites, coverage thresholds, and a production Vite build.
- **Quality gate / Chromium E2E**: a browser-level local-mode smoke test that creates a student and verifies persistence after reload.
- **Database gate / Migrations, lint, pgTAP**: a clean Supabase reset, schema lint, RLS tests, mutation idempotency tests, and normalized import tests.
- **Security gate / CodeQL SAST** and **Security gate / Secret scan**: static analysis and repository-history secret detection.
- **Security gate / Dependency review**: blocks pull requests that introduce moderate-or-higher vulnerable dependencies.

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

The current JavaScript typecheck covers domain and utility modules plus build/E2E configuration. This is an intentional incremental boundary for a JavaScript codebase that did not previously have type annotations. New typed areas should be added to `tsconfig.json`; do not weaken existing coverage to make the check pass.

Coverage thresholds are enforced in `vite.config.js`. Raise them as rendered coverage expands; do not lower them without documenting why in the pull request.
