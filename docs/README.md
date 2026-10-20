# OpenGlance documentation

The repository root contains the standard open-source entry points: `README.md`, `LICENSE`,
`CONTRIBUTING.md`, `SECURITY.md`, and `CHANGELOG.md`. Maintainer-facing technical documents use English
as their single source. End-user documents may add a `.zh-CN` counterpart where a second language
materially improves installation, privacy, or product use.

## Documentation map

| Topic | Document | Audience and authority |
| --- | --- | --- |
| Product overview | [README](../README.md) · [简体中文](../README.zh-CN.md) | User-facing product entry |
| User guide | [English](user-guide.md) · [简体中文](user-guide.zh-CN.md) | Visual product tour and day-to-day use |
| Changes and compatibility | [Changelog](../CHANGELOG.md) | Version changes, verification, compatibility |
| Build from source | [Community Build guide](build-from-source.md) | Contributors and third-party builders |
| System architecture | [Architecture](architecture.md) | Cross-module behavior and invariants |
| MDX-lite reference | [Reference](mdx-lite-guide.md) | Syntax, allowlist, and renderer contract |
| MDX-lite demo | [Demo](mdx-lite-components-demo.mdx) | Development and visual regression fixture |
| Public User Guide Demo | [Runnable companion repository](https://github.com/openglance/openglance-example-knowledge-base) | User-facing first-run and main-feature demos |
| Hosted link privacy | [Hosted links](hosted-links.md) · [简体中文](hosted-links.zh-CN.md) | End-user metadata disclosure |
| Windows Preview | [English](windows-portable-guide.md) · [简体中文](windows-portable-guide.zh-CN.md) | Installation and security guidance |
| Usage analytics | [Specification](app-usage-analytics-spec.md) | Normative event, privacy, and metric contract |
| Document comments proposal | [Proposal](proposals/2026-10-20-document-comments.md) · [Implementation audit](proposals/2026-10-20-document-comments-research.md) | Proposed design and source evidence; not a shipped capability |
| Official release | [Release process](release.md) | Mango Future maintainer workflow |

Repository-specific agent rules remain in [AGENTS.md](../AGENTS.md). Contribution and vulnerability
reporting guidance remain in [CONTRIBUTING.md](../CONTRIBUTING.md) and
[SECURITY.md](../SECURITY.md).

The public User Guide Demo and this source repository are intentionally complementary. Stable
user-facing walkthroughs, main-feature examples, and screenshot content belong in the demo repository;
technical contracts, release schemas, security probes, and regression-only fixtures stay here.
Whenever a stable user-visible capability, workflow, or screenshot scenario changes, review the
matching demo page in the same maintenance cycle. Copied or adapted pages record their upstream source
path and revision so the demo cannot silently become a second authority.
