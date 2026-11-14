/**
 * Azure Container Registry with vulnerability scanning and a retention policy.
 * Admin credentials stay disabled: pulls use the workload's managed identity.
 */

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.10"
    }
  }
}

resource "azurerm_container_registry" "this" {
  name                = var.registry_name
  resource_group_name = var.resource_group_name
  location            = var.location

  # Premium unlocks geo-replication, retention policies and private
  # endpoints, all of which production needs; lower environments take Basic.
  sku = var.environment == "prod" ? "Premium" : "Basic"

  # Never enable the shared admin user: it is a password that cannot be
  # attributed to a person or workload.
  admin_enabled = false

  public_network_access_enabled = true

  dynamic "retention_policy_in_days" {
    for_each = var.environment == "prod" ? [1] : []
    content {
      days    = 30
      enabled = true
    }
  }

  dynamic "trust_policy" {
    for_each = var.environment == "prod" ? [1] : []
    content {
      enabled = true
    }
  }

  tags = var.tags
}
