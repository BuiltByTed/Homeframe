# Homeframe security review

Review date: 2026-08-23  
Scope: the Homeframe workspace, generated browser assets, generated service worker, CLI doctor, and kitchen-sink reference server. This is a code-informed release review, not a claim about applications that consume Homeframe or their production infrastructure.

## Trust boundaries

- Homeframe configuration and build-time matcher functions are trusted developer input.
- Navigation requests, runtime-cache responses, notification payloads, routes, icons, HTTP headers, URL paths, subscription bodies, and browser messages are untrusted.
- Cache names and generated artifacts are app-owned only when they use Homeframe's configured prefixes and declarations.
- Account identity is application-owned. A private runtime-cache rule must provide a stable partition key and must be purged during logout.
- The example push transport is a bounded demonstration endpoint, not an authentication or authorization system for a production notification service.

## Finding ledger

| ID | Severity | Status | Finding and remediation |
| --- | --- | --- | --- |
| SEC-001 | High | Remediated | Static-server path resolution could permit ambiguous traversal/fallback behavior. Both test and example servers now canonicalize and contain paths, reject invalid encodings, never return the document shell for asset/API misses, and apply bounded request parsing. |
| SEC-002 | High | Remediated | Framework layout previously depended on inline style attributes, weakening a strict CSP. Production builds now use a nonce-authorized runtime stylesheet, emit `style-src-attr 'none'`, and require script/style nonces without `unsafe-inline`. Browser tests assert the effective policy and element nonces. |
| SEC-003 | High | Remediated | Sensitive runtime responses could cross account boundaries if cached under a shared URL. Private rules now require an explicit threat-review marker and partition-key function, store only a one-way partition digest, skip caching when identity is missing, and support best-effort logout purge of declared private caches and metadata. Tests verify two-account isolation and absence of raw identity in cache keys. |
| SEC-004 | Medium | Remediated | Notification route allowlisting used raw prefix matching, so `/inbox` could authorize `/inbox-impersonator`. Matching now enforces path-segment boundaries, rejects cross-origin/out-of-scope routes and assets, bounds payload fields, and falls back to the document route. Regression tests cover hostile routes and payload values. |
| SEC-005 | Medium | Remediated | A dynamic CSP nonce changes HTML bytes after build and could otherwise defeat service-worker revision validation. Servers attest the revision of the unmodified built template in `X-Homeframe-Revision`; the worker accepts only an exact expected digest and otherwise hashes the fetched body plus configured bust salt before committing a build cache. Failed installs delete the incomplete cache. |
| SEC-006 | Medium | Remediated | CI used floating third-party action tags. Workflow actions are pinned to reviewed commit SHAs, with human-readable release comments. |
| SEC-007 | Low | Accepted for example only | The kitchen-sink subscription collection has no user authentication. It is intentionally an in-memory demo and now enforces same-origin writes, content types, body limits, subscription shape/quantity limits, rate limits, and push-send serialization. Production apps must supply authenticated, authorized, durable subscription storage and delivery. |

## Verification evidence

- TypeScript compile and 54 unit regressions, including worker install integrity, private cache partitioning, notification sanitization, router boundaries, viewport event ordering, update leadership, diagnostics, and ESLint policies.
- Eighteen Chromium desktop/iPhone-sized browser journeys under the generated CSP, including offline recovery, navigation history, keyboard viewport simulation, and single-source build configuration.
- Five native iOS 26.2 simulator journeys against Mobile Safari and the installed Home Screen app, plus a headed Chrome 151 tab/app-window geometry check and real VAPID subscription/delivery smoke.
- `npm audit --audit-level=info` reported zero known dependency vulnerabilities at review time.
- Repository and history filename/content scans found no committed private keys, VAPID secrets, credential files, or common token signatures.
- CLI strict build/deployment doctor verifies precache completeness, retained chunks, CSP directives, security headers, recovery routing, cache classification, generated revisions, and deep-link fallback behavior.

## Required application review

Before release, an adopting application still must review authentication, authorization, API data classification, notification recipients and contents, account switching, logout behavior, logging/redaction, retention, backend rate limits, CSP connection destinations, and infrastructure access. Any private runtime-cache rule needs an application-specific threat model and multi-account test. Do not copy the example subscription backend into production.
