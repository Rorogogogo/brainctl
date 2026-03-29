# Brainctl Profile Platform Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a separate Rust/Axum backend for account-based brainctl profile sharing, package publishing, and latest-version public browsing.

**Architecture:** Create a Cargo workspace with `api`, `application`, `domain`, and `infrastructure` crates. Keep HTTP concerns in `api`, business use cases in `application`, entity/rule contracts in `domain`, and SQLx/JWT/R2 adapters in `infrastructure`.

**Tech Stack:** Rust, Axum, SQLx, PostgreSQL, Cloudflare R2, MinIO, JWT, Argon2, Serde, Tokio

---

### Task 1: Create the new repository skeleton

**Files:**
- Create: `<new-repo>/Cargo.toml`
- Create: `<new-repo>/.gitignore`
- Create: `<new-repo>/.env.example`
- Create: `<new-repo>/docker-compose.yml`
- Create: `<new-repo>/README.md`
- Create: `<new-repo>/migrations/`
- Create: `<new-repo>/crates/api/`
- Create: `<new-repo>/crates/application/`
- Create: `<new-repo>/crates/domain/`
- Create: `<new-repo>/crates/infrastructure/`

**Step 1: Write the failing structural check**

Create a simple shell-based verification target that asserts all workspace files and crate manifests exist.

**Step 2: Run the check to verify it fails**

Run: `find <new-repo> -maxdepth 3 | sort`
Expected: missing workspace files and crates.

**Step 3: Write minimal implementation**

- create the top-level Cargo workspace
- create crate manifests
- create source roots for each crate
- add `.env.example` for Postgres, JWT, and R2/MinIO settings
- add `docker-compose.yml` for local Postgres + MinIO

**Step 4: Run the check to verify it passes**

Run: `cargo metadata --format-version 1`
Expected: workspace resolves successfully.

**Step 5: Commit**

```bash
git add .
git commit -m "chore: scaffold rust profile platform workspace"
```

### Task 2: Add shared domain primitives

**Files:**
- Create: `<new-repo>/crates/domain/src/lib.rs`
- Create: `<new-repo>/crates/domain/src/shared/audit_fields.rs`
- Create: `<new-repo>/crates/domain/src/shared/ids.rs`
- Create: `<new-repo>/crates/domain/src/shared/mod.rs`

**Step 1: Write the failing test**

Add unit tests for `AuditFields` defaults and ID parsing helpers.

**Step 2: Run test to verify it fails**

Run: `cargo test -p domain shared`
Expected: compile failure because shared modules do not exist.

**Step 3: Write minimal implementation**

- add `AuditFields`
- add typed ID helpers or wrappers if used
- export shared modules from `domain`

**Step 4: Run test to verify it passes**

Run: `cargo test -p domain`
Expected: shared tests pass.

**Step 5: Commit**

```bash
git add crates/domain
git commit -m "feat: add shared domain primitives"
```

### Task 3: Define domain entities and repository traits

**Files:**
- Create: `<new-repo>/crates/domain/src/users/entity.rs`
- Create: `<new-repo>/crates/domain/src/users/repository.rs`
- Create: `<new-repo>/crates/domain/src/users/mod.rs`
- Create: `<new-repo>/crates/domain/src/profiles/entity.rs`
- Create: `<new-repo>/crates/domain/src/profiles/repository.rs`
- Create: `<new-repo>/crates/domain/src/profiles/rules.rs`
- Create: `<new-repo>/crates/domain/src/profiles/mod.rs`
- Create: `<new-repo>/crates/domain/src/packages/entity.rs`
- Create: `<new-repo>/crates/domain/src/packages/repository.rs`
- Create: `<new-repo>/crates/domain/src/packages/mod.rs`
- Create: `<new-repo>/crates/domain/src/audit/entity.rs`
- Create: `<new-repo>/crates/domain/src/audit/repository.rs`
- Create: `<new-repo>/crates/domain/src/audit/mod.rs`

**Step 1: Write the failing test**

Add tests covering:
- valid profile slug creation
- publish-state rules
- latest-only public selection logic

**Step 2: Run test to verify it fails**

Run: `cargo test -p domain profiles`
Expected: missing entity and rule definitions.

**Step 3: Write minimal implementation**

Define:
- `User`
- `RefreshToken`
- `Profile`
- `ProfileVersion`
- `PackageAsset`
- `ProfileStar`
- `ProfileDownload`
- `AuditLog`

Add repository traits for each aggregate root.

**Step 4: Run test to verify it passes**

Run: `cargo test -p domain`
Expected: domain tests pass.

**Step 5: Commit**

```bash
git add crates/domain
git commit -m "feat: define profile platform domain model"
```

### Task 4: Add database schema and migrations

**Files:**
- Create: `<new-repo>/migrations/<timestamp>_initial_schema.sql`
- Create: `<new-repo>/migrations/<timestamp>_indexes.sql`

**Step 1: Write the failing check**

Write a migration verification command in the README or Make target.

**Step 2: Run check to verify it fails**

Run: `sqlx migrate run`
Expected: no migration files or schema.

**Step 3: Write minimal implementation**

Create tables:
- `users`
- `refresh_tokens`
- `profiles`
- `profile_versions`
- `package_assets`
- `profile_stars`
- `profile_downloads`
- `audit_logs`

Add:
- unique constraints on email and profile slug
- unique `(user_id, profile_id)` for stars
- foreign keys and indexes for owner, slug, latest version lookup, and audit queries

**Step 4: Run check to verify it passes**

Run: `sqlx migrate run`
Expected: schema applies cleanly to local Postgres.

**Step 5: Commit**

```bash
git add migrations README.md
git commit -m "feat: add initial postgres schema"
```

### Task 5: Add infrastructure database and transaction layer

**Files:**
- Create: `<new-repo>/crates/infrastructure/src/lib.rs`
- Create: `<new-repo>/crates/infrastructure/src/db/pool.rs`
- Create: `<new-repo>/crates/infrastructure/src/db/tx.rs`
- Create: `<new-repo>/crates/infrastructure/src/db/mod.rs`

**Step 1: Write the failing test**

Add integration tests for opening a Postgres pool and beginning/committing a transaction.

**Step 2: Run test to verify it fails**

Run: `cargo test -p infrastructure db -- --nocapture`
Expected: missing db modules or connection wiring.

**Step 3: Write minimal implementation**

- load DB config from env
- create SQLx pool
- create transaction helper abstraction for application services

**Step 4: Run test to verify it passes**

Run: `cargo test -p infrastructure db`
Expected: DB infrastructure tests pass against local Postgres.

**Step 5: Commit**

```bash
git add crates/infrastructure
git commit -m "feat: add sqlx pool and transaction helpers"
```

### Task 6: Implement repository adapters

**Files:**
- Create: `<new-repo>/crates/infrastructure/src/repositories/users_pg.rs`
- Create: `<new-repo>/crates/infrastructure/src/repositories/profiles_pg.rs`
- Create: `<new-repo>/crates/infrastructure/src/repositories/packages_pg.rs`
- Create: `<new-repo>/crates/infrastructure/src/repositories/audit_logs_pg.rs`
- Create: `<new-repo>/crates/infrastructure/src/repositories/mod.rs`

**Step 1: Write the failing test**

Add integration tests for:
- user creation and lookup
- profile create/update/list latest public profiles
- version publish and latest selection
- star/unstar counters
- download event recording

**Step 2: Run test to verify it fails**

Run: `cargo test -p infrastructure repositories`
Expected: missing repository implementations.

**Step 3: Write minimal implementation**

Implement SQLx-backed repository traits using explicit queries and row mapping.

**Step 4: Run test to verify it passes**

Run: `cargo test -p infrastructure`
Expected: repository integration tests pass.

**Step 5: Commit**

```bash
git add crates/infrastructure
git commit -m "feat: implement postgres repositories"
```

### Task 7: Add auth infrastructure

**Files:**
- Create: `<new-repo>/crates/infrastructure/src/auth/jwt.rs`
- Create: `<new-repo>/crates/infrastructure/src/auth/password.rs`
- Create: `<new-repo>/crates/infrastructure/src/auth/mod.rs`

**Step 1: Write the failing test**

Add tests for:
- password hash verify
- JWT sign/verify
- expired token rejection
- refresh token hashing

**Step 2: Run test to verify it fails**

Run: `cargo test -p infrastructure auth`
Expected: auth adapters are missing.

**Step 3: Write minimal implementation**

- password hashing with Argon2
- access token issue/verify
- opaque refresh token generator and hashing helpers

**Step 4: Run test to verify it passes**

Run: `cargo test -p infrastructure auth`
Expected: auth tests pass.

**Step 5: Commit**

```bash
git add crates/infrastructure
git commit -m "feat: add jwt and password services"
```

### Task 8: Add object storage integration

**Files:**
- Create: `<new-repo>/crates/infrastructure/src/storage/r2.rs`
- Create: `<new-repo>/crates/infrastructure/src/storage/mod.rs`

**Step 1: Write the failing test**

Add storage tests covering:
- object key generation
- upload API contract
- download URL generation or streaming contract

**Step 2: Run test to verify it fails**

Run: `cargo test -p infrastructure storage`
Expected: storage service missing.

**Step 3: Write minimal implementation**

- implement S3-compatible client wrapper for R2/MinIO
- add upload and download helpers
- keep object metadata minimal and explicit

**Step 4: Run test to verify it passes**

Run: `cargo test -p infrastructure storage`
Expected: storage tests pass.

**Step 5: Commit**

```bash
git add crates/infrastructure
git commit -m "feat: add object storage adapter"
```

### Task 9: Build application auth services

**Files:**
- Create: `<new-repo>/crates/application/src/lib.rs`
- Create: `<new-repo>/crates/application/src/common/errors.rs`
- Create: `<new-repo>/crates/application/src/common/mod.rs`
- Create: `<new-repo>/crates/application/src/auth/commands.rs`
- Create: `<new-repo>/crates/application/src/auth/service.rs`
- Create: `<new-repo>/crates/application/src/auth/mod.rs`

**Step 1: Write the failing test**

Add tests for:
- register user
- login success/failure
- refresh token rotation
- logout revocation

**Step 2: Run test to verify it fails**

Run: `cargo test -p application auth`
Expected: auth use cases missing.

**Step 3: Write minimal implementation**

Implement use cases with repository traits and auth adapters. Keep HTTP out of the crate.

**Step 4: Run test to verify it passes**

Run: `cargo test -p application auth`
Expected: application auth tests pass.

**Step 5: Commit**

```bash
git add crates/application
git commit -m "feat: add application auth flows"
```

### Task 10: Build profile and package application services

**Files:**
- Create: `<new-repo>/crates/application/src/profiles/commands.rs`
- Create: `<new-repo>/crates/application/src/profiles/service.rs`
- Create: `<new-repo>/crates/application/src/profiles/mod.rs`
- Create: `<new-repo>/crates/application/src/packages/service.rs`
- Create: `<new-repo>/crates/application/src/packages/mod.rs`

**Step 1: Write the failing test**

Add tests for:
- create profile
- update profile metadata
- create draft version
- publish version
- latest public profile query
- star/unstar
- record download

**Step 2: Run test to verify it fails**

Run: `cargo test -p application profiles`
Expected: profile/package use cases missing.

**Step 3: Write minimal implementation**

Implement services that orchestrate:
- repository access
- transaction boundaries
- publish invariants
- counter updates
- audit log creation

**Step 4: Run test to verify it passes**

Run: `cargo test -p application`
Expected: application profile/package tests pass.

**Step 5: Commit**

```bash
git add crates/application
git commit -m "feat: add profile publish and download services"
```

### Task 11: Add API crate and app bootstrap

**Files:**
- Create: `<new-repo>/crates/api/src/main.rs`
- Create: `<new-repo>/crates/api/src/app.rs`
- Create: `<new-repo>/crates/api/src/config.rs`

**Step 1: Write the failing test**

Add a smoke test that boots the Axum app and calls `/health`.

**Step 2: Run test to verify it fails**

Run: `cargo test -p api health`
Expected: API crate missing.

**Step 3: Write minimal implementation**

- load env config
- initialize pool, storage client, and service wiring
- expose `/health`

**Step 4: Run test to verify it passes**

Run: `cargo test -p api`
Expected: app boots and health route passes.

**Step 5: Commit**

```bash
git add crates/api
git commit -m "feat: add axum app bootstrap"
```

### Task 12: Implement auth HTTP layer

**Files:**
- Create: `<new-repo>/crates/api/src/http/routes/auth.rs`
- Create: `<new-repo>/crates/api/src/http/handlers/auth.rs`
- Create: `<new-repo>/crates/api/src/http/dto/auth.rs`
- Create: `<new-repo>/crates/api/src/http/middleware/auth.rs`
- Create: `<new-repo>/crates/api/src/http/extractors/current_user.rs`

**Step 1: Write the failing test**

Add API tests for:
- register
- login
- refresh
- logout
- `GET /me`

**Step 2: Run test to verify it fails**

Run: `cargo test -p api auth`
Expected: routes and handlers missing.

**Step 3: Write minimal implementation**

- define request/response DTOs
- wire handlers to application auth services
- add bearer-token middleware or extractor

**Step 4: Run test to verify it passes**

Run: `cargo test -p api auth`
Expected: auth API tests pass.

**Step 5: Commit**

```bash
git add crates/api
git commit -m "feat: add auth api and jwt middleware"
```

### Task 13: Implement profile HTTP layer

**Files:**
- Create: `<new-repo>/crates/api/src/http/routes/profiles.rs`
- Create: `<new-repo>/crates/api/src/http/handlers/profiles.rs`
- Create: `<new-repo>/crates/api/src/http/dto/profiles.rs`

**Step 1: Write the failing test**

Add API tests for:
- public profile list
- public profile detail by slug
- create profile
- update profile
- star / unstar

**Step 2: Run test to verify it fails**

Run: `cargo test -p api profiles`
Expected: routes/handlers not implemented.

**Step 3: Write minimal implementation**

Map API requests into profile application services and return latest-only public responses.

**Step 4: Run test to verify it passes**

Run: `cargo test -p api profiles`
Expected: profile API tests pass.

**Step 5: Commit**

```bash
git add crates/api
git commit -m "feat: add profile browsing and star api"
```

### Task 14: Implement package upload/publish/download HTTP layer

**Files:**
- Create: `<new-repo>/crates/api/src/http/routes/packages.rs`
- Create: `<new-repo>/crates/api/src/http/handlers/packages.rs`
- Create: `<new-repo>/crates/api/src/http/dto/packages.rs`

**Step 1: Write the failing test**

Add API tests for:
- create draft version
- create upload URL or direct upload initiation
- publish version
- download current published package
- record download analytics

**Step 2: Run test to verify it fails**

Run: `cargo test -p api packages`
Expected: package routes/handlers missing.

**Step 3: Write minimal implementation**

- draft version creation
- upload orchestration
- publish endpoint
- latest-package download endpoint

**Step 4: Run test to verify it passes**

Run: `cargo test -p api packages`
Expected: package API tests pass.

**Step 5: Commit**

```bash
git add crates/api
git commit -m "feat: add package publish and download api"
```

### Task 15: Add audit logging and counter updates end-to-end

**Files:**
- Modify: `<new-repo>/crates/application/src/auth/service.rs`
- Modify: `<new-repo>/crates/application/src/profiles/service.rs`
- Modify: `<new-repo>/crates/application/src/packages/service.rs`
- Modify: `<new-repo>/crates/infrastructure/src/repositories/audit_logs_pg.rs`

**Step 1: Write the failing test**

Add tests that assert:
- registration creates audit log
- profile create/update creates audit log
- publish creates audit log
- download increments counters and creates event rows

**Step 2: Run test to verify it fails**

Run: `cargo test --workspace audit`
Expected: missing audit side effects.

**Step 3: Write minimal implementation**

Implement audit event writes and cached counter updates in the application layer.

**Step 4: Run test to verify it passes**

Run: `cargo test --workspace`
Expected: audit and counter tests pass.

**Step 5: Commit**

```bash
git add crates/application crates/infrastructure
git commit -m "feat: add audit logs and profile counters"
```

### Task 16: Add documentation and developer workflow

**Files:**
- Modify: `<new-repo>/README.md`
- Modify: `<new-repo>/.env.example`
- Modify: `<new-repo>/docker-compose.yml`

**Step 1: Write the failing check**

Review the repo as a new contributor and note missing setup steps.

**Step 2: Run the check to verify it fails**

Run: `sed -n '1,240p' README.md`
Expected: missing complete setup instructions.

**Step 3: Write minimal implementation**

Document:
- workspace layout
- local Postgres + MinIO startup
- migration commands
- test commands
- env vars
- R2 vs MinIO configuration

**Step 4: Run the check to verify it passes**

Run: `cargo test --workspace && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings`
Expected: full verification passes.

**Step 5: Commit**

```bash
git add README.md .env.example docker-compose.yml
git commit -m "docs: add setup and development workflow"
```

### Task 17: Final verification

**Files:**
- Verify: entire workspace

**Step 1: Run migrations**

Run: `sqlx migrate run`
Expected: schema applies cleanly.

**Step 2: Run tests**

Run: `cargo test --workspace`
Expected: all tests pass.

**Step 3: Run formatting and linting**

Run: `cargo fmt --check`

Run: `cargo clippy --workspace --all-targets -- -D warnings`

Expected: no formatting issues, no lint errors.

**Step 4: Boot the API**

Run: `cargo run -p api`
Expected: Axum server starts successfully with configured routes.

**Step 5: Manual smoke checks**

Use `curl` or an API client to verify:
- register/login/refresh/logout
- create profile
- upload package
- publish profile
- browse latest public profile
- download published package
- star and unstar

**Step 6: Commit**

```bash
git add .
git commit -m "chore: verify profile platform api"
```
