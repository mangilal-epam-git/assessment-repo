variable "name_prefix" {
  description = "Prefix applied to resource names."
  type        = string
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "aws_region" {
  description = "Region, needed by the awslogs driver."
  type        = string
}

variable "vpc_id" {
  description = "VPC to deploy into."
  type        = string
}

variable "public_subnet_ids" {
  description = "Subnets for the load balancer."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Subnets for the Fargate tasks."
  type        = list(string)
}

variable "allowed_ingress_cidrs" {
  description = "CIDR blocks allowed to reach the load balancer."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "certificate_arn" {
  description = "ACM certificate ARN. Empty means HTTP only."
  type        = string
  default     = ""
}

variable "service_image" {
  description = "Container image for the service."
  type        = string
}

variable "mock_provider_image" {
  description = "Container image for the mock providers."
  type        = string
  default     = ""
}

variable "deploy_mock_providers" {
  description = "Deploy the mock telemetry providers."
  type        = bool
  default     = true
}

variable "telemetry1_url" {
  description = "Endpoint for the telemetry1 source."
  type        = string
}

variable "telemetry2_url" {
  description = "Endpoint for the telemetry2 source."
  type        = string
}

variable "service_cpu" {
  description = "Fargate CPU units."
  type        = number
  default     = 512
}

variable "service_memory" {
  description = "Fargate memory in MiB."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Baseline task count."
  type        = number
  default     = 3
}

variable "min_capacity" {
  description = "Autoscaling minimum."
  type        = number
  default     = 3
}

variable "max_capacity" {
  description = "Autoscaling maximum."
  type        = number
  default     = 40
}

variable "target_requests_per_task" {
  description = "Target ALBRequestCountPerTarget, in requests per target per minute."
  type        = number
  default     = 12000
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 90
}

variable "enable_deletion_protection" {
  description = "Protect the load balancer from deletion."
  type        = bool
  default     = true
}

variable "log_level" {
  description = "Application log level."
  type        = string
  default     = "info"
}

variable "load_balancer_label" {
  description = "Override for the autoscaling resource label. Normally derived from the load balancer and target group."
  type        = string
  default     = ""
}
