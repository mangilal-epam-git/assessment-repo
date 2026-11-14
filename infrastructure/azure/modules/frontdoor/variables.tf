variable "name_prefix" {
  description = "Prefix applied to resource names."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group to deploy into."
  type        = string
}

variable "origin_host_name" {
  description = "Hostname of the origin that Front Door forwards to."
  type        = string
}

variable "waf_mode" {
  description = "Detection or Prevention."
  type        = string
  default     = "Prevention"
}

variable "rate_limit_per_minute" {
  description = "Requests per minute from one IP before blocking."
  type        = number
  default     = 2000
}

variable "log_analytics_workspace_id" {
  description = "Workspace that receives access and WAF logs."
  type        = string
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
