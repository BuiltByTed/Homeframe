# Homeframe compatibility and release policy

Homeframe packages are released as one coherent version. Applications should pin
all `@builtbyted/*` packages together and update them in one lockfile change.

## Current preview line

| Homeframe | React | Vite | Node for build tools | Validated automation |
| --- | --- | --- | --- | --- |
| 0.1.x preview | 18 and 19 | 7 and 8 | `^20.19.0` or `>=22.12.0` | iOS 26.2 Safari/Home Screen simulator; Chrome 151 on macOS and Linux |

The Tier 1 support target remains the current and previous two stable iOS/iPadOS
and Chrome releases. A stable release is not cut from simulator evidence alone;
the physical-device matrix in `SPEC.md` is a mandatory release gate. Preview
validation identifies known-good development coverage, not a narrower product
promise.

## Deprecation and breaking changes

- During 0.x, a minor release may contain a documented breaking API or generated
  artifact change. Patch releases remain backward compatible within that minor.
- Starting with 1.0, a public API is deprecated for at least one minor release
  and 90 days before removal, except for an actively exploitable security issue.
- Every breaking release includes config changes, identity impact, worker/cache
  compatibility, and migration instructions. `homeframe upgrade` reports the
  relevant release notes without editing application source.

## Worker, cache, and rollback contract

- The worker URL, scope, manifest `id`, and `start_url` are application identity.
  A framework update does not change them. A developer configuration change can,
  so `doctor` treats identity drift as release-blocking migration work.
- A worker understands its own revisioned precache and declared legacy cache
  names. Private runtime caches are never migrated across a schema boundary
  unless an application explicitly declares and threat-reviews that behavior.
- Deploy versioned assets before HTML and `sw.js`. Retain every asset referenced
  by the active and immediately previous worker for at least 30 days, or longer
  than the application's maximum stale-client interval. Never roll back by
  changing worker scope or asking ordinary users to clear all site data.
- A rollback republishes a compatible worker at the same URL. The recovery and
  kill-switch procedure is documented in `recovery-and-kill-switch.md`.

## Release channels

Use separate canary and production origins or deployment environments while
preserving identity within each environment. Start a migration with `manual` or
`prompt` worker activation, prove an upgrade from the actually deployed prior
worker, and promote the same immutable artifact. Do not run stable and canary
workers over competing scopes on one origin.

