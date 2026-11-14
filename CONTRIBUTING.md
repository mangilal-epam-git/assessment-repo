# Contributing

## Branching

`main` is protected. Work happens on short-lived branches named
`feature/<topic>`, `fix/<topic>` or `chore/<topic>`, merged by pull request
with at least one approval and a green pipeline.

## Definition of done

A change is ready to merge when all of the following hold.

- `make verify` passes locally (static checks plus the full test suite with coverage thresholds).
- New behaviour has tests at the right level: pure logic in `test/unit`, anything crossing a process or socket boundary in `test/integration`.
- Public contract changes (request/response shapes, reason codes, metric names) are reflected in `docs/` in the same commit.
- Any architecturally significant decision is captured as an ADR in `docs/adr/`.
- No secrets, personal data or raw provider payloads appear in code, tests, logs or fixtures.

## Commit messages

Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`.
The scope should name the affected area, for example `feat(ranking): …`.

## Coding conventions

- ES modules, Node 22 LTS, no runtime dependencies without an ADR (see ADR-0003).
- Money and ratios use `Rational`; binary floating point must never touch a monetary comparison.
- Reason codes and error codes are part of the public contract: add new values, never rename existing ones.
- Every source file opens with a comment explaining why it exists, not what each line does.
- Comments explain intent and trade-offs. Code that needs a comment to explain *what* it does should be rewritten instead.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.
