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
| **Architecture documentation** | [`docs/`](docs/README.md) — 24 documents, 13 ADRs, 43 Mermaid diagrams |
| **Customer deck** | [`docs/presentation/`](docs/presentation/README.md) — five slides with speaker notes |
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
| Best offers (ranked result) | http://localhost:8080/best-offers |
| Health | http://localhost:8080/healthz |
| Readiness | http://localhost:8080/readyz |
| Metrics | http://localhost:8080/metrics |
| Provider 1 raw feed | http://localhost:8081/provider/telemetry1 |
| Provider 2 raw feed | http://localhost:8081/provider/telemetry2 |

The provider feeds are served by a **separate service on port 8081**. The
brief writes them as `https://<host>/provider/telemetry1`, where `<host>` is
that provider service — not the one serving `/best-offers`. Keeping them
apart is deliberate: it is what makes provider identity a property of the
configured endpoint rather than of a field in a row. Both services list
their own endpoints at `/`.
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
npm run test:report       # the same, plus JUnit XML and LCOV in reports/
npm run test:unit         # unit tests only, sub-second
npm run test:integration  # integration tests, real sockets and files
npm run check             # static checks + Terraform consistency, offline
npm run smoke             # contract check against a running instance
make verify               # check + test, exactly what CI runs
```

Security scanning needs the Snyk CLI (`npm i -g snyk && snyk auth`):

```bash
npm run security           # dependencies, our own code (SAST), Terraform
make security-container    # build the images, then scan them
```

Snyk Open Source finds nothing here by design — there are zero dependencies
— so the scan that matters is **Snyk Code** over the ~6 200 lines we wrote
ourselves. CI also runs Trivy, which needs no account, so every push gets a
baseline scan whether or not `SNYK_TOKEN` is set. See
[SECURITY.md](SECURITY.md#scanning).

Coverage thresholds (90% lines, 90% functions, 80% branches) are enforced by
the test command, so `npm test` fails if coverage regresses. Current:
**302 tests, 96.8% lines, 92.7% functions, 88.8% branches**.

### Presenting this

Step-by-step startup for all three services, a running order, and a
troubleshooting table: [docs/runbooks/demo-day.md](docs/runbooks/demo-day.md).
One thing that catches people out — the offers service needs
`FIXED_CLOCK=2026-06-15T10:05:00Z`, or the brief's fixtures are correctly
judged stale and you get zero offers.

### Where to see the results

Locally, `npm test` prints each test and a per-file coverage table. For
machine-readable output:

```bash
npm run test:report     # writes reports/junit.xml and reports/lcov.info
genhtml reports/lcov.info -o reports/html   # optional browsable coverage
```

In a pull request, CI publishes them in the **Checks** tab as an annotated
"Test results" check, in the **job summary** as a pass/fail table per
operating system, and as downloadable **artifacts** for 14 days. Details in
[docs/coding-task/test-strategy.md](docs/coding-task/test-strategy.md#where-to-see-the-results).

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

### Which AI model it uses

By default: **none**. The built-in planner (`deterministic-planner-1`) is
rule-based, runs in-process, and needs no key, no network and no GPU. It
surveys the fleet, ranks by fault severity, prices the remedy and writes an
evidence-cited rationale.

That is a design position, not a placeholder. A demonstration of a safety
property must not fail because a vendor is unreachable — and identical
behaviour across planners is the clearest evidence that the guarantees come
from the tool registry and the approval gate rather than from the model
cooperating.

To use a real model, set two environment variables:

| Backend | Command | Notes |
| --- | --- | --- |
| Anthropic | `MODEL_BACKEND=anthropic MODEL_API_KEY=sk-ant-... MODEL_NAME=claude-sonnet-4-5 npm run agent` | Recommended for production |
| OpenAI | `MODEL_BACKEND=openai MODEL_API_KEY=sk-... MODEL_NAME=gpt-4o-mini npm run agent` | Cheapest hosted option |
| Azure OpenAI | `MODEL_BACKEND=azure-openai MODEL_API_KEY=... MODEL_NAME=<deployment> OPENAI_BASE_URL=https://<resource>.openai.azure.com npm run agent` | Keeps inference in your tenancy |
| Ollama (local) | `ollama pull llama3.1` then `MODEL_BACKEND=ollama MODEL_NAME=llama3.1 npm run agent` | Open-source, no key, nothing leaves the machine |

On Windows PowerShell set each with `$env:MODEL_BACKEND = "anthropic"` on its
own line, then run `node src\agent\server.js`.

Check what actually answered with `curl localhost:8082/readyz`, or run the
diagnostic, which prints what the process can genuinely see:

```bash
npm run diagnose:model            # configuration only
node scripts/diagnose-model.js --ping   # also make one real call
```

If it still reports `deterministic` after you set the variables, they are not
in the shell that started the service — environment variables are read once at
boot, so set them and start `node src/agent/server.js` **from the same
window**. If a backend
fails, the service falls back to the deterministic planner and says so in the
reported model name — a substitution is never silent.

The orchestration loop is hand-written; only inference is delegated, which is
the line the brief draws. Model choice, cost per turn, data handling,
evaluation and governance are in
[docs/architecture/24-ai-model-strategy.md](docs/architecture/24-ai-model-strategy.md).
Demo walkthrough: [docs/coding-task/agent-demo.md](docs/coding-task/agent-demo.md).

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
CloudWatch dashboard and seven alarms — plus the fleet assistant behind the
same load balancer on `/agent/*`, with its console on `/console`.

The assistant's inference key is deliberately **not** in Terraform. The
secret is created empty and set afterwards:

```bash
docker build -f ../Dockerfile.agent -t "$(terraform output -raw agent_repository_url):latest" ..
docker push "$(terraform output -raw agent_repository_url):latest"

# Only needed for a hosted backend; the deterministic planner needs no key.
aws secretsmanager put-secret-value \
  --secret-id "$(terraform output -raw agent_model_secret_name)" \
  --secret-string 'sk-ant-...'

aws ecs update-service --cluster "$(terraform output -raw ecs_cluster_name)" \
  --service "$(terraform output -raw agent_service_name)" --force-new-deployment

curl "$(terraform output -raw agent_console_url)"
```

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
Insights and alert rules — plus the fleet assistant as its own Container App.

```bash
docker build -f ../../Dockerfile.agent -t "$LOGIN_SERVER/fleet-assistant:latest" ../..
docker push "$LOGIN_SERVER/fleet-assistant:latest"

# Only for a hosted backend.
az keyvault secret set --vault-name "$(terraform output -raw key_vault_name)" \
  --name model-api-key --value 'sk-...'

az containerapp revision restart \
  --name "$(terraform output -raw agent_app_name)" \
  --resource-group "$(terraform output -raw resource_group_name)"
```

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

Fleet assistant (`src/agent/server.js`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_PORT` | `8082` | Listen port |
| `MODEL_BACKEND` | `deterministic` | `deterministic`, `anthropic`, `openai`, `azure-openai`, `ollama` |
| `MODEL_NAME` | — | Model, or the Azure deployment name. Pin a version |
| `MODEL_API_KEY` | — | Required for hosted backends; refused at boot if missing |
| `ANTHROPIC_WORKSPACE_ID` | — | Only for an organisation-level Anthropic key, which is not bound to a workspace |
| `MODEL_FALLBACK_ENABLED` | `true` | Degrade to the deterministic planner on failure |
| `MODEL_EGRESS_POLICY_ENABLED` | `true` | Classify and block outbound model payloads. Cannot be `false` in production |
| `MODEL_PERMITTED_DATA_CLASSES` | `OPERATIONAL,VEHICLE_ID` | What may cross the boundary. `SECRET` and `PAYMENT` are never permittable |
| `MODEL_MAX_TOKENS` | `2048` | Output cap per call; a direct cost control |
| `PROPOSAL_TTL_MS` | `14400000` | How long a proposal lives before expiring unapproved |
| `FOUR_EYES_THRESHOLD_MINOR` | `100000` | Above this, a second approver is required |
| `AGENT_MAX_ITERATIONS` | `8` | Bound on the agent loop |

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
| Outbound model payloads are classified and blocked, failing closed | Minimisation at source is the real control; this is the backstop for when it is wrong | [0014](docs/adr/0014-model-egress-data-classification.md) |

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
| Agent console "Failed to fetch" | You are opening a saved HTML file, not the running service. Start it with `npm run agent` and open http://localhost:8082/ |
| `MODEL_API_KEY is required` at boot | A hosted `MODEL_BACKEND` was set without a key. Either supply one or use `MODEL_BACKEND=deterministic` |
| Assistant answers but the model reads `(fallback from ...)` | The configured backend failed; the deterministic planner answered. Check the key, the endpoint and outbound network |
| Different numbers from the worked examples | `FIXED_CLOCK` is not set, so live time is used and the fixtures are stale. That is correct behaviour |

---

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md) — branching, definition of done, conventions
- [SECURITY.md](SECURITY.md) — reporting, implemented controls, known limitations
- [LICENSE](LICENSE) — licence and third-party position
