# Brainctl Profile Platform Design

## Goal

Design a separate hosted backend for account-based profile sharing and package distribution, while keeping local install/import/sync behavior in the existing `brainctl` CLI.

## Product Direction

The new service is a separate repository and deployment target. It is not an extension of the current local Node UI server. The hosted product is responsible for:

- account registration and login
- JWT-based authenticated API access
- profile creation and profile publishing
- package upload and download for shared profile bundles
- public browsing of the latest published profile version
- engagement and operational data such as stars, downloads, and audit logs

The local `brainctl` CLI remains responsible for importing packages, unpacking bundled MCP servers, installing dependencies locally, rewriting local paths, and syncing local agent configs.

Packed profile artifacts should classify MCP entries explicitly:

- `local`: installed or unpacked onto the user's machine before sync
- `remote`: hosted elsewhere and referenced by connection metadata only

This distinction belongs in the packed profile manifest itself so registry validation can reject ambiguous MCP definitions before publish, without forcing every local working profile file to migrate immediately.

## Stack

- Rust
- Axum
- SQLx
- PostgreSQL
- Cloudflare R2 for package objects
- JWT access tokens plus opaque rotating refresh tokens

For local development, use MinIO to emulate object storage and keep the API code path identical to production.

## Architecture

Use a Cargo workspace with four crates:

- `api`: Axum routes, handlers, middleware, extractors, HTTP DTOs, app bootstrap
- `application`: use-case services, command/query orchestration, DTO mapping, transaction boundaries
- `domain`: entities, value objects, repository traits, business rules
- `infrastructure`: SQLx repositories, JWT implementation, password hashing, R2 integration

This mirrors the layering of the reference JobJourney backend without copying .NET-specific patterns too literally. Rust should use composition over inheritance, traits over interfaces, and explicit transactions instead of a heavyweight inheritance-based model.

## Module Layout

Within each crate, group code by feature:

- `auth`
- `users`
- `profiles`
- `packages`
- `audit`

This keeps the codebase aligned with onion-style separation while avoiding giant flat folders such as one all-purpose `services/` directory.

## Data Model

### Core tables

- `users`
- `refresh_tokens`
- `profiles`
- `profile_versions`
- `package_assets`

### Additional tables required in v1

- `profile_stars`
- `profile_downloads`
- `audit_logs`

### Cached counters

Keep denormalized read counters on `profiles`:

- `stars_count`
- `downloads_count`

The event tables remain source of truth, and the cached counters keep list endpoints fast.

## Entity Conventions

The JobJourney-style `BaseEntity` concept should be translated into Rust using composition, not inheritance.

Recommended pattern:

- each entity has an explicit `id`
- shared audit fields live in an embedded struct such as `AuditFields`
- soft-delete fields are included only where needed

This avoids forcing Rust into an inheritance model that does not fit the language.

## Auth Model

- access token: short-lived JWT, approximately 15 minutes
- refresh token: opaque random token, approximately 30 days
- refresh tokens are stored hashed in Postgres
- refresh tokens rotate on every refresh
- logout revokes the active refresh token

Axum authentication should use middleware or extractors so protected handlers receive a typed current-user context rather than parsing claims manually.

## Public Product Surface

Public profile browsing should expose only the latest published version in v1.

Internally, keep immutable `profile_versions` from day one so that:

- publishing creates version history safely
- future rollback is possible
- future version-history UI does not require a schema rewrite

## API Shape

### Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`

### Profiles

- `GET /profiles`
- `GET /profiles/:slug`
- `POST /profiles`
- `PATCH /profiles/:id`
- `POST /profiles/:id/star`
- `DELETE /profiles/:id/star`

### Publish and packages

- `POST /profiles/:id/versions`
- `POST /profiles/:id/versions/:version_id/upload-url` or equivalent upload endpoint
- `POST /profiles/:id/versions/:version_id/publish`
- `GET /profiles/:slug/download`

## Storage Model

Package tarballs should be stored in Cloudflare R2, with Postgres storing metadata only.

Why:

- the API remains stateless
- versioned tarballs fit object storage naturally
- the free tier is sufficient for an MVP
- local-disk coupling is avoided from the start

## Out of Scope for This Backend

The hosted API does not install bundled MCPs onto user machines. It distributes versioned profile packages only. Local unpacking, dependency install, path rewrite, and agent sync remain CLI responsibilities.
