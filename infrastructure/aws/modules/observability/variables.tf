variable "name_prefix" {
  description = "Prefix applied to resource names."
  type        = string
}

variable "aws_region" {
  description = "Region the dashboard renders metrics from."
  type        = string
}

variable "alarm_email_subscriptions" {
  description = "Email addresses subscribed to the alarm topic."
  type        = list(string)
  default     = []
}

variable "load_balancer_suffix" {
  description = "ALB ARN suffix for CloudWatch dimensions."
  type        = string
}

variable "target_group_suffix" {
  description = "Target group ARN suffix for CloudWatch dimensions."
  type        = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name."
  type        = string
}

variable "ecs_service_name" {
  description = "ECS service name."
  type        = string
}

variable "log_group_name" {
  description = "Application log group that metric filters read."
  type        = string
}

variable "error_count_threshold" {
  description = "5xx responses per minute before alarming."
  type        = number
  default     = 5
}

variable "p99_latency_seconds" {
  description = "p99 latency objective in seconds."
  type        = number
  default     = 1.0
}

variable "provider_failure_threshold" {
  description = "Provider-unavailable events per five minutes before alarming."
  type        = number
  default     = 10
}
