output "endpoint_host_name" {
  description = "Public Front Door hostname."
  value       = azurerm_cdn_frontdoor_endpoint.this.host_name
}

output "profile_id" {
  description = "Front Door profile resource id."
  value       = azurerm_cdn_frontdoor_profile.this.id
}

output "firewall_policy_id" {
  description = "WAF policy resource id."
  value       = azurerm_cdn_frontdoor_firewall_policy.this.id
}
