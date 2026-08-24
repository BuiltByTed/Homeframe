# Recovery and service-worker kill switch

Add `HomeframeRecovery` at `/__homeframe/recovery` in the app route table. Keep
that route in the normal navigation handler: Homeframe tries the network first
and falls back to the already-validated shell only when the network fails. The
view reports controller URL, worker/build state, registration scope, app-owned
cache count, persistence status, and the last worker error without showing cached
content or user data.

## Replace a bad worker

The recovery mechanism always uses the same stable worker URL and scope. Do not
ask users to clear browser data and do not deploy an unregister-only worker at a
different path.

1. Stop publishing the bad HTML, but retain every hashed asset referenced by both
   the current and rollback builds.
2. Build a repaired release with a new build id. If a corrupt cached response must
   be invalidated, change `cacheRevisionSalt`; routine releases must use content
   revisions instead.
3. Deploy versioned assets first, then the revalidated HTML and generated worker
   at the existing URL (normally `/sw.js`).
4. Serve that worker with `Cache-Control: no-cache` or
   `max-age=0, must-revalidate`, and serve HTML with revalidation-friendly
   headers.
5. Verify `/__homeframe/recovery`, call “Check for a repaired version,” and wait
   for update guards and all live clients to reach a safe point.
6. Confirm one activation and one reload per client. Retain the previous assets
   for the documented rollback window.

For an emergency feature shutdown, the repaired worker may use `network-only`
rules and a recovery-focused shell. It must still be a valid Homeframe worker,
install its complete revisioned precache atomically, claim the same scope, and
preserve installed-app identity.

## Private data on logout

Private runtime caching is opt-in. A private rule requires a self-contained
`partitionKey`, `purgeOnLogout: true`, and a threat-review reference. Homeframe
hashes the partition key before it enters a cache request key and never puts an
account identifier in a cache name. If identity is unavailable, the response is
network-only rather than shared.

Call `useHomeframeLogout()` from the app's logout flow. Its default operation
purges declared private caches, removes the current push subscription from the
configured transport, unsubscribes it in the browser, and removes only
`hf:checkpoint:` state. It never clears unrelated origin storage.

Telemetry remains local unless the app explicitly calls
`registerHomeframeTelemetryAdapter()`. An adapter is application code and must
remove or classify any full URL or application detail before sending it.
