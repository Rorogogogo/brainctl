# Pack design (working notes)

Status: not implemented. This file captures the shared understanding so we can resume later.

## Glossary (so we stop confusing terms)

- **Snapshot** — read a live agent's config (Claude/Codex/Gemini) and save it as a local profile under `.brainctl/profiles/<name>/`. Already implemented (`profile-snapshot-service.ts`).
- **Apply** — write a profile's contents into a live agent. Already implemented (`profile-apply-service.ts`, ⚡ button in UI).
- **Export (current)** — produce a portable artifact of a profile. Today this is what `portable-profile-pack-service.ts` does, with two formats:
  - `tarball` → `<cwd>/<name>.tar.gz`
  - `folder` → `<cwd>/<name>/` directory with repo-ready files (`README.md`, `.gitignore`, `.env.example`) via `writeRepoReadyFiles()`
- **Pack (target)** — distinct from Export. Produces a **publishable package directory** intended to be registered on a brainctl registry (GitHub-backed). Sharing happens via registry name, not by handing over a tarball.

## What Pack is for

You snapshot in order to share. Sharing happens through a registry. The registry holds packages. So Pack = "convert a profile/snapshot into the directory layout the registry expects" + (optionally) push it.

End user flow (target):

1. `brainctl profile snapshot --agent claude --as my-stack`
2. `brainctl profile pack my-stack` → produces `./packs/my-stack/` ready to commit + push
3. Push to GitHub (manual or `brainctl profile pack my-stack --push`)
4. Someone else: `brainctl install user/my-stack` → registry resolves → clones → applies

## Open spec questions

These need answers before we build:

1. **Package layout** — what does the directory contain?
   - `brainctl.package.yaml` (manifest: name, version, author, repo, description, agents, requires-credentials)
   - `profile.yaml` (existing)
   - `manifest.yaml` (existing portable-profile manifest — keep, replace, or merge with package manifest?)
   - `mcps/`, `plugins/`, `skills/`, `memory/` (existing profile folder layout)
   - `README.md`, `.env.example`, `.gitignore` (existing repo-ready files)
2. **Registry shape** — where does discovery happen?
   - Single curated index repo (e.g., `brainctl/registry` with a `packages.yaml`)?
   - OR convention-based: any GitHub repo named `brainctl-<name>` is installable?
   - OR both: index for curated, fallback to `user/repo` direct install?
3. **Versioning** — semver? Git tags? Latest commit on `main`? How does `brainctl install foo@1.2.0` resolve?
4. **Push path** — does `pack` ever touch GitHub, or is it strictly local-output and the user pushes manually?
5. **Credentials** — same redaction-to-`${credentials.<key>}` placeholders as today's export, plus a `requires-credentials` field in the package manifest so the installer knows what to prompt for. Confirm.
6. **UI surface** — per-profile Pack button (drawer), or a dedicated "Publish" panel where you fill name/version/repo metadata before packing?

## Output location

Default should NOT be the project root (clutters cwd). Proposal:

```
<cwd>/.brainctl/packs/<name>/
```

Configurable via `--out` flag and `outputPath` API field. Same convention works for both CLI and UI.

## Relationship to existing code

- `portable-profile-pack-service.ts` already does ~80% of Pack's job (staging, redaction, repo-ready files, folder format). Pack likely reuses it under the hood with:
  - new `format: 'package'` (or rename `'folder'` → `'package'` and drop the old name)
  - a new `writePackageManifest()` step alongside `writeRepoReadyFiles()`
  - default output path under `.brainctl/packs/<name>/`
- The credential redaction service (`credential-redaction-service.ts`) is reused as-is.
- A new `package-manifest.ts` module defines the `brainctl.package.yaml` schema (Zod).

## What was almost-built and reverted

- A Pack button was added to `web/src/profiles/ProfilesDrawer.tsx` calling `POST /api/profiles/export` with `format: 'tarball'`. That is **export**, not pack. Either rename it or remove it before shipping. The route accepts `format` already (`src/ui/routes.ts`).

## Next session checklist

- [ ] Decide answers to the six open spec questions above.
- [ ] Define `brainctl.package.yaml` schema.
- [ ] Decide registry mechanism (single index vs convention vs both).
- [ ] Implement `pack` as a separate service or `format: 'package'` extension to `portable-profile-pack-service.ts`.
- [ ] Replace the current "Pack" UI button (which is really export) with the real Pack flow, OR keep both with distinct labels (Export tarball / Pack package).
- [ ] Implement `brainctl install <name>` resolver against the chosen registry.
