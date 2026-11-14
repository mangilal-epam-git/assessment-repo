variable "name_prefix" {
  description = "Prefix applied to resource names."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group to deploy into."
  type        = string
}

variable "container_app_id" {
  description = "Container App resource id that alerts and diagnostics target."
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Workspace that receives the diagnostic logs."
  type        = string
}

variable "action_group_id" {
  description = "Action group that alerts notify."
  type        = string
}

variable "restart_threshold" {
  description = "Replica restarts in the window before alerting."
  type        = number
  default     = 5
}

variable "error_request_threshold" {
  description = "5xx responses in the window before alerting."
  type        = number
  default     = 10
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
