variable "subscription_id" {
  description = "Azure subscription ID for this environment. Supply through a secure CI variable or a local, ignored tfvars file."
  type        = string
  sensitive   = true
}

variable "project_name" {
  description = "Short lowercase project name used in resource names."
  type        = string
  default     = "vectorharbor"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.project_name))
    error_message = "project_name must be 3-20 lowercase letters, digits, or hyphens and start with a letter."
  }
}

variable "environment" {
  description = "Environment name."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "location" {
  description = "Azure region for this isolated jurisdiction/environment deployment."
  type        = string
}

variable "approved_locations" {
  description = "Explicitly approved Azure locations; set after legal and residency review."
  type        = set(string)
}

variable "vnet_address_space" {
  description = "Regional virtual network CIDR."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrhost(var.vnet_address_space, 0))
    error_message = "vnet_address_space must be a valid CIDR."
  }
}

variable "workload_subnet_prefix" {
  description = "Subnet reserved for private application workloads."
  type        = string
  default     = "10.40.1.0/24"
}

variable "private_endpoint_subnet_prefix" {
  description = "Subnet for private endpoints."
  type        = string
  default     = "10.40.2.0/24"
}

variable "storage_replication_type" {
  description = "Azure Storage redundancy. Confirm availability and residency implications in the selected region."
  type        = string
  default     = "ZRS"

  validation {
    condition     = contains(["LRS", "ZRS", "GRS", "RAGRS"], var.storage_replication_type)
    error_message = "storage_replication_type must be LRS, ZRS, GRS, or RAGRS; use only a residency-approved option."
  }
}

variable "teams" {
  description = "Team definitions with Entra ID object IDs and approved data-domain grants."
  type = map(object({
    owner_email         = string
    cost_center         = string
    data_domains        = set(string)
    principal_object_ids = set(string)
  }))
  default = {}
}

variable "data_domains" {
  description = "Data-domain storage and governance metadata. Domain keys must be lowercase container-safe names."
  type = map(object({
    jurisdiction   = string
    classification = string
    retention_days = number
    owning_team    = string
  }))
  default = {}

  validation {
    condition = alltrue([
      for name, domain in var.data_domains :
      can(regex("^[a-z][a-z0-9-]{1,61}[a-z0-9]$", name)) &&
      domain.retention_days >= 1 && domain.retention_days <= 3650 &&
      length(trimspace(domain.jurisdiction)) > 0 &&
      length(trimspace(domain.classification)) > 0
    ])
    error_message = "Domain keys must be lowercase and container-safe; retention must be 1-3650 days; jurisdiction and classification are required."
  }
}

variable "soft_delete_retention_days" {
  description = "Soft delete window for blobs and containers. Align with legal retention and recovery policy."
  type        = number
  default     = 14

  validation {
    condition     = var.soft_delete_retention_days >= 1 && var.soft_delete_retention_days <= 365
    error_message = "soft_delete_retention_days must be between 1 and 365."
  }
}

variable "noncurrent_version_retention_days" {
  description = "Days to retain old blob versions before lifecycle deletion."
  type        = number
  default     = 365
}

variable "tags" {
  description = "Additional ownership and cost-allocation tags."
  type        = map(string)
  default     = {}
}
