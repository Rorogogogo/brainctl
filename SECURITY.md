# Security Policy

## Supported versions

Only the latest published version on npm receives security fixes.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Report vulnerabilities privately via GitHub Security Advisories:

👉 **https://github.com/Rorogogogo/brainctl/security/advisories/new**

Please include:

- A description of the issue and its impact
- Steps to reproduce (proof-of-concept if available)
- Affected versions
- Any suggested mitigation

You'll get an initial response within **72 hours**. We'll coordinate a fix and a disclosure timeline with you before publishing any advisory.

## Scope

In scope:

- The `brainctl` CLI and MCP server
- The web dashboard shipped in this repo
- Agent config read/write paths (atomic write, backup, path traversal, etc.)
- Portable profile pack/import (archive extraction, credential handling)

Out of scope:

- Vulnerabilities in upstream agent CLIs (`claude`, `codex`, `gemini`) — report to those projects directly
- Issues requiring a pre-compromised machine or privileged local access
