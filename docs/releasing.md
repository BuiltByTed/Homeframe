# Publishing Homeframe to npm

Homeframe has two public npm packages:

- `@builtbyted/homeframe`: the complete framework, its subpath exports, styles,
  types, and `homeframe` CLI binary;
- `scaffold-homeframe-app`: the generator behind
  `npx scaffold-homeframe-app my-app`.

The component workspaces under `packages/` are private build internals. Never
publish them individually.

## Release gate

From a clean checkout on the release commit:

```bash
npm ci
npm run release:check
npm pack --dry-run --workspace @builtbyted/homeframe
npm pack --dry-run --workspace scaffold-homeframe-app
```

The Homeframe packlist must contain the root and subpath JavaScript/declaration
files, runtime and React CSS, executable CLI, README, and license. The scaffold
packlist must contain its executable, README/license, starter template,
`AGENTS.md`, and `docs/HOMEFRAME_RUNBOOK.md`.

Generate an app outside the workspace from the candidate tarballs. Install only
the packed `@builtbyted/homeframe` tarball into it, then run:

```bash
npm run typecheck
npm run build
npm run doctor
```

Complete the physical-device matrix in `SPEC.md` before calling a release stable.

## Publish

The initial scoped publish must be public:

```bash
npm publish --workspace @builtbyted/homeframe --access public
npm publish --workspace scaffold-homeframe-app --access public
```

Do not use `--force`, reuse a published version, or publish a private internal
workspace. npm write-level 2FA may require browser approval.

## Verify the registry

After npm propagation, use a clean temporary directory and the public command:

```bash
npx --yes scaffold-homeframe-app@0.1.0 registry-smoke
cd registry-smoke
npm run check
```

Confirm the npm page for `@builtbyted/homeframe` renders its README and exposes
the intended repository, license, version, entry points, and CLI. Then tag the
release commit, push the tag, and verify GitHub CI, CodeQL, Pages, and the live
kitchen-sink app.
