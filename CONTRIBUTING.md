# Contributing

```sh
pnpm install
pnpm typecheck && pnpm test && pnpm build
```

Updating a preset when a provider changes its free tier:

1. Edit the file in `packages/presets/src/` (models, limits, `overage`, `deniedModels`).
2. Set `verifiedAt` to the date you checked and link the official page in `docsUrl`.
3. Mark numbers from unofficial sources with `unverified: true`.
4. Run `pnpm check:models` and `pnpm test`. The preset tests fail if a denied or billable model enters the default chain.

Rules that must keep holding: nothing that bills may enter the default chain, the billing guard runs before every
request, and keys are never stored by this plugin. Include a test with any change to switching or the guard.

## CI

The workflow files are in `docs/ci/`. GitHub only accepts them under `.github/workflows/`, and pushing there needs a
token with the `workflow` scope, so copy them over in the web editor (or push with such a token).
