variable "name_prefix" {
  description = "Prefix applied to resource names."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group to deploy into."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "log_retention_days" {
  description = "Log Analytics retention in days."
  type        = number
  default     = 90
}

variable "alarm_email_subscriptions" {
  description = "Email addresses that receive alerts."
  type        = list(string)
  default     = []
}

variable "error_count_threshold" {
  description = "Error log lines per five minutes before alerting."
  type        = number
  default     = 5
}

variable "provider_failure_threshold" {
  description = "Provider-unavailable events per five minutes before alerting."
  type        = number
  default     = 10
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
