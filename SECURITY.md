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

## Scanning

Two scanners run on every push, with different jobs.

| Scanner | Needs an account | Covers | Gate |
| --- | --- | --- | --- |
| Trivy | No | Filesystem CVEs, committed secrets, IaC misconfiguration | Reports to code scanning |
| Snyk Open Source | Yes | Dependency vulnerabilities | Blocking at high and above |
| Snyk Code (SAST) | Yes | Our own source | **Blocking** at high and above |
| Snyk IaC | Yes | Terraform for AWS and Azure | Blocking at high and above |
| Snyk Container | Yes | Base images in all three Dockerfiles | Blocking only when a fix exists |

Trivy needs no token, so every push and every fork gets a baseline. Snyk is
richer but needs `SNYK_TOKEN`; without it the job writes a note explaining
how to enable it and stops, rather than failing the build for a missing
optional integration.

### Why Snyk Code matters more here than Snyk Open Source

This repository has **zero runtime and zero development dependencies**
(ADR-0003), so the dependency scanner that most teams rely on finds nothing.
That is a genuinely strong position, and it also moves all the residual risk
into our own ~6 200 lines: HTTP parsing, token comparison, hashing, exact
arithmetic and an agent capability boundary. Static analysis of that code is
the scan that can actually find something, which is why it is the blocking
gate.

The dependency scan still runs, so the zero-dependency claim is evidenced on
every build rather than assumed.

### Container findings

Base-image CVEs are often unfixable until the upstream image is rebuilt, so
the container scan fails only when Snyk knows of an available fix
(`--fail-on=upgradable`). A scanner that goes red for something nobody can
act on teaches people to ignore it.

### Running the scans locally

```bash
npm i -g snyk          # or: brew install snyk / winget install Snyk.SnykCLI
snyk auth              # opens a browser once

npm run security           # dependencies, our code, and Terraform
npm run security:code      # SAST only
npm run security:iac       # Terraform only
make security-container    # builds the images, then scans them
```

`npm run security:report` writes `reports/snyk-code.sarif` for a SARIF
viewer. `reports/` is git-ignored.

### Triaging a finding

Fix it, or record the decision not to. Never edit `.snyk` by hand:

```bash
snyk ignore --id=<issue-id> --expiry=2027-01-31 \
  --reason="False positive: the value is a documented local-only placeholder"
```

Every ignore must carry an expiry and a reason. An ignore with no expiry is
a decision nobody revisits; one with no reason is a decision nobody can
review. The policy lives in `.snyk` and is version-controlled, so an ignore
is a reviewable change like any other.

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
