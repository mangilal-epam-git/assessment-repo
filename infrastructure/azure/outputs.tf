output "service_url" {
  description = "Public base URL of the service: Front Door when enabled, otherwise the Container App ingress."
  value       = var.enable_front_door ? "https://${module.frontdoor[0].endpoint_host_name}" : "https://${module.service_app.fqdn}"
}

output "best_offers_endpoint" {
  description = "Full URL of the ranking endpoint."
  value       = var.enable_front_door ? "https://${module.frontdoor[0].endpoint_host_name}/best-offers" : "https://${module.service_app.fqdn}/best-offers"
}

output "container_app_fqdn" {
  description = "Direct Container App hostname, bypassing Front Door. Useful for origin-level debugging."
  value       = module.service_app.fqdn
}

output "registry_login_server" {
  description = "Container registry to push images to."
  value       = module.registry.login_server
}

output "registry_name" {
  description = "Registry name, for `az acr login --name`."
  value       = module.registry.registry_name
}

output "resource_group_name" {
  description = "Resource group holding every resource in this stack."
  value       = azurerm_resource_group.this.name
}

output "key_vault_name" {
  description = "Key Vault holding the admin token."
  value       = azurerm_key_vault.this.name
}

output "log_analytics_workspace_name" {
  description = "Log Analytics workspace receiving container logs."
  value       = module.observability.workspace_name
}

output "managed_identity_client_id" {
  description = "Client id of the user-assigned identity the app runs as."
  value       = azurerm_user_assigned_identity.app.client_id
}

output "agent_console_url" {
  description = "Supervision console for the fleet assistant."
  value       = var.deploy_agent ? "https://${module.agent_app[0].fqdn}/" : ""
}

output "agent_app_name" {
  description = "Container App name of the fleet assistant, for `az containerapp revision restart`."
  value       = var.deploy_agent ? "ca-${local.name_prefix}-agent" : ""
}

output "agent_model_secret_name" {
  description = "Key Vault secret holding the inference API key. Empty when the backend needs no key."
  value       = var.deploy_agent && local.agent_needs_model_key ? "model-api-key" : ""
}

output "deployment_summary" {
  description = "Human-readable summary of what was deployed."
  value = {
    environment       = var.environment
    location          = var.location
    front_door        = var.enable_front_door
    mocks_deployed    = var.deploy_mock_providers
    agent_deployed    = var.deploy_agent
    agent_model       = var.deploy_agent ? "${var.agent_model_backend}/${var.agent_model_name != "" ? var.agent_model_name : "built-in"}" : "not deployed"
    zone_redundant    = var.environment == "prod"
    replica_range     = "${var.min_replicas}-${var.max_replicas}"
  }
}
