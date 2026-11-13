output "resource_group_name" {
  description = "Resource group for this environment and jurisdiction."
  value       = azurerm_resource_group.platform.name
}

output "virtual_network_id" {
  description = "ID of the regional virtual network."
  value       = azurerm_virtual_network.platform.id
}

output "workload_subnet_id" {
  description = "Private workload subnet ID. No application compute is created by this foundation."
  value       = azurerm_subnet.workloads.id
}

output "private_endpoint_subnet_id" {
  description = "Private endpoint subnet ID."
  value       = azurerm_subnet.private_endpoints.id
}

output "domain_storage_account_names" {
  description = "Private storage account names keyed by data domain."
  value       = { for domain, account in azurerm_storage_account.domain : domain => account.name }
}

output "domain_container_names" {
  description = "Private blob container names keyed by domain."
  value       = { for domain, container in azurerm_storage_container.domain : domain => container.name }
}

output "domain_private_endpoint_ids" {
  description = "Storage blob private endpoint IDs keyed by domain."
  value       = { for domain, endpoint in azurerm_private_endpoint.domain_blob : domain => endpoint.id }
}

output "blob_private_dns_zone_id" {
  description = "Private DNS zone ID for Azure Blob Storage private endpoint name resolution."
  value       = azurerm_private_dns_zone.blob.id
}
