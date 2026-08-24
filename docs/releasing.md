# Publishing Homeframe to npm

Homeframe is published as one coherent version. The framework packages use the
`@builtbyted` npm organization and the app generator remains the unscoped
`scaffold-homeframe-app` package so it can run as:

```bash
npx scaffold-homeframe-app my-app
```

## Package set and order

Publish dependencies before consumers:

1. `@builtbyted/runtime`
2. `@builtbyted/sw`
3. `@builtbyted/react`
4. `@builtbyted/router`
5. `@builtbyted/vite`
6. `@builtbyted/eslint-plugin`
7. `@builtbyted/cli`
8. `scaffold-homeframe-app`

Every `@builtbyted/*` package uses the same exact version. The scaffold pins that
same framework release in the generated lockfile inputs.

## Release gate

From a clean checkout on the release commit:

```bash
npm ci
npm run release:check
npm pack --dry-run --workspaces
```

Inspect each packlist for source maps, declarations, runtime CSS, executable bin
files, README, license, and scaffold templates. Reject secrets, local paths,
workspace protocols, generated test output, or undeclared runtime dependencies.

Generate an app from the packed scaffold in a directory outside the workspace,
install dependencies from the public registry or candidate tarballs, then run:

```bash
npm run typecheck
npm run build
npm run doctor
```

Complete the physical-device release matrix in `SPEC.md` before calling a release
stable. Automated and simulator checks remain necessary but are not substitutes.

## Publish

The initial public scoped publish requires `--access public`. npm may require a
browser/2FA approval for every write session:

```bash
npm publish --workspace @builtbyted/runtime --access public
npm publish --workspace @builtbyted/sw --access public
npm publish --workspace @builtbyted/react --access public
npm publish --workspace @builtbyted/router --access public
npm publish --workspace @builtbyted/vite --access public
npm publish --workspace @builtbyted/eslint-plugin --access public
npm publish --workspace @builtbyted/cli --access public
npm publish --workspace scaffold-homeframe-app --access public
```

Do not use `--force`, reuse a published version, or publish only part of a
dependency chain. If a publish fails, inspect registry state and resume only the
missing packages at the same version.

## Verify the registry, not the workspace

After npm propagation, create another temporary app using the public command:

```bash
npx --yes scaffold-homeframe-app@0.1.0 registry-smoke
cd registry-smoke
npm run check
```

Verify package versions and public visibility with `npm view`, then commit the
release metadata, tag the exact commit, push the branch/tag, and verify GitHub CI,
CodeQL, Pages, and the live kitchen-sink app.
