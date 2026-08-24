# Homeframe diagnostics

Every `homeframe doctor` result contains a stable `HF_*` code, severity,
explanation, remediation, and this documentation link. JSON output is intended
for CI; `--strict` promotes every warning to a failing result.

## Diagnostic catalog

| Prefix | What it covers | First response |
| --- | --- | --- |
| `HF_CONFIG`, `HF_METADATA`, `HF_ROOT`, `HF_BODY`, `HF_RAW` | Source ownership and unsafe viewport/layout code | Remove duplicate document ownership and use Homeframe primitives/tokens. |
| `HF_INDEX`, `HF_MANIFEST`, `HF_ICON`, `HF_ASSET` | Built manifest and generated asset completeness | Rebuild from source artwork and deploy the artifact unmodified. |
| `HF_SW`, `HF_PRECACHE`, `HF_OUTPUT`, `HF_ROUTE_CHUNK` | Worker identity, atomic precache, revision, and retained chunks | Do not edit generated output; deploy assets before HTML/worker and retain the rollback window. |
| `HF_CACHE`, `HF_PUSH` | Runtime-data classification and notification transport safety | Classify cached data; keep private keys server-only and provide an idempotent subscription backend. |
| `HF_CSP` | Inline bootstrap, worker, and manifest policy | Use a per-response nonce or matching hash, `worker-src 'self'`, and `manifest-src 'self'`; remove `unsafe-eval`. |
| `HF_HTML`, `HF_SECURE`, `HF_DEPLOY` | HTTPS, content types, headers, live resources, and rendered controls | Correct the origin/CDN configuration, then rerun the deployed doctor. |
| `HF_DOCUMENT_SCROLL`, `HF_INPUT_ZOOM`, `HF_ROOT_TRANSPARENT` | Rendered shell conformance | Keep `window.scrollY` at zero, editable text at least 16 CSS px, and the root canvas opaque. |
| `HF_RECOVERY`, `HF_API_FALLBACK`, `HF_ROUTE_FALLBACK` | Server rewrite boundaries and recovery | Rewrite known document routes (including recovery), but never APIs or asset-looking misses. |

The complete message is authoritative because many diagnostics include the exact
file, line, URL, resource, or rendered selector. Never suppress a warning merely
to make `--strict` green; either correct it or document why the application's
explicit policy accepts it.
