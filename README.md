# Telemetry Offer Ranking Platform

This repository contains a production-style service that implements the AI/data marketplace use case provided in the assessment. It focuses on the coded sub-task: comparing telemetry offers from multiple providers, normalising cost and quality, rejecting malformed or ineligible offers, and selecting the cheapest eligible price per canonical product using deterministic business rules.

The solution includes:
- A FastAPI service with mock provider endpoints and a `/best-offers` ranking API.
- Retry-aware provider fetch logic with timeout handling and graceful degradation.
- Decimal-based financial calculations to avoid floating-point error.
- Config-driven FX and margin snapshots with runtime reload support.
- Platform governance models for user access and payment-type restrictions.
- Terraform infrastructure modules that can onboard new teams and data domains by parameter.
- Automated tests, Docker packaging, and design/wiki documentation.

## Key repository layout

- `backend/app` — API application and ranking logic.
- `backend/tests` — pytest coverage for business logic and HTTP endpoints.
- `docs` — architecture, ADRs, and wiki pages.
- `infra/terraform` — parameterised infrastructure as code.
- `Dockerfile`, `docker-compose.yml`, `Makefile` — local run and packaging.

## Local startup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Then call:

```bash
curl http://localhost:8000/best-offers
```

## Running tests

```bash
cd backend
pytest -q
```

## Architecture summary

The service reads a validated configuration snapshot once per request, compares offers only within the same canonical product ID, and selects the lowest `costPer1000ValidEventsEUR` while applying tie-breakers for quality, recency, and provider ID. Invalid rows are rejected with stable reason codes and included in the response payload without invalidating the complete request. A partial result is returned when any provider is unavailable or any rows are excluded.

## Security and governance

The broader platform needs user-based access governance and payment-type restrictions. The repository includes a lightweight access-policy model and policy checks as a model for that requirement. It is intentionally separate from the offer-normalisation logic so the core ranking service remains deterministic and auditable.

## Documentation

- `docs/design/solution-design.md`
- `docs/design/adr/ADR-001-provider-offer-ranking.md`
- `docs/design/adr/ADR-002-access-governance.md`
- `docs/wiki/Home.md`
- `docs/wiki/User-Access-and-Payment-Controls.md`

## Terraform onboarding

The Terraform module accepts lists of teams and data domains and creates per-team infrastructure resources and access policy scaffolding dynamically.

Example:

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan -var-file=terraform.tfvars
```

## Notes

The code follows the use case requirements and includes a deterministic mock of the provider APIs, but does not implement a real payment processor or external marketplace orchestration. Those remain outside the coded scope and are described in the architecture docs as controlled boundaries.
