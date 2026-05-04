# Salvare project memory

## Product
Salvare is a local-first browser-extension coupon engine. It tests known/admin/imported candidate coupon codes at checkout and chooses the code that gives the lowest verified final total. Candidate sources suggest codes; checkout verification decides the winner. No scraping or external coupon discovery unless a milestone explicitly says so.

## Architecture
- Runtime persistence: SQLite.
- Backend: local Node/TypeScript server.
- Admin UI: local admin page with optional admin token.
- Extension: popup + content script, tested through Chrome/Playwright smoke tests.
- Local demo checkout: Vite/React on localhost.
- JSON seed/bootstrap files are committed bootstrap sources.
- Runtime DBs and smoke DBs are ignored local artifacts.

## Artifact rules
Never commit:
- server/salvare.db
- smoke/salvare.db
- server/backups/
- server/exports/
- generated server CLI JS outputs unless explicitly tracked/intended

Tracked extension bundles may exist:
- extension/contentScript.js
- extension/popup.js

If tracked extension bundles change because extension TypeScript changed, ask/verify whether they should be committed with the TypeScript change.

## Verification commands
Full chain:
npm run build:db-init
npm run db:init
npm run db:bootstrap
npm run db:verify
npm run profiles:verify
npm run build:server
npm run build:extension
npm test
npm run test:smoke
npm run test:smoke:extension
npx tsc -b

## Workflow
Before editing:
- inspect only files relevant to the requested milestone
- provide a concise plan
- wait for approval

After editing:
- run the requested verification chain
- keep final summary concise: changed files, verification results, follow-up only

## Constraints
- Preserve backend API response shapes unless explicitly requested.
- Preserve extension behavior unless the milestone explicitly targets extension behavior.
- No real external store automation unless explicitly requested.
- No scraping/source ingestion until source-policy/source-adapter milestones. Any source-ingestion or scraping-related work must review and comply with `docs/SOURCE_POLICY.md` before implementation.
- Do not expose tokens, headers, env vars, DB paths, cookies, localStorage, DOM dumps, or raw stack traces.

## Milestone style
Use small milestones with tests. Prefer unit tests for deterministic logic and smoke tests only for stable browser-level behavior.