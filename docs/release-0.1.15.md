# Homeframe 0.1.15

Both `@builtbyted/homeframe` and `scaffold-homeframe-app` advance to 0.1.15. The
starter pins the matching framework version and its CLI reports its package
version. This release preserves the 0.1.14 features and the cold-launch safe-area
fix on main.

- Each document checks its own update guards before reloading, including after
  viewport settlement. An old peer veto persists until the client reports safe
  or closed, or the service worker confirms that the client no longer exists.
  Repeated update checks preserve an already-ready or deferred update.
- Runtime caches reject expired entries on reads. Oversized streamed responses
  can return to the application without waiting for an unused cache clone.
- Checkpoints restore the new draft when their key, version, or storage changes;
  a stale setter cannot overwrite another draft.
- Fresh route visits rerun loaders. Prefetch reuse lasts 30 seconds and is
  consumed once; history data reuse lasts 60 seconds. Data retention is bounded
  to 100 entries and managed DOM previews to six scenes. Older history remains
  navigable. Router shutdown safely cancels pending loaders.
- `router.revalidate()` refreshes the current route without adding history or
  resetting scroll. `router.invalidate(url?)` clears retained data and previews
  and cancels pending work before navigation or an account change. Logout also
  invalidates active routers. Apps remain responsible for changing their auth
  state and rendered screen.
- The build doctor maps deployment-base URLs to physical output files, including
  custom worker paths and integrity-checked shell assets.

Automated regression coverage includes these cases and desktop update
presentation with a window smaller than the screen. Physical iOS, Safari, and
installed-device acceptance must still be performed before claiming the device
matrix is complete.
