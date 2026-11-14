output "vnet_id" {
  description = "Virtual network identifier."
  value       = azurerm_virtual_network.this.id
}

output "apps_subnet_id" {
  description = "Subnet the Container Apps environment is injected into."
  value       = azurerm_subnet.apps.id
}

output "private_endpoints_subnet_id" {
  description = "Subnet reserved for private endpoints."
  value       = azurerm_subnet.private_endpoints.id
}
