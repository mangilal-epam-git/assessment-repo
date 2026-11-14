# Developer entry points. Every target works on Linux, macOS and Windows
# (Git Bash / WSL). See README.md for per-OS prerequisites.

SHELL := /bin/bash
.DEFAULT_GOAL := help
COMPOSE ?= docker compose

.PHONY: help
help: ## Show the available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Install dependencies (none at runtime; verifies the toolchain)
	node --version
	npm install --no-audit --no-fund

.PHONY: run
run: ## Run mock providers and the service locally (two processes)
	./scripts/run-local.sh

.PHONY: demo
demo: ## Print the deterministic /best-offers response for the fixtures
	npm run demo

.PHONY: test
test: ## Run the full test suite with coverage thresholds
	npm test

.PHONY: test-unit
test-unit: ## Run unit tests only
	npm run test:unit

.PHONY: test-integration
test-integration: ## Run integration tests only
	npm run test:integration

.PHONY: check
check: ## Static checks: syntax, formatting conventions, repo hygiene
	npm run check

.PHONY: security
security: ## Snyk scans: dependencies, our own code, and Terraform
	npm run security

.PHONY: security-container
security-container: docker-build ## Snyk scan of the built container images
	snyk container test vectorharbor/best-offers:local --file=Dockerfile --severity-threshold=high --fail-on=upgradable
	snyk container test vectorharbor/mock-providers:local --file=Dockerfile.mock --severity-threshold=high --fail-on=upgradable
	snyk container test vectorharbor/fleet-assistant:local --file=Dockerfile.agent --severity-threshold=high --fail-on=upgradable

.PHONY: verify
verify: check test ## Everything CI runs

.PHONY: up
up: ## Start the stack with Docker Compose
	$(COMPOSE) up --build -d
	@echo "best-offers: http://localhost:8080/best-offers"

.PHONY: down
down: ## Stop the Docker Compose stack
	$(COMPOSE) down -v

.PHONY: logs
logs: ## Tail Docker Compose logs
	$(COMPOSE) logs -f

.PHONY: smoke
smoke: ## Smoke-test a running instance (BASE_URL overrides the target)
	npm run smoke

.PHONY: docker-build
docker-build: ## Build both images
	docker build -t vectorharbor/best-offers:local .
	docker build -t vectorharbor/mock-providers:local -f Dockerfile.mock .

.PHONY: tf-fmt
tf-fmt: ## Format all Terraform
	terraform -chdir=infrastructure/aws fmt -recursive
	terraform -chdir=infrastructure/azure fmt -recursive

.PHONY: tf-validate
tf-validate: ## Validate both Terraform root modules
	cd infrastructure/aws && terraform init -backend=false && terraform validate
	cd infrastructure/azure && terraform init -backend=false && terraform validate

.PHONY: clean
clean: ## Remove local build artefacts
	rm -rf coverage node_modules
