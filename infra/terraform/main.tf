terraform {
  required_version = ">= 1.5.0, < 2.0.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

data "azurerm_client_config" "current" {}

resource "random_string" "storage_suffix" {
  length  = 6
  upper   = false
  special = false
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  invalid_domain_owners = [
    for domain_name, domain in var.data_domains : domain_name
    if !contains(keys(var.teams), domain.owning_team)
  ]

  invalid_team_domains = flatten([
    for team_name, team in var.teams : [
      for domain_name in team.data_domains : "${team_name}:${domain_name}"
      if !contains(keys(var.data_domains), domain_name)
    ]
  ])

  team_domain_principal_grants = flatten([
    for team_name, team in var.teams : [
      for domain_name in team.data_domains : [
        for principal_id in team.principal_object_ids : {
          team_name    = team_name
          domain_name  = domain_name
          principal_id = principal_id
        } if contains(keys(var.data_domains), domain_name)
      ]
    ]
  ])

  grants = {
    for grant in local.team_domain_principal_grants :
    "${grant.team_name}:${grant.domain_name}:${grant.principal_id}" => grant
  }
}

resource "azurerm_resource_group" "platform" {
  name     = "${local.name_prefix}-rg"
  location = var.location
  tags     = var.tags

  lifecycle {
    precondition {
      condition     = contains(var.approved_locations, var.location)
      error_message = "location must be included in approved_locations after residency review."
    }
    precondition {
      condition     = length(local.invalid_domain_owners) == 0
      error_message = "Every data domain owning_team must refer to a declared team. Invalid domains: ${join(", ", local.invalid_domain_owners)}."
    }
    precondition {
      condition     = length(local.invalid_team_domains) == 0
      error_message = "Every team data_domains entry must refer to a declared domain. Invalid grants: ${join(", ", local.invalid_team_domains)}."
    }
  }
}

resource "azurerm_virtual_network" "platform" {
  name                = "${local.name_prefix}-vnet"
  location            = azurerm_resource_group.platform.location
  resource_group_name = azurerm_resource_group.platform.name
  address_space       = [var.vnet_address_space]
  tags                = var.tags
}

resource "azurerm_subnet" "workloads" {
  name                 = "${local.name_prefix}-workloads-snet"
  resource_group_name  = azurerm_resource_group.platform.name
  virtual_network_name = azurerm_virtual_network.platform.name
  address_prefixes     = [var.workload_subnet_prefix]
}

resource "azurerm_subnet" "private_endpoints" {
  name                 = "${local.name_prefix}-private-endpoints-snet"
  resource_group_name  = azurerm_resource_group.platform.name
  virtual_network_name = azurerm_virtual_network.platform.name
  address_prefixes     = [var.private_endpoint_subnet_prefix]

  private_endpoint_network_policies = "Disabled"
}

resource "azurerm_private_dns_zone" "blob" {
  name                = "privatelink.blob.core.windows.net"
  resource_group_name = azurerm_resource_group.platform.name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "blob" {
  name                  = "${local.name_prefix}-blob-dns-link"
  resource_group_name   = azurerm_resource_group.platform.name
  private_dns_zone_name = azurerm_private_dns_zone.blob.name
  virtual_network_id    = azurerm_virtual_network.platform.id
  registration_enabled  = false
  tags                  = var.tags
}

resource "azurerm_storage_account" "domain" {
  for_each = var.data_domains

  name                            = "${substr(replace(lower("${var.project_name}${var.environment}${each.key}"), "-", ""), 0, 15)}${random_string.storage_suffix.result}"
  resource_group_name             = azurerm_resource_group.platform.name
  location                        = azurerm_resource_group.platform.location
  account_tier                    = "Standard"
  account_replication_type         = var.storage_replication_type
  account_kind                    = "StorageV2"
  min_tls_version                  = "TLS1_2"
  https_traffic_only_enabled       = true
  public_network_access_enabled    = false
  shared_access_key_enabled        = false
  allow_nested_items_to_be_public  = false
  infrastructure_encryption_enabled = true

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = var.soft_delete_retention_days
    }
    container_delete_retention_policy {
      days = var.soft_delete_retention_days
    }
  }

  tags = merge(var.tags, {
    DataDomain     = each.key
    DataOwner      = each.value.owning_team
    Jurisdiction   = each.value.jurisdiction
    Classification = each.value.classification
  })
}

resource "azurerm_storage_container" "domain" {
  for_each = azurerm_storage_account.domain

  name                  = each.key
  storage_account_id    = each.value.id
  container_access_type = "private"
}

resource "azurerm_storage_management_policy" "domain" {
  for_each = azurerm_storage_account.domain

  storage_account_id = each.value.id

  rule {
    name    = "domain-retention"
    enabled = true
    filters {
      prefix_match = ["${azurerm_storage_container.domain[each.key].name}/"]
      blob_types   = ["blockBlob"]
    }
    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = var.data_domains[each.key].retention_days
      }
      snapshot {
        delete_after_days_since_creation_greater_than = var.data_domains[each.key].retention_days
      }
      version {
        delete_after_days_since_creation = var.noncurrent_version_retention_days
      }
    }
  }
}

resource "azurerm_private_endpoint" "domain_blob" {
  for_each = azurerm_storage_account.domain

  name                = "${each.value.name}-blob-pe"
  location            = azurerm_resource_group.platform.location
  resource_group_name = azurerm_resource_group.platform.name
  subnet_id           = azurerm_subnet.private_endpoints.id

  private_service_connection {
    name                           = "${each.value.name}-blob-connection"
    private_connection_resource_id = each.value.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "blob-dns-zone-group"
    private_dns_zone_ids = [azurerm_private_dns_zone.blob.id]
  }

  tags = var.tags
}

resource "azurerm_role_assignment" "domain_blob_contributor" {
  for_each = local.grants

  scope                = azurerm_storage_account.domain[each.value.domain_name].id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = each.value.principal_id
  description          = "${each.value.team_name} access to ${each.value.domain_name} data domain"
}
