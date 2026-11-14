# ADR-0003: Zero third-party runtime dependencies

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Platform engineering, security

## Context

The brief prohibits turnkey marketplace, telematics-aggregation and
agent-orchestration products while permitting open-source libraries. The
service must be production-grade, securely configured and deployable.

A typical Node.js service of this shape would pull in a web framework, a
validation library, a decimal library, a logger, a metrics client and an HTTP
client — commonly 200 to 400 transitive packages.

## Options considered

### Option A — Conventional framework stack

Express or Fastify, Zod, decimal.js, Pino, prom-client, undici. Fast to
write, familiar to any Node developer, well-documented.

Against: a large transitive dependency tree is the dominant supply-chain
attack surface in the Node ecosystem, and recent history (event-stream,
ua-parser-js, colors, node-ipc) shows the risk is realised, not theoretical.
It also brings continuous upgrade pressure and licence-tracking obligations.

### Option B — Zero runtime dependencies

Node 22 provides everything needed: `node:http`, global `fetch`, `BigInt`,
`node:test`, `node:crypto`, `AbortController`, `fs.watch`.

### Option C — A small vetted set

A middle path: perhaps three audited libraries with shallow trees.

Rejected because the policy boundary becomes arbitrary. "Three dependencies"
drifts to thirty within a year without a principle to hold the line, whereas
"zero, and an ADR for any exception" is self-enforcing.

## Decision

**Zero third-party runtime dependencies.** Any addition requires a new ADR.

Development-time tooling is not covered by this decision; the test runner,
container tooling and CI actions are all standard. In practice the
`devDependencies` list is also empty, since `node --test` and a pair of
hand-written check scripts cover linting-equivalent concerns.

## Consequences

**Positive.** The deployed artefact's attack surface is the Node.js runtime
alone — a meaningful security posture for a service that prices transactions.
No licence obligations to track ([23](../architecture/23-boundaries-and-licensing.md)).
No dependency upgrade treadmill and no Dependabot noise. Container images are
small and build fast. Behaviour is fully owned: when something misbehaves, the
code is in the repository.

**Negative.** Roughly 600 lines of code that a library would have provided —
routing, metrics exposition, structured logging, rational arithmetic. Written
once, tested thoroughly, and unlikely to change; the ongoing cost is far lower
than the one-off cost suggests. The team must understand `node:http` rather
than a framework's abstractions, and some ecosystem conveniences (OpenAPI
generation, middleware plugins) are unavailable.

**Verified, not assumed.** The hand-written pieces are measured, not merely
believed to be adequate: the rational arithmetic runs at 2.25 µs per row and
the HTTP layer sustained 890 rps under contention
([12](../architecture/12-capacity-plan.md)).

## Revisit when

A requirement genuinely needs a complex, well-audited library — TLS
termination in-process, a database driver, or an OpenTelemetry exporter.
Database access in particular will require a driver; that will be its own
ADR, and the dependency will be scoped to the service that needs it rather
than adopted platform-wide.
