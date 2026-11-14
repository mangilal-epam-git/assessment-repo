variable "aws_region" {
  description = "AWS region for all resources. Must be inside the jurisdiction the launch cohort is allowed to be served from (see docs/architecture/data-residency.md)."
  type        = string
  default     = "eu-north-1"

  validation {
    condition     = can(regex("^(eu|us|ap|ca|sa|me|af)-[a-z]+-[0-9]$", var.aws_region))
    error_message = "aws_region must be a valid AWS region identifier."
  }
}

variable "environment" {
  description = "Deployment environment name."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of dev, staging or prod."
  }
}

variable "owner_tag" {
  description = "Owning team, used for cost attribution and incident routing."
  type        = string
  default     = "platform-data-marketplace"
}

variable "cost_centre" {
  description = "Finance cost centre code for chargeback."
  type        = string
  default     = "CC-DATA-001"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block."
  }
}

variable "availability_zone_count" {
  description = "Number of availability zones to spread across. Three is the minimum for the 99.95% target."
  type        = number
  default     = 3

  validation {
    condition     = var.availability_zone_count >= 2 && var.availability_zone_count <= 4
    error_message = "availability_zone_count must be between 2 and 4."
  }
}

variable "single_nat_gateway" {
  description = "Use one NAT gateway instead of one per AZ. Cheaper, but a single AZ failure removes egress; acceptable in dev only."
  type        = bool
  default     = false
}

variable "service_image" {
  description = "Fully qualified container image for the best-offers service. Leave empty to use the ECR repository created here at the :latest tag."
  type        = string
  default     = ""
}

variable "mock_provider_image" {
  description = "Container image for the mock provider endpoints. Deployed only when deploy_mock_providers is true."
  type        = string
  default     = ""
}

variable "deploy_mock_providers" {
  description = "Deploy the mock telemetry providers alongside the service. True for dev and staging; false in production, where real certified providers are used."
  type        = bool
  default     = true
}

variable "service_cpu" {
  description = "Fargate task CPU units (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "service_memory" {
  description = "Fargate task memory in MiB. Must be a valid pairing with service_cpu."
  type        = number
  default     = 1024
}

variable "service_desired_count" {
  description = "Baseline task count before autoscaling."
  type        = number
  default     = 3

  validation {
    condition     = var.service_desired_count >= 1
    error_message = "service_desired_count must be at least 1."
  }
}

variable "service_min_capacity" {
  description = "Minimum task count under autoscaling."
  type        = number
  default     = 3
}

variable "service_max_capacity" {
  description = "Maximum task count under autoscaling. Sized for the seasonal and severe-weather surges in the capacity plan."
  type        = number
  default     = 40
}

variable "target_requests_per_task" {
  description = "Autoscaling target for ALBRequestCountPerTarget, in requests per target per MINUTE. 12000/min equals 200 requests per second per task, which is the planning figure derived in docs/architecture/12-capacity-plan.md."
  type        = number
  default     = 12000
}

variable "log_retention_days" {
  description = "CloudWatch log retention. Audit-relevant streams are additionally archived to S3 with Object Lock."
  type        = number
  default     = 90
}

variable "enable_deletion_protection" {
  description = "Protect the load balancer from accidental deletion. Always true in production."
  type        = bool
  default     = true
}

variable "waf_rate_limit_per_5min" {
  description = "Requests per 5 minutes from a single IP before the WAF rate rule blocks it."
  type        = number
  default     = 10000
}

variable "allowed_ingress_cidrs" {
  description = "CIDR blocks permitted to reach the public load balancer. Defaults to the internet; narrow this for the phase-one pilot cohort."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS. When empty, only an HTTP listener is created (acceptable in dev only)."
  type        = string
  default     = ""
}

variable "alarm_email_subscriptions" {
  description = "Email addresses subscribed to the alerting topic. Production should point at the on-call integration instead."
  type        = list(string)
  default     = []
}

variable "provider_telemetry1_url" {
  description = "Endpoint for the telemetry1 source. Ignored when deploy_mock_providers is true, which wires the in-cluster mock instead."
  type        = string
  default     = ""
}

variable "provider_telemetry2_url" {
  description = "Endpoint for the telemetry2 source. Ignored when deploy_mock_providers is true."
  type        = string
  default     = ""
}

variable "log_level" {
  description = "Application log level."
  type        = string
  default     = "info"

  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.log_level)
    error_message = "log_level must be one of debug, info, warn or error."
  }
}
