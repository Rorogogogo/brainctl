# Publish design (working notes)

Status: not implemented. Replaces an earlier "pack into `.brainctl/packs/`" design — see commit history if curious.

## Decision: no separate pack folder

We considered a two-step `pack` (build a `.brainctl/packs/<name>/` artifact) → `publish` (push that to GitHub) flow. We dropped it. Reasons:

- Two folders for one logical thing.
- Drift risk between profile and pack.
- For solo users with one profile published once, the staging step is overkill.

Instead, `publish` is a single verb that turns a profile into a GitHub repo at the moment of invocation. No persistent pack folder.

## Glossary

- **Snapshot** — read live agent config (Claude/Codex/Gemini) into `.brainctl/profiles/<name>/`. Implemented.
- **Apply** — write a profile into a live agent. Implemented.
- **Export** — produce a local archive of a profile (tarball or folder). Already exists. Used for ad-hoc file-based sharing.
- **Publish** (target, not implemented) — distribute a profile via GitHub-backed registry. Generates a clean, redacted, repo-ready directory in a temp dir, `git init`s it, pushes to GitHub, then deletes the temp dir.
- **Install** (target, not implemented) — fetch a published profile by name (`brainctl install user/foo`) and apply it locally.

## Publish flow (target)

```
brainctl profile publish my-stack \
  --repo github:roro/my-stack \
  --version 0.1.0
```

What it does:

1. Load profile from `.brainctl/profiles/my-stack/`.
2. Redact secrets in-memory using existing `credential-redaction-service.ts`.
3. Build a temp directory containing:
   - `profile.yaml` (redacted)
   - `manifest.yaml` (existing portable-profile manifest)
   - `brainctl.package.yaml` (publish metadata: name, version, description, author, repo, created_at, brainctl_version)
   - `mcps/`, `plugins/`, `skills/`, `memory/`
   - `README.md`, `.gitignore`, `.env.example`
4. `git init` in temp dir, commit, add remote, push to GitHub.
5. Delete temp dir.

Net effect: GitHub repo exists at `roro/my-stack`. Nothing left on local disk except the original profile.

## Open questions for publish

1. **Repo creation** — does `publish` create the GitHub repo if it doesn't exist (via `gh` CLI or GitHub API), or does the user pre-create it and we just push?
2. **Versioning** — semver in `brainctl.package.yaml`, but how does that map to git? Tag each publish as `v0.1.0`, push tag? Just a commit?
3. **Re-publish** — second publish of the same profile: force-push? Append commit? Tag bump only?
4. **Registry index** — is there a curated `brainctl/registry` index repo, or is convention `<user>/<name>` enough? `brainctl install user/foo` works via `git clone https://github.com/user/foo` either way.
5. **Auth** — relies on user's existing `gh` auth or a GitHub PAT in env? Probably `gh` CLI for v1 (matches "I assume you have it" stance).
6. **Dry-run** — `--dry-run` to write the temp dir to `~/tmp/brainctl-publish-xyz/` and skip git/push, so the user can inspect before actually publishing.

## Install flow (target, sketch only)

```
brainctl install roro/my-stack
brainctl install roro/my-stack@0.1.0   # specific version (git tag)
```

What it does:

1. `git clone https://github.com/roro/my-stack /tmp/...`
2. Read `brainctl.package.yaml`, validate version + brainctl_version compatibility.
3. Read `profile.yaml`, scan for `${credentials.*}` placeholders.
4. Prompt for any missing credentials (or accept `-c key=value` flags).
5. Copy the cloned contents into `.brainctl/profiles/<name>/`, substituting credentials.
6. Optionally apply immediately with `--apply --agent <list>`.

## What we keep from existing code

- `portable-profile-pack-service.ts` — its `format: 'folder'` path produces almost exactly what publish needs (profile + manifest + bundled dirs + repo-ready files). Publish would call it with a temp output path.
- `credential-redaction-service.ts` — unchanged, reused as-is.
- `writeRepoReadyFiles()` — already generates README/.gitignore/.env.example.

We add:
- `writePackageManifest()` to emit `brainctl.package.yaml`.
- `profile-publish-service.ts` orchestrating: pack-to-temp → git init/commit/push → cleanup.
- `profile publish` CLI command.
- `brainctl install` command + matching service.
- UI button on each profile row: "Publish" (opens a small form for repo + version).

## What we don't do

- No `.brainctl/packs/` directory. Ever.
- No pack-then-push two-step CLI. `publish` is one shot.
- No pre-extraction registry metadata (no `requires_credentials`, no `agents` fields). Installer scans `profile.yaml` at install time for `${credentials.*}`.

## Next session checklist

- [ ] Decide answers to the six open questions above.
- [ ] Define the minimal `brainctl.package.yaml` schema (Zod).
- [ ] Implement `profile-publish-service.ts` (pack-to-temp + git push + cleanup).
- [ ] Implement `profile publish` CLI with `--repo`, `--version`, `--dry-run`.
- [ ] Implement `brainctl install <user>/<name>[@version]` resolver.
- [ ] UI: add Publish button to profile rows in `ProfilesDrawer.tsx`.
