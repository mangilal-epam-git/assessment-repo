output "container_app_id" {
  description = "Container App resource id."
  value       = azurerm_container_app.this.id
}

output "fqdn" {
  description = "Ingress hostname of the app."
  value       = azurerm_container_app.this.ingress[0].fqdn
}

output "latest_revision_name" {
  description = "Name of the most recent revision."
  value       = azurerm_container_app.this.latest_revision_name
}
