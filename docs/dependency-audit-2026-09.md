# Dependency audit — 2026-09-15

## What changed in this branch

`npm audit fix` (non-breaking) was applied and committed. It resolved 10 of the
14 known vulnerabilities in the lockfile by bumping transitive versions only —
no direct dependency versions or code changed. Typecheck and tests pass
afterwards.

## Remaining vulnerabilities (require a version bump / manual decision)

| Package | Severity | Fix | Notes |
|---|---|---|---|
| `@fastify/static` | High (path traversal / auth bypass, 4 advisories) | Bump `apps/server` to `@fastify/static@10.x` | Direct dependency, currently `^8.0.3`. Worth prioritizing given the severity — this package serves static files. Check for breaking changes in the v9→v10 migration notes before bumping. |
| `csv-parse` | Moderate (prototype pollution via `columns`) | Bump `packages/core` to `csv-parse@7.x` | Direct dependency, currently `^5.5.6`. `core` doesn't use dynamic `columns`, so risk is low here, but the major bump should still be tested. |
| `esbuild` (via `vite`) | Moderate (dev server can be probed by any website) | Bump `apps/web` to `vite@8.x` | Dev-only risk (affects `vite dev`, not production builds). `vite` 5→8 is a large jump; budget time for a real upgrade pass rather than a drive-by bump. |

Run `npm audit` after any of these to confirm.

## Outdated direct dependencies (not security issues, just behind)

Ecosystem is 100% npm/TypeScript across `packages/core`, `apps/cli`,
`apps/server`, `apps/web`.

| Package | Current | Latest | Comment |
|---|---|---|---|
| `fastify` | 5.1.0 → 5.8.5 installed | 5.12.4 | Same major, safe to bump the version range. |
| `@fastify/multipart` | ^9.0.1 | 10.1.1 | Major bump available alongside the `@fastify/static` one — do both server-side Fastify plugin bumps together. |
| `react` / `react-dom` | ^18.3.1 | 19.3.0 | Deliberate major-version decision, not a quick bump — React 19 changes some APIs (`ReactDOM.render`, refs, etc). Recommend a dedicated spike rather than folding into a dependency-hygiene pass. |
| `recharts` | ^2.13.3 | 3.10.1 | Recharts 3 has breaking API changes; low priority unless a new chart feature needs it. |
| `commander` | ^12.1.0 | 15.0.0 | CLI-only, low risk, but 3 majors behind — worth a deliberate bump + a quick smoke test of the CLI. |
| `typescript` | ^5.6.3 | 5.9.3 (latest in 5.x; 7.x tag also exists) | Bump to `^5.9` is safe. Ignore the `7.0.2` "latest" tag — that appears to be a non-stable/prerelease line; hold on major TS bumps until it's the accepted stable release. |
| `vite` | ^5.4.11 | 8.3.0 | See esbuild note above — bundle this with the esbuild fix. |
| `@types/node` | ^22.9.0 | 26.5.1 | Types should track the Node version actually used (`engines.node: >=20`, CI pinned to Node 20). Bump to `^22` latest patch is safe; don't jump to `26` types without also moving the supported Node version. |

## Structural observations

- **No lockfile-vs-manifest drift tooling.** `npm ci` is now run in CI (added
  in `chore/dependabot-config`), which will catch lockfile drift going
  forward. Before this branch, nothing verified `package-lock.json` was in
  sync with `package.json` in PRs.
- **`@claude-analytics/core` is referenced as `"*"` from `cli` and `server`.**
  That's fine for an npm workspace (it resolves to the local package), but
  worth knowing Dependabot will never try to version-bump it — it's a
  workspace protocol match, not a registry range.
- **`better-sqlite3` and `esbuild` are native/binary deps** — worth keeping an
  eye on postinstall scripts and provenance when bumping majors on these,
  since they run native builds.
- **No `.npmrc` pinning an audit level or registry** — consider adding
  `audit-level=high` awareness to CI (e.g. `npm audit --audit-level=high`) so
  new high-severity advisories fail PRs automatically rather than relying on
  someone running `npm audit` by hand. Not done in this branch since it's a
  CI policy decision, not a dependency fix.

## Suggested follow-up order

1. Bump `@fastify/static` to v10 (highest severity, direct dep, isolated to `apps/server`).
2. Bump `csv-parse` to v7 (isolated to `packages/core`, low usage surface).
3. Bump Fastify + `@fastify/multipart` together (same major family, low risk).
4. Bump `typescript` to latest 5.x and `@types/node` to latest 22.x (routine).
5. Treat `vite`/`esbuild`, `react`/`react-dom`, `recharts`, and `commander` as separate, deliberate major-version projects — not part of routine dependency hygiene.
