# Contributing to brainctl

Thanks for wanting to help! This guide covers the basics.

## Ground rules

- Be respectful — see [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- Report security issues **privately** — see [`SECURITY.md`](SECURITY.md).
- One logical change per PR. Keep it focused.

## Development setup

```bash
git clone https://github.com/Rorogogogo/brainctl.git
cd brainctl
npm install

npm test                  # vitest
npm run build             # tsc + vite
npm run dev -- status     # run CLI from source
npx tsx src/cli.ts ui     # web dashboard from source
```

Point your agent's MCP config at `node <repo>/dist/cli.js mcp` to test MCP changes without publishing.

## Workflow

1. Fork the repo and create a feature branch: `git checkout -b feat/short-description`
2. Make your changes. Add or update tests.
3. Run `npm test` and `npm run build` locally — both must pass.
4. Commit with a descriptive message (we like Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
5. Open a PR against `main`. Fill in the PR template.
6. CI must pass and a maintainer must approve before merge.

## Coding conventions

See [`CLAUDE.md`](CLAUDE.md) for the codebase map. In short:

- ESM TypeScript — use `.js` extensions in relative imports.
- Service factory pattern: `createFooService(deps?)` returns a methods object.
- Atomic writes (temp + rename) with timestamped `.bak.*` backups for any agent config mutation.
- Tests live in `tests/` and use Vitest. Inject mock deps via the service factory's optional param.

## What makes a good PR

- Small, self-contained, easy to review.
- Has tests for new behavior or regressions fixed.
- Updates `README.md` if it changes public CLI / MCP surface.
- No secrets, personal paths, or unrelated formatting churn.

## Questions

Open a GitHub Discussion or a draft PR — both are fine for early-stage ideas.
