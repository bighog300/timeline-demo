# Release Checklist

## Preconditions
- ✅ CI is green on the release branch.
- ✅ Vercel preview deploy is successful.

## Local Verification Commands
Run these in order before merging:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm run vercel:build
node scripts/verify-build.mjs
bash scripts/smoke-test.sh
```

> Tip: you can run the full suite via `bash scripts/release-check.sh`.

## Merge Steps (GitHub UI)
1. Open the PR in GitHub.
2. Confirm all required checks are green.
3. Prefer **Squash and merge**.
4. Verify `main` shows green checks after the merge completes.

## Post-Merge Steps
- Confirm the Vercel production deploy uses the **merge commit SHA** from GitHub.

## Tagging Guidance (Optional)
- If needed, tag the merge commit as `v0.2-demo-ui`.
- Do **not** create tags as part of this checklist—only include it in release notes.

## Rollback Guidance
- Use GitHub to revert the merge commit.
- Trigger a Vercel redeploy from `main`.
