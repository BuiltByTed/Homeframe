# scaffold-homeframe-app

Create a production-minded [Homeframe](https://github.com/BuiltByTed/Homeframe)
React PWA with strict TypeScript, framework-safe shell and routing composition,
an application icon, source/build checks, `AGENTS.md`, and a detailed AI coder
runbook.

## Usage

```bash
npx scaffold-homeframe-app my-app
cd my-app
npm run dev
```

The default command installs dependencies. It refuses to overwrite a non-empty
directory.

```text
Usage: scaffold-homeframe-app [options] [directory]

Options:
  --app-name <name>      display name used by the app and manifest
  --package-name <name>  npm package name for the generated application
  --no-install           write the project without running npm install
  -V, --version          output the version number
  -h, --help             display help
```

## What it creates

- a Vite + React + strict TypeScript application;
- `@builtbyted/homeframe` with root React/router imports and the `/vite` adapter;
- one provider/router/viewport/shell composition with an `AppScrollView`;
- keyboard-aware bottom navigation and a safe editable-control example;
- typed Homeframe configuration, generated manifest/icons/startup assets, offline
  worker, and atomic safe-point updates;
- `AGENTS.md` with concise non-negotiable framework boundaries;
- `docs/HOMEFRAME_RUNBOOK.md` with architecture, implementation workflows, device
  acceptance matrix, release/rollback procedure, and AI handoff prompt;
- `build`, `typecheck`, `doctor`, and combined `check` commands.

## Verify a generated app

```bash
npm run check
```

`check` typechecks and builds the production PWA, then runs Homeframe's strict
source and build-output doctor. Physical iOS and installed-PWA testing is still
required before production; the generated runbook contains the matrix.

MIT © BuiltByTed
