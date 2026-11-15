/**
 * VectorHarbor best-offers - Azure root module.
 *
 * Topology: Front Door (WAF, global anycast, DDoS absorption) -> Container
 * Apps environment on an injected subnet -> provider endpoints via the VNet.
 * Secrets live in Key Vault and are read with a user-assigned managed
 * identity; there are no credentials in the image or in Terraform state.
 *
 * Azure Container Apps is the counterpart to AWS Fargate: a serverless
 * container runtime with scale-to-demand and no control plane to run. See
 * ADR-0005 for why the primary recommendation is AWS and this stack exists as
 * a fully specified alternative.
 */

locals {
  name_prefix         = "vh-${var.environment}-bestoffers"
  resource_group_name = var.resource_group_name != "" ? var.resource_group_name : "rg-${local.name_prefix}"

  # Azure container registry names must be globally unique and alphanumeric.
  registry_name = replace("acr${local.name_prefix}${random_string.suffix.result}", "-", "")

  service_image = var.service_image != "" ? var.service_image : "${module.registry.login_server}/best-offers:latest"
  mock_image    = var.mock_provider_image != "" ? var.mock_provider_image : "${module.registry.login_server}/mock-providers:latest"

  agent_image    = var.agent_image != "" ? var.agent_image : "${module.registry.login_server}/fleet-assistant:latest"
  # Hosted backends need a key; the deterministic planner and a self-hosted
  # endpoint do not.
  agent_needs_model_key = contains(["anthropic", "openai", "azure-openai"], var.agent_model_backend)

  telemetry1_url = var.deploy_mock_providers ? "https://${module.mock_app[0].fqdn}/provider/telemetry1" : var.provider_telemetry1_url
  telemetry2_url = var.deploy_mock_providers ? "https://${module.mock_app[0].fqdn}/provider/telemetry2" : var.provider_telemetry2_url

  common_tags = {
    project         = "vectorharbor-data-marketplace"
    component       = "best-offers"
    environment     = var.environment
    managed-by      = "terraform"
    owner           = var.owner_tag
    cost-centre     = var.cost_centre
    data-classified = "internal"
  }
}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "terraform_data" "configuration_guard" {
  lifecycle {
    precondition {
      condition     = var.deploy_mock_providers || (var.provider_telemetry1_url != "" && var.provider_telemetry2_url != "")
      error_message = "With deploy_mock_providers = false you must set provider_telemetry1_url and provider_telemetry2_url."
    }
    precondition {
      condition     = var.environment != "prod" || var.enable_front_door
      error_message = "Production must sit behind Front Door so the WAF and DDoS objectives are met."
    }
    precondition {
      condition     = var.min_replicas <= var.max_replicas
      error_message = "min_replicas must not exceed max_replicas."
    }
    precondition {
      condition     = !(var.deploy_agent && contains(["azure-openai", "ollama"], var.agent_model_backend) && var.agent_model_base_url == "")
      error_message = "agent_model_base_url is required for the azure-openai and ollama backends."
    }
    precondition {
      condition     = !(var.deploy_agent && var.agent_model_backend != "deterministic" && var.agent_model_name == "")
      error_message = "agent_model_name must be set and version-pinned for a non-deterministic backend."
    }
  }
}

resource "azurerm_resource_group" "this" {
  name     = local.resource_group_name
  location = var.location
  tags     = local.common_tags
}

module "network" {
  source = "./modules/network"

  name_prefix         = local.name_prefix
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  vnet_cidr           = var.vnet_cidr
  tags                = local.common_tags
}

module "registry" {
  source = "./modules/registry"

  registry_name       = local.registry_name
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  environment         = var.environment
  tags                = local.common_tags
}

# Workspace, Application Insights, action group and log-query alerts. This
# must not depend on the Container App: the Container Apps environment below
# consumes the workspace id, so app-scoped alerts live in module.app_alerts.
module "observability" {
  source = "./modules/observability"

  name_prefix               = local.name_prefix
  resource_group_name       = azurerm_resource_group.this.name
  location                  = azurerm_resource_group.this.location
  log_retention_days        = var.log_retention_days
  alarm_email_subscriptions = var.alarm_email_subscriptions
  tags                      = local.common_tags
}

# ---------------------------------------------------------------------------
# Identity, secrets and configuration
# ---------------------------------------------------------------------------

data "azurerm_client_config" "current" {}

resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${local.name_prefix}"
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  tags                = local.common_tags
}

# The identity pulls images directly; no registry password is ever stored.
resource "azurerm_role_assignment" "acr_pull" {
  scope                = module.registry.registry_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_key_vault" "this" {
  # Key Vault names are globally unique, max 24 characters.
  name                = substr("kv${replace(local.name_prefix, "-", "")}${random_string.suffix.result}", 0, 24)
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  # RBAC rather than access policies: role assignments are auditable in the
  # same place as every other permission in the subscription.
  rbac_authorization_enabled = true
  purge_protection_enabled   = var.environment == "prod"
  soft_delete_retention_days = 7

  public_network_access_enabled = true

  network_acls {
    bypass         = "AzureServices"
    default_action = "Allow"
  }

  tags = local.common_tags
}

resource "azurerm_role_assignment" "kv_secrets_user" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# The deploying principal needs write access to seed the secrets below.
resource "azurerm_role_assignment" "kv_secrets_officer" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "random_password" "admin_token" {
  length  = 48
  special = false
}

resource "azurerm_key_vault_secret" "admin_token" {
  name         = "admin-token"
  value        = random_password.admin_token.result
  key_vault_id = azurerm_key_vault.this.id
  content_type = "bearer-token"

  lifecycle {
    # Rotation is owned by the security runbook, not by an apply.
    ignore_changes = [value]
  }

  depends_on = [azurerm_role_assignment.kv_secrets_officer]
}

# The inference key is created as a vault secret with a placeholder value and
# set out of band, so the real key never appears in a plan, in state or in a
# pipeline log.
resource "azurerm_key_vault_secret" "model_api_key" {
  count = var.deploy_agent && local.agent_needs_model_key ? 1 : 0

  name         = "model-api-key"
  value        = "REPLACE-ME"
  key_vault_id = azurerm_key_vault.this.id
  content_type = "inference-api-key"

  lifecycle {
    ignore_changes = [value]
  }

  depends_on = [azurerm_role_assignment.kv_secrets_officer]
}

# ---------------------------------------------------------------------------
# Container Apps
# ---------------------------------------------------------------------------

resource "azurerm_container_app_environment" "this" {
  name                       = "cae-${local.name_prefix}"
  resource_group_name        = azurerm_resource_group.this.name
  location                   = azurerm_resource_group.this.location
  log_analytics_workspace_id = module.observability.workspace_id

  # VNet injection keeps east-west traffic private and gives the service a
  # stable egress identity that providers can allow-list.
  infrastructure_subnet_id       = module.network.apps_subnet_id
  internal_load_balancer_enabled = false

  zone_redundancy_enabled = var.environment == "prod"

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }

  tags = local.common_tags
}

module "service_app" {
  source = "./modules/container_app"

  name                         = "ca-${local.name_prefix}"
  resource_group_name          = azurerm_resource_group.this.name
  container_app_environment_id = azurerm_container_app_environment.this.id
  identity_id                  = azurerm_user_assigned_identity.app.id
  registry_server              = module.registry.login_server

  image         = local.service_image
  container_name = "best-offers"
  target_port   = 8080
  cpu           = var.service_cpu
  memory        = var.service_memory
  min_replicas  = var.min_replicas
  max_replicas  = var.max_replicas
  concurrent_requests_per_replica = var.concurrent_requests_per_replica

  # Only Front Door may reach the app when it is enabled; otherwise the
  # ingress is open so the stack is still usable in dev.
  external_ingress = true

  health_probe_path    = "/healthz"
  readiness_probe_path = "/readyz"

  key_vault_secrets = {
    "admin-token" = azurerm_key_vault_secret.admin_token.versionless_id
  }

  environment_variables = {
    NODE_ENV                        = "production"
    PORT                            = "8080"
    HOST                            = "0.0.0.0"
    LOG_LEVEL                       = var.log_level
    PROVIDER_TELEMETRY1_URL         = local.telemetry1_url
    PROVIDER_TELEMETRY2_URL         = local.telemetry2_url
    PROVIDER_TIMEOUT_MS             = "2000"
    PROVIDER_MAX_ATTEMPTS           = "3"
    PROVIDER_RETRY_INITIAL_DELAY_MS = "100"
    PROVIDER_RETRY_MAX_DELAY_MS     = "1000"
    PROVIDER_RETRY_BUDGET_MS        = "5000"
    REQUEST_TIMEOUT_MS              = "10000"
    MAX_CONCURRENT_REQUESTS         = "256"
    SHUTDOWN_GRACE_MS               = "15000"
    CONFIG_WATCH_ENABLED            = "true"
  }

  secret_environment_variables = {
    ADMIN_TOKEN = "admin-token"
  }

  tags = local.common_tags

  depends_on = [azurerm_role_assignment.acr_pull]
}

module "mock_app" {
  source = "./modules/container_app"
  count  = var.deploy_mock_providers ? 1 : 0

  name                         = "ca-${local.name_prefix}-mocks"
  resource_group_name          = azurerm_resource_group.this.name
  container_app_environment_id = azurerm_container_app_environment.this.id
  identity_id                  = azurerm_user_assigned_identity.app.id
  registry_server              = module.registry.login_server

  image                           = local.mock_image
  container_name                  = "mock-providers"
  target_port                     = 8081
  cpu                             = 0.25
  memory                          = "0.5Gi"
  min_replicas                    = 1
  max_replicas                    = 3
  concurrent_requests_per_replica = 200

  external_ingress = true

  health_probe_path    = "/healthz"
  readiness_probe_path = "/healthz"

  environment_variables = {
    MOCK_PORT = "8081"
    MOCK_HOST = "0.0.0.0"
  }

  tags = local.common_tags

  depends_on = [azurerm_role_assignment.acr_pull]
}

module "frontdoor" {
  source = "./modules/frontdoor"
  count  = var.enable_front_door ? 1 : 0

  name_prefix               = local.name_prefix
  resource_group_name       = azurerm_resource_group.this.name
  origin_host_name          = module.service_app.fqdn
  waf_mode                  = var.waf_mode
  rate_limit_per_minute     = var.waf_rate_limit_per_minute
  log_analytics_workspace_id = module.observability.workspace_id
  tags                      = local.common_tags
}

module "app_alerts" {
  source = "./modules/app_alerts"

  name_prefix                = local.name_prefix
  resource_group_name        = azurerm_resource_group.this.name
  container_app_id           = module.service_app.container_app_id
  log_analytics_workspace_id = module.observability.workspace_id
  action_group_id            = module.observability.action_group_id
  tags                       = local.common_tags
}

module "agent_app" {
  source = "./modules/container_app"
  count  = var.deploy_agent ? 1 : 0

  name                         = "ca-${local.name_prefix}-agent"
  resource_group_name          = azurerm_resource_group.this.name
  container_app_environment_id = azurerm_container_app_environment.this.id
  identity_id                  = azurerm_user_assigned_identity.app.id
  registry_server              = module.registry.login_server

  image                           = local.agent_image
  container_name                  = "fleet-assistant"
  target_port                     = 8082
  cpu                             = var.agent_cpu
  memory                          = var.agent_memory
  min_replicas                    = var.agent_min_replicas
  max_replicas                    = var.agent_max_replicas
  concurrent_requests_per_replica = var.agent_concurrent_requests_per_replica

  external_ingress = true

  health_probe_path    = "/healthz"
  readiness_probe_path = "/readyz"

  key_vault_secrets = var.deploy_agent && local.agent_needs_model_key ? {
    "model-api-key" = azurerm_key_vault_secret.model_api_key[0].versionless_id
  } : {}

  secret_environment_variables = var.deploy_agent && local.agent_needs_model_key ? {
    MODEL_API_KEY = "model-api-key"
  } : {}

  environment_variables = merge(
    {
      NODE_ENV                  = "production"
      AGENT_PORT                = "8082"
      AGENT_HOST                = "0.0.0.0"
      LOG_LEVEL                 = var.log_level
      MODEL_BACKEND             = var.agent_model_backend
      MODEL_NAME                = var.agent_model_name
      MODEL_FALLBACK_ENABLED    = "true"
      PROPOSAL_TTL_MS           = tostring(var.agent_proposal_ttl_millis)
      FOUR_EYES_THRESHOLD_MINOR = tostring(var.agent_four_eyes_threshold_minor)
      SHUTDOWN_GRACE_MS         = "15000"
    },
    var.agent_model_base_url != "" ? {
      OPENAI_BASE_URL    = var.agent_model_base_url
      ANTHROPIC_BASE_URL = var.agent_model_base_url
      OLLAMA_BASE_URL    = var.agent_model_base_url
    } : {},
    var.agent_anthropic_workspace_id != "" ? {
      ANTHROPIC_WORKSPACE_ID = var.agent_anthropic_workspace_id
    } : {},
  )

  tags = local.common_tags

  depends_on = [azurerm_role_assignment.acr_pull, azurerm_role_assignment.kv_secrets_user]
}

module "agent_alerts" {
  source = "./modules/app_alerts"
  count  = var.deploy_agent ? 1 : 0

  name_prefix                = "${local.name_prefix}-agent"
  resource_group_name        = azurerm_resource_group.this.name
  container_app_id           = module.agent_app[0].container_app_id
  log_analytics_workspace_id = module.observability.workspace_id
  action_group_id            = module.observability.action_group_id
  tags                       = local.common_tags
}
