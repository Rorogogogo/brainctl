# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the CLI and runtime code. Keep argument parsing in `src/commands/`, business logic in `src/services/`, context assembly in `src/context/`, agent adapters in `src/executor/`, and dashboard server code in `src/ui/`. The React/Vite frontend lives in `web/src/` and builds into `dist/web/`. Tests live in `tests/` and generally mirror feature areas, for example `run-cli.test.ts` and `ui-server.test.ts`. Planning notes belong in `docs/plans/`; sample workspace files live in `ai-stack.yaml` and `memory/`.

## Build, Test, and Development Commands
`npm run dev -- <args>` runs the CLI directly from TypeScript source, for example `npm run dev -- status`.
`npm test` runs the full Vitest suite.
`npx vitest run tests/config.test.ts` runs a single test file while iterating.
`npm run build` builds both the Node CLI and the web dashboard.
`npm run build:server` compiles only `src/` with `tsc`; `npm run build:web` builds only the Vite app in `web/`.
`npm test && npm run build` matches the package prepublish check.

## Coding Style & Naming Conventions
Use strict TypeScript with ESM semantics. Relative imports in `.ts` files should keep the existing `.js` extension style required by the `NodeNext` config. Follow the current 2-space indentation, semicolons, and small focused modules. Use `PascalCase` for React components (`RunView.tsx`), `camelCase` for functions and variables, and kebab-case for service-oriented filenames such as `run-service.ts`.

## Testing Guidelines
Vitest is configured for the Node environment and discovers `tests/**/*.test.ts`. Add or update tests with every behavior change, especially around command parsing, service orchestration, executor behavior, and UI/API routes. Prefer deterministic temp-directory fixtures over machine-specific state. There is no formal coverage threshold, but new features should ship with regression coverage.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commit prefixes such as `feat:`, `fix:`, and `chore:`; keep subjects short and imperative. Pull requests should summarize user-visible behavior changes, list verification commands run, and link related issues when available. Include screenshots for `web/` changes and terminal examples for CLI UX changes. If a change affects config shape or workflow, update `README.md` and any relevant note in `docs/plans/`.

## Configuration Notes
Target Node `>=18.18.0`. `ai-stack.yaml` is resolved from the current working directory, so test commands from a realistic project folder. Avoid hardcoded local paths; use path helpers in code and temporary directories in tests.
