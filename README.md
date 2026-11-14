# VectorHarbor Mobility — Telematics Data Marketplace

Solution architecture and reference implementation for VectorHarbor's
cloud-native telematics data marketplace and supervised fleet assistant.

Two services are implemented:

1. **Best offers** — provider-offer normalisation and ranking. Combines
   telemetry offers from two providers and returns the best **eligible**
   offer per canonical product, comparing on quality-normalised cost rather
   than headline bundle price. This is the coding sub-task from the brief.
2. **Fleet assistant** — the supervised agent workflow, with a browser
   console. The assistant proposes maintenance work; a human approves;
   nothing happens otherwise. Runs with no API key by default.

| | |
| --- | --- |
| **Architecture documentation** | [`docs/`](docs/README.md) — 23 documents, 12 ADRs, Mermaid diagrams |
| **Infrastructure as code** | [`infrastructure/`](infrastructure/README.md) — Terraform for AWS and Azure |
| **Tests** | 288 passing, 96.2% line coverage (thresholds enforced) |
| **Runtime dependencies** | **Zero** — Node.js standard library only |

---

## Quick start

Two ways to run it. Both work on Windows, macOS and Linux.

### Option A — Docker (nothing to install but Docker)

```bash
git clone https://github.com/mangilal-epam-git/assessment-repo.git
cd assessment-repo
git checkout feature/vhm-best-offers-platform

docker compose up --build
```

Then in another terminal:

```bash
curl http://localhost:8080/best-offers
```

### Option B — Node.js directly (fastest feedback loop)

```bash
git clone https://github.com/mangilal-epam-git/assessment-repo.git
cd assessment-repo
git checkout feature/vhm-best-offers-platform

npm test          # 188 tests with coverage thresholds
npm run demo      # start everything, print the result, exit
```

`npm run demo` needs no arguments and no setup. It starts the mock providers
and the service on ephemeral ports with the clock pinned to the evaluation
instant from the brief, prints the full `/best-offers` response, and shuts
down cleanly.

### Expected output

```json
{
  "asOf": "2026-06-15T10:05:00Z",
  "currency": "EUR",
  "fxVersion": "fx-demo-1",
  "marginVersion": "margin-demo-1",
  "partial": true,
  "unavailableProviders": [],
  "rejectedRows": [
    { "providerId": "telemetry1", "rowIndex": 3, "reason": "QUALITY_BELOW_MINIMUM" },
    { "providerId": "telemetry1", "rowIndex": 4, "reason": "OBSERVATION_STALE" }
  ],
  "offers": [
    {
      "productId": "eu-north-diagnostics-hour",
      "providerId": "telemetry1",
      "eventCount": 50000,
      "validEventCount": 47000,
      "qualityRatio": "0.9400",
      "customerBundleEUR": "9.11",
      "costPer1000ValidEventsEUR": "0.193787",
      "observedAt": "2026-06-15T10:01:00Z",
      "expiresAt": "2026-06-15T10:16:00Z"
    }
    // ... four more, sorted by productId
  ]
}
```

Every one of those numbers is derived by hand in
[docs/coding-task/worked-examples.md](docs/coding-task/worked-examples.md).

---

## Prerequisites by operating system

**Required:** Node.js 22 LTS. **Optional:** Docker (for the container
workflow), Terraform and a cloud CLI (for deployment only).

### Windows

Using [winget](https://learn.microsoft.com/windows/package-manager/), built
into Windows 11:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Docker.DockerDesktop        # optional
winget install Hashicorp.Terraform         # optional, for deployment
winget install Amazon.AWSCLI               # optional, for AWS
winget install Microsoft.AzureCLI          # optional, for Azure
winget install Git.Git
```

Or with [Chocolatey](https://chocolatey.org/) in an elevated prompt:

```powershell
choco install nodejs-lts docker-desktop terraform awscli azure-cli git -y
```

Notes for Windows:

- Use **Git Bash**, **PowerShell** or **WSL2**. The `make` targets and
  `scripts/run-local.sh` need a bash shell: Git Bash or WSL2. Everything
  else (`npm test`, `npm run demo`, `docker compose`) works in PowerShell.
- Docker Desktop requires WSL2. Enable it with `wsl --install` and restart.
- If `npm` scripts fail with an execution-policy error in PowerShell:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### macOS

With [Homebrew](https://brew.sh/):

```bash
brew install node@22
brew install --cask docker          # optional
brew install terraform awscli azure-cli git   # optional, for deployment
```

If you manage several Node versions, `nvm use` picks up the `.nvmrc` in this
repository.

On Apple Silicon the images build natively for `arm64`. To match the
production `x86_64` platform exactly:
`docker build --platform linux/amd64 .`

### Linux (Ubuntu / Debian)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Docker (optional)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in

# Terraform (optional, for deployment)
wget -O- https://apt.releases.hashicorp.com/gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
  https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install -y terraform
```

### Linux (Fedora / RHEL)

```bash
sudo dnf module install nodejs:22/common
sudo dnf install -y git moby-engine
sudo dnf config-manager --add-repo \
  https://rpm.releases.hashicorp.com/fedora/hashicorp.repo
sudo dnf install -y terraform
```

### Verify your toolchain

```bash
node --version       # v22.x or later  (required)
npm --version        # 10.x or later   (required)
docker --version     # 24.x or later   (optional)
terraform version    # 1.9.x           (optional)
```

Only Node.js is required to run the service and the full test suite.

---

## Running locally

### Everything, in one command

```bash
docker compose up --build        # or: make up
```

| Service | URL |
| --- | --- |
| Best offers | http://localhost:8080/best-offers |
| Health | http://localhost:8080/healthz |
| Readiness | http://localhost:8080/readyz |
| Metrics | http://localhost:8080/metrics |
| Mock provider 1 | http://localhost:8081/provider/telemetry1 |
| Mock provider 2 | http://localhost:8081/provider/telemetry2 |
| **Fleet assistant console** | **http://localhost:8082/** (start with `npm run agent`) |

Stop with `docker compose down -v` (or `make down`).

### Without Docker

```bash
./scripts/run-local.sh      # bash: Linux, macOS, Git Bash, WSL
```

Starts both processes, waits for them to be healthy, and stops both cleanly
on Ctrl+C.

On Windows PowerShell, run the two processes in separate terminals:

```powershell
# Terminal 1
node src/mock-providers/server.js

# Terminal 2
$env:PROVIDER_TELEMETRY1_URL="http://127.0.0.1:8081/provider/telemetry1"
$env:PROVIDER_TELEMETRY2_URL="http://127.0.0.1:8081/provider/telemetry2"
$env:FIXED_CLOCK="2026-06-15T10:05:00Z"
node src/best-offers/server.js
```

---

## Testing

```bash
npm test                  # everything, with coverage thresholds enforced
npm run test:unit         # unit tests only, sub-second
npm run test:integration  # integration tests, real sockets and files
npm run check             # static checks + Terraform consistency, offline
npm run smoke             # contract check against a running instance
make verify               # check + test, exactly what CI runs
```

Coverage thresholds (90% lines, 90% functions, 80% branches) are enforced by
the test command, so `npm test` fails if coverage regresses. Current:
**97.0% lines, 91.1% functions, 95.3% branches**.

Test strategy, including the four real bugs the suite caught during
development, is in
[docs/coding-task/test-strategy.md](docs/coding-task/test-strategy.md).

---

## The supervised fleet assistant

```bash
npm run agent
```

Then open **http://localhost:8082/**. No API key, no network and no model
are required: the default planner is deterministic and runs in-process.

Ask it to review the fleet. It inspects vehicles, prices the work and drafts
a proposal — then stops. Approving is a separate act, and raising the work
order is a third. Press **try to make it act** to ask it to apply a parking
brake and self-approve, and watch it refuse: no such tool exists, there is no
credential it can use to approve itself, and the attempt is recorded in a
hash-chained ledger you can verify from the page.

To use a real model instead:

```bash
MODEL_BACKEND=anthropic MODEL_API_KEY=sk-ant-... npm run agent
MODEL_BACKEND=openai    MODEL_API_KEY=sk-...     npm run agent
MODEL_BACKEND=ollama    MODEL_NAME=llama3.1      npm run agent   # local, no key
```

The safety properties are identical on every backend, which is the point.
Full walkthrough: [docs/coding-task/agent-demo.md](docs/coding-task/agent-demo.md).

## Things worth trying

### Watch a provider fail, and the service degrade rather than break

```bash
docker compose up -d
curl -s "http://localhost:8080/best-offers" | jq '{partial, unavailableProviders}'

# Point the service at a provider endpoint that returns 500
docker compose stop mock-providers
curl -s "http://localhost:8080/best-offers" | jq '{code, message}'   # 503
docker compose start mock-providers
```

### Change a price at runtime, with no restart

```bash
# Raise the markup from 10% to 20%
sed -i 's/"defaultMarginBasisPoints": 1000/"defaultMarginBasisPoints": 2000/' \
  config/pricing-config.json

curl -fsS -X POST http://localhost:8080/admin/config/reload \
  -H "Authorization: Bearer local-dev-admin-token" | jq

curl -s http://localhost:8080/best-offers \
  | jq '.offers[] | select(.productId=="eu-north-location-hour") | .customerBundleEUR'
# "14.35"   (was "13.16")
```

### Break the config, and watch it refuse to break the service

```bash
echo '{ not json' > config/pricing-config.json
curl -s -X POST http://localhost:8080/admin/config/reload \
  -H "Authorization: Bearer local-dev-admin-token" | jq
# 422, with the problems listed and the previous versions still active

curl -s http://localhost:8080/best-offers | jq '{fxVersion, marginVersion}'
# Unchanged — the last valid snapshot keeps serving

git checkout config/pricing-config.json
```

---

## Deploying to the cloud

Full instructions, including the one-time state bootstrap and the
first-apply ordering, are in
[infrastructure/README.md](infrastructure/README.md). The short version:

### AWS (recommended primary — see [ADR-0001](docs/adr/0001-cloud-vendor-selection.md))

```bash
cd infrastructure/aws

cp environments/dev.tfvars.example      environments/dev.tfvars
cp environments/dev.backend.hcl.example environments/dev.backend.hcl
# Edit both: bucket name, region, alert email

terraform init -backend-config=environments/dev.backend.hcl
terraform plan  -var-file=environments/dev.tfvars -out=tfplan
terraform apply tfplan

# Push the images, then redeploy
aws ecr get-login-password --region eu-north-1 | docker login \
  --username AWS --password-stdin "$(terraform output -raw service_repository_url | cut -d/ -f1)"
docker build -t "$(terraform output -raw service_repository_url):latest" ..
docker push "$(terraform output -raw service_repository_url):latest"
aws ecs update-service --cluster "$(terraform output -raw ecs_cluster_name)" \
  --service "$(terraform output -raw ecs_service_name)" --force-new-deployment

BASE_URL="$(terraform output -raw service_url)" npm --prefix ../.. run smoke
```

Creates: VPC across 3 AZs with NAT and VPC endpoints, ALB, WAFv2, ECS Fargate
with autoscaling, ECR with scanning, Secrets Manager, SSM Parameter Store,
CloudWatch dashboard and seven alarms.

### Azure (fully specified alternative)

```bash
cd infrastructure/azure
az login && az account set --subscription "<subscription-id>"

cp environments/dev.tfvars.example      environments/dev.tfvars
cp environments/dev.backend.hcl.example environments/dev.backend.hcl

terraform init -backend-config=environments/dev.backend.hcl
terraform plan  -var-file=environments/dev.tfvars -out=tfplan
terraform apply tfplan

LOGIN_SERVER="$(terraform output -raw registry_login_server)"
az acr login --name "$(terraform output -raw registry_name)"
docker build -t "$LOGIN_SERVER/best-offers:latest" ../..
docker push "$LOGIN_SERVER/best-offers:latest"

BASE_URL="$(terraform output -raw service_url)" npm --prefix ../.. run smoke
```

Creates: VNet with a delegated subnet and NSG, Container Apps environment,
Container Apps with KEDA scaling, Front Door Premium with WAF, Container
Registry, Key Vault with managed identity, Log Analytics, Application
Insights and alert rules.

### Validate without deploying

```bash
npm run check:tf                  # offline consistency checks
cd infrastructure/aws
terraform fmt -check -recursive && terraform init -backend=false && terraform validate
```

> **Note.** The Terraform is internally consistent and validated, but has
> **not been applied to a live cloud account** — see
> [docs/architecture/22-assumptions-and-gaps.md](docs/architecture/22-assumptions-and-gaps.md#224-what-has-not-been-executed).
> Expect first-apply issues such as IAM propagation delays and service quotas.

---

## Configuration

All settings are environment variables, validated at startup — an invalid
value stops the process rather than producing odd behaviour under load. Full
list with defaults in [`.env.example`](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Listen port; `0` binds an ephemeral port |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `PRICING_CONFIG_PATH` | `config/pricing-config.json` | Pricing snapshot |
| `PROVIDER_TELEMETRY1_URL` | localhost mock | Provider endpoint — identity comes from here |
| `PROVIDER_TELEMETRY2_URL` | localhost mock | Provider endpoint |
| `PROVIDER_TIMEOUT_MS` | `2000` | Per-attempt timeout |
| `PROVIDER_MAX_ATTEMPTS` | `3` | Including the first attempt |
| `PROVIDER_RETRY_BUDGET_MS` | `5000` | Total retry budget |
| `REQUEST_TIMEOUT_MS` | `10000` | Whole-request deadline |
| `MAX_CONCURRENT_REQUESTS` | `256` | Load shedding threshold |
| `SHUTDOWN_GRACE_MS` | `15000` | Graceful drain period |
| `ADMIN_TOKEN` | — | Bearer token for config reload |
| `FIXED_CLOCK` | — | Pin the clock for reproducible output |

---

## Repository layout

```
├── src/
│   ├── best-offers/          # The service
│   │   ├── rational.js       # Exact BigInt arithmetic — no floating-point money
│   │   ├── time.js           # Strict RFC 3339 UTC
│   │   ├── clock.js          # Injectable clock
│   │   ├── validation.js     # Closed row contract
│   │   ├── pricing.js        # FX, markup, per-1000 normalisation
│   │   ├── ranking.js        # Eligibility and selection
│   │   ├── config.js         # Validated, hot-reloadable snapshots
│   │   ├── retry.js          # Bounded retries, full jitter, deadlines
│   │   ├── provider-client.js# Timeouts, size caps, no caching
│   │   ├── service.js        # Orchestration and partial-result policy
│   │   ├── app.js            # Routing, shedding, safe errors
│   │   └── server.js         # Composition root and lifecycle
│   ├── mock-providers/       # The two placeholder endpoints
│   └── agent/                # Supervised fleet assistant
│       ├── tools/registry.js # The capability boundary: allow-list + schemas
│       ├── proposals.js      # Proposal lifecycle and the human approval gate
│       ├── execution.js      # The only thing that causes effects; token required
│       ├── audit.js          # Append-only, hash-chained ledger
│       ├── orchestrator.js   # The agent loop, written by hand
│       ├── model/            # Anthropic, OpenAI, Ollama, deterministic
│       └── ui.js             # The supervision console
├── test/
│   ├── unit/                 # 129 tests
│   └── integration/          # 59 tests, real sockets
├── infrastructure/
│   ├── aws/                  # Terraform: VPC, ALB, Fargate, WAF, observability
│   └── azure/                # Terraform: VNet, Container Apps, Front Door
├── docs/
│   ├── architecture/         # 23 documents with Mermaid diagrams
│   ├── adr/                  # 12 decision records
│   ├── coding-task/          # Contract, worked examples, test strategy
│   └── runbooks/             # Incident response, pricing change, DR drill
├── config/                   # Pricing snapshot
├── fixtures/                 # The brief's sample provider responses
├── scripts/                  # demo, run-local, smoke, check, check-terraform
└── .github/workflows/        # CI and gated deployment
```

---

## Design decisions worth knowing before you read the code

| Decision | Why | ADR |
| --- | --- | --- |
| Rank on cost per 1000 **valid** events, never bundle price | A cheaper bundle with worse quality is not a better deal; the brief forbids substituting bundle price | [0002](docs/adr/0002-quality-normalised-comparison.md) |
| Exact rational arithmetic over BigInt | A price a customer cannot reproduce is a legal exposure. Measured cost: 2.25 µs per row | [0004](docs/adr/0004-exact-decimal-arithmetic.md) |
| Zero runtime dependencies | Removes the transitive supply-chain surface entirely | [0003](docs/adr/0003-zero-runtime-dependencies.md) |
| One config snapshot, read once per request | A reload mid-request must never produce an inconsistent comparison | [0007](docs/adr/0007-configuration-snapshots.md) |
| No caching of provider offers | Explicitly prohibited; serving a stale price is the conduct the group settled over | [0002](docs/adr/0002-quality-normalised-comparison.md) |
| Partial results are HTTP 200, not an error | Three of five products with reasons beats a 500 | [api-contract](docs/coding-task/api-contract.md) |
| Agents propose; humans approve; no actuation code exists | A prompt is a request; absent capability is a constraint | [0010](docs/adr/0010-agent-tool-allowlisting.md) |
| The agent's default planner needs no model at all | A safety demonstration must not depend on a vendor being reachable | [0013](docs/adr/0013-agent-model-provider-abstraction.md) |

---

## What is built, and what is not

The brief asks for unimplemented requirements to be identified honestly.

**Built and tested:** offer validation, eligibility, quality-normalised
ranking, exact arithmetic, versioned hot-reloadable configuration, retry and
resilience, partial results, observability, the mock providers, containers,
CI/CD, Terraform for both clouds, and the supervised agent workflow with its
tool registry, approval gate, execution service, audit ledger and console.

**Designed, not built:** telemetry ingestion, quality verification and spoof
detection, consent service, merger REST API, notifications, payments, loyalty
and advertising, and the customer-facing web frontend.

Full detail, with effort estimates and known gaps in what *is* built, in
[docs/architecture/22-assumptions-and-gaps.md](docs/architecture/22-assumptions-and-gaps.md).
Requirement-by-requirement traceability is in
[docs/architecture/21-requirements-traceability.md](docs/architecture/21-requirements-traceability.md).

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `EADDRINUSE` on 8080 or 8081 | Another process holds the port. `PORT=8090 npm run demo`, or stop the other process |
| `Invalid environment configuration` | A variable failed validation; the message names it |
| `Invalid pricing configuration` | The config file was rejected; the message lists every problem |
| `503 ALL_PROVIDERS_UNAVAILABLE` | Neither mock is reachable. Check `docker compose ps` or that `src/mock-providers/server.js` is running |
| Tests fail on Windows with path errors | Run from a bash shell (Git Bash or WSL), or use `npm test` rather than the `make` targets |
| `docker compose` not found | Docker Desktop not running, or you have the older `docker-compose` v1 — use `COMPOSE="docker-compose" make up` |
| Terraform `Backend configuration changed` | Run `terraform init -reconfigure -backend-config=...` |
| Different numbers from the worked examples | `FIXED_CLOCK` is not set, so live time is used and the fixtures are stale. That is correct behaviour |

---

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md) — branching, definition of done, conventions
- [SECURITY.md](SECURITY.md) — reporting, implemented controls, known limitations
- [LICENSE](LICENSE) — licence and third-party position
