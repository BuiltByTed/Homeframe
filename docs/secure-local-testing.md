# Trusted HTTPS testing on a LAN

Loopback HTTP is treated as secure by browsers, but a phone opening a workstation's LAN address is not. Installation, service workers, push, and notifications must be tested on a trusted HTTPS origin.

## Create a local test certificate

Use an organization-managed development CA, `mkcert`, or another local CA trusted by every test device. The leaf certificate needs a Subject Alternative Name for the exact hostname or IP testers open. Keep the CA private key and leaf private key outside the repository.

For an address such as `192.0.2.10`, start the example with:

```bash
HOMEFRAME_TLS_CERT=/secure/path/homeframe-cert.pem \
HOMEFRAME_TLS_KEY=/secure/path/homeframe-key.pem \
npm run demo:serve -- --port=4443
```

Open `https://192.0.2.10:4443`. The server prints the public VAPID key, builds it into the demo, serves `sw.js` and HTML with revalidation headers, serves hashed assets immutably, and exposes the demo subscription/send endpoints.

## Trust requirements

- macOS: add the development CA certificate, not the leaf certificate, to a test keychain and mark it trusted for SSL.
- iOS Simulator: install the CA as a root certificate with `simctl keychain add-root-cert` or through Settings.
- Physical iOS: install the CA profile, then enable full trust under Settings → General → About → Certificate Trust Settings. Remove it after testing.
- Chrome: restart Chrome after changing system trust and use a fresh profile when testing installation identity.

Do not bypass a certificate warning. A browser page behind a warning is not a valid secure-context/PWA test.

## Verify the deployment

```bash
npx homeframe doctor \
  --root examples/kitchen-sink \
  --dist examples/kitchen-sink/dist \
  --url https://192.0.2.10:4443 \
  --strict
```

In DevTools or the built-in PWA lab, confirm:

- `window.isSecureContext` is true;
- a worker controls the page after the first reload;
- the manifest and icon requests succeed without redirects or TLS warnings;
- offline reload resolves to the current shell;
- notification permission is requested only from the demo button;
- a push sent through `/api/push/send` is displayed and its route opens without a document refresh.

The real-push smoke must use a headed browser because Chromium deliberately
disables the Notifications API in headless mode:

```bash
HOMEFRAME_TEST_URL=https://192.0.2.10:4443 npm run test:push
```

For a Chrome instance already running with a nonzero remote-debugging port, set
`HOMEFRAME_CDP_URL` to that local debugging endpoint. The smoke runner will use
the existing headed profile; closing the runner disconnects its automation
session without quitting that Chrome instance.

Each origin and port is a separate installed-app identity in browser storage. When moving from HTTP to HTTPS or changing ports, install the HTTPS app separately; this is not representative of a production in-place upgrade, where the origin stays stable.
