variable "name_prefix" {
  description = "Prefix applied to resource names."
  type        = string
}

variable "resource_arn" {
  description = "ARN of the load balancer to associate the web ACL with."
  type        = string
}

variable "rate_limit_per_5min" {
  description = "Requests per five minutes from one IP before blocking."
  type        = number
  default     = 10000
}

variable "log_retention_days" {
  description = "Retention in days for WAF logs."
  type        = number
  default     = 90
}
