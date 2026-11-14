output "registry_id" {
  description = "Registry resource id, used for the AcrPull role assignment."
  value       = azurerm_container_registry.this.id
}

output "registry_name" {
  description = "Registry name, for `az acr login --name`."
  value       = azurerm_container_registry.this.name
}

output "login_server" {
  description = "Registry login server, used as the image prefix."
  value       = azurerm_container_registry.this.login_server
}
