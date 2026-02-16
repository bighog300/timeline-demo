# PRIVACY MODEL — Timeline

## Core Principles
- Only explicitly selected items are processed
- No background scanning
- Drive is source of truth
- No persistence of full originals

## Stored In Drive
- Summary artifacts
- Selection sets
- Run metadata

## Not Stored
- Full Gmail bodies
- Full Drive file contents
- API keys

## Auth
- NextAuth v4 (Pages Router only)
- ADMIN_EMAILS restricts admin access
