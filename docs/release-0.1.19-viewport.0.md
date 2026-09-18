# Homeframe 0.1.19-viewport.0 candidate

This candidate corrects another opaque iOS launch transition: `innerHeight`
can briefly include the native status bar while the visual viewport already
reports the smaller content canvas. The splash now compares valid unzoomed,
full-width measurements and follows visual-viewport resize events. This avoids
using a stale larger height that moves the logo below its native startup center.

Open-keyboard updates do not recenter the splash. Zoomed viewports are ignored,
and windowed tablets continue to use their own canvas. App identity, scope,
worker URL and the default opaque status-bar policy are unchanged.

Regression tests cover disagreeing layout/visual heights, visual-only resize,
keyboard state, zoom, windowed tablets and the visible logo center in a browser.
Native installed-device acceptance remains separate from these tests.

This is an unpublished package candidate, not a registry release.
