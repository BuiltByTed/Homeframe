# @builtbyted/cli

`homeframe doctor` requires a built artifact or `--url` to verify effective iOS
status-bar output. It fails for non-default status-bar settings, missing or
duplicate declarations, or a bootstrap that does not confirm `default` with
translucent geometry disabled. This is an error even without `--strict`.
See [the migration guide](https://github.com/BuiltByTed/Homeframe/blob/main/docs/ios-status-bar-migration.md).

The `homeframe` command-line interface for source/build/deployment diagnostics,
migration inventory, initialization, and upgrade checks.

```bash
npx homeframe doctor --root . --dist dist --strict
```

Start a new application with `npx scaffold-homeframe-app my-app`.
