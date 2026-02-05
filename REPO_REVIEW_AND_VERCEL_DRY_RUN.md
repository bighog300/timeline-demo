# Repository Review and Vercel Dry-Run Verification

## Scope
This report reviews the current repository contents, summarizes each file’s purpose, and verifies deployment readiness by running the Vercel-equivalent install/build commands from `package.json` and `vercel.json`.

---

## 1) Repository Reality Check

The repository currently contains deployment/docs scaffolding, but **does not contain the app source tree** referenced by the docs (`apps/web`, `apps/api`, `packages/*`).

### Present files
- `.env.example`
- `.github-workflows-ci.yml`
- `.node-version`
- `.nvmrc`
- `00-START-HERE.md`
- `BUILD_SIMULATION_REPORT.md`
- `DEPLOYMENT_CHECKLIST.md`
- `DEPLOYMENT_GUIDE.md`
- `LOCKFILE_GENERATION_SUMMARY.md`
- `QUICK-REFERENCE.md`
- `README_NEW.md`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `setup.sh`
- `vercel.json`

### Missing (but referenced) directories
- `apps/web`
- `apps/api`
- `packages/shared` (and other package subdirs)

---

## 2) File-by-file Purpose Summary

- **`00-START-HERE.md`**: Entry-point overview of the deployment bundle and intended usage sequence.
- **`README_NEW.md`**: Intended main project README for a full monorepo (features, architecture, local dev, deployment).
- **`DEPLOYMENT_GUIDE.md`**: Deep deployment manual (API host + Vercel web + OAuth + troubleshooting).
- **`DEPLOYMENT_CHECKLIST.md`**: Execution checklist to track deployment completion.
- **`QUICK-REFERENCE.md`**: Condensed command/env/settings lookup for day-to-day deployment work.
- **`BUILD_SIMULATION_REPORT.md`**: A prior, likely external simulation report claiming the full monorepo build is healthy.
- **`LOCKFILE_GENERATION_SUMMARY.md`**: Notes around lockfile generation process and expectations.
- **`.env.example`**: Template for API/web runtime configuration and secrets.
- **`setup.sh`**: Interactive local bootstrap script for Node/pnpm/env/database tasks.
- **`package.json`**: Root scripts for monorepo development + Vercel install/build commands.
- **`pnpm-workspace.yaml`**: Defines workspace globs `apps/*` and `packages/*`.
- **`pnpm-lock.yaml`**: Current lockfile (effectively empty importer state).
- **`vercel.json`**: Vercel config (build/install scripts, Next.js framework, API rewrite placeholder).
- **`.github-workflows-ci.yml`**: CI intended to run lint/test/build and Vercel-style build validation.
- **`.nvmrc` / `.node-version`**: Node version pinning helpers.

---

## 3) Deployment Dry-Run Verification (Vercel-style)

## Commands executed
1. `node -v && pnpm -v && pnpm run vercel:install`
2. `pnpm install --no-frozen-lockfile`

### Result A — `pnpm run vercel:install` failed
Failure:
- `ERR_PNPM_OUTDATED_LOCKFILE`
- Lockfile importer specs `{}` do not match root `package.json` specifiers (`next: ^15.1.6`).

Interpretation:
- `--frozen-lockfile` in the Vercel install script will fail in CI/Vercel until lockfile is regenerated and committed.

### Result B — attempted lockfile regen install failed
Failure:
- `ERR_PNPM_FETCH_403` while fetching `https://registry.npmjs.org/next`
- Registry access blocked in this environment due missing authorization.

Interpretation:
- Local environment cannot currently fetch npm packages, so full build simulation cannot proceed here.

---

## 4) Critical Issues Found

1. **Repository completeness mismatch (blocking)**
   - Docs describe a full monorepo, but runtime source directories are missing.
   - Build commands target `./apps/web`, which does not exist.

2. **Lockfile/package mismatch (blocking for Vercel)**
   - `pnpm-lock.yaml` is stale/empty relative to current `package.json` dependencies.
   - `vercel:install` with `--frozen-lockfile` will always fail until fixed.

3. **Placeholder API rewrite (functional risk)**
   - `vercel.json` still rewrites `/api/*` to `https://YOUR-API-DOMAIN.com/:path*`.
   - Even successful web deployment would have broken API calls until replaced.

4. **CI references unavailable app paths (likely blocking)**
   - Workflow expects build artifacts at `apps/web/.next` and runs monorepo build scripts.
   - With current contents, CI cannot be validly green.

5. **Build simulation report appears out-of-sync with current repo state**
   - Existing report claims app files and folders that are absent in this snapshot.

---

## 5) Recommended Fixes

## A. Restore actual application source tree (highest priority)
- Add/restore:
  - `apps/web`
  - `apps/api`
  - `packages/shared` (+ any other required workspace packages)
- If this repo is intentionally docs-only, then remove/adjust scripts/docs that assume monorepo sources.

## B. Regenerate and commit lockfile
Run on a machine with npm registry access:
```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
```
Then commit updated `pnpm-lock.yaml`.

## C. Validate Vercel build locally before deploy
```bash
pnpm run vercel:install
pnpm run vercel:build
```
Confirm output path exists:
```bash
test -d apps/web/.next && echo "ok"
```

## D. Replace placeholder API destination
In `vercel.json`, set:
- `https://YOUR-API-DOMAIN.com/:path*` → actual API domain.

## E. Align docs with actual repository contents
- Update `README_NEW.md`, `00-START-HERE.md`, and simulation report so they match the real state.
- If repository is a starter/deployment bundle only, state that explicitly.

## F. CI hygiene
- Keep CI workflow in `.github/workflows/ci.yml` path (currently filename is `.github-workflows-ci.yml`).
- Ensure CI jobs only reference files/paths that actually exist in repository.

---

## 6) Overall Assessment

Current state is **not deployable to Vercel as-is** due to:
- missing app source tree,
- lockfile mismatch with frozen install,
- placeholder API rewrite,
- and environment-limited package fetch during this validation.

Once the source tree is restored and lockfile refreshed, rerun Vercel-style install/build checks to confirm readiness.
