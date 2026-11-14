# Security policy

## Reporting a vulnerability

Email `security@vectorharbor.example` with a description, affected version or
commit, and reproduction steps. Do not open a public issue. Acknowledgement
within one business day; triage within three.

## Scope of this repository

This repository contains the provider-offer normalisation and ranking slice of
the VectorHarbor data marketplace, its mock provider endpoints, and the
infrastructure-as-code to deploy it. The full platform threat model is in
[docs/architecture/09-threat-model.md](docs/architecture/09-threat-model.md).

## Controls implemented in this slice

- No runtime third-party dependencies, which removes the transitive supply-chain surface for the service itself (ADR-0003).
- Containers run as a non-root user, read-only, with all Linux capabilities dropped and `no-new-privileges` set.
- Strict, closed input validation on every provider row; unknown fields are rejected rather than ignored.
- Provider identity is taken from configuration, never from a payload field, so a provider cannot impersonate another.
- Response bodies from providers are size-capped and never echoed back to callers; error bodies carry a stable code, a safe message and a request id only.
- Structured logs are redacted by a deny-list covering credentials, payment identifiers, vehicle identifiers and geolocation.
- The admin reload endpoint requires a bearer token compared in constant time.
- Per-attempt timeouts, a bounded retry budget, a per-request deadline and concurrency shedding bound the blast radius of a slow or hostile upstream.

## Known limitations in this slice

- The admin token is a single shared secret. Production should use workload identity and a short-lived credential; see [docs/architecture/08-security.md](docs/architecture/08-security.md).
- Provider quality claims are trusted after validation, as the brief specifies. Independent verification is designed in [docs/architecture/05-data-quality-and-provenance.md](docs/architecture/05-data-quality-and-provenance.md) but not implemented here.
- Payment, notification and FX integrations are external interfaces and are mocked. No cardholder data is handled anywhere in this repository.
