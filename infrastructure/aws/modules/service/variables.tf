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

# ---------------------------------------------------------------------------
# Fleet assistant (supervised agent)
# ---------------------------------------------------------------------------

variable "deploy_agent" {
  description = "Deploy the supervised fleet assistant alongside the best-offers service."
  type        = bool
  default     = false
}

variable "agent_image" {
  description = "Container image for the fleet assistant."
  type        = string
  default     = ""
}

variable "agent_model_backend" {
  description = "Inference backend: deterministic, anthropic, openai, azure-openai or ollama."
  type        = string
  default     = "deterministic"
}

variable "agent_model_name" {
  description = "Model identifier, or the deployment name for Azure OpenAI."
  type        = string
  default     = ""
}

variable "agent_model_base_url" {
  description = "Override the inference endpoint. Required for Azure OpenAI and for self-hosted inference."
  type        = string
  default     = ""
}

variable "agent_model_timeout_millis" {
  description = "Per-call timeout for the inference endpoint."
  type        = number
  default     = 30000
}

variable "agent_model_max_tokens" {
  description = "Upper bound on output tokens per model call; a direct cost control."
  type        = number
  default     = 2048
}

variable "agent_max_iterations" {
  description = "Upper bound on tool-use iterations per turn."
  type        = number
  default     = 8
}

variable "agent_proposal_ttl_millis" {
  description = "How long a proposal remains open before it expires unapproved."
  type        = number
  default     = 14400000
}

variable "agent_four_eyes_threshold_minor" {
  description = "Value above which a proposal requires a second approver."
  type        = number
  default     = 100000
}

variable "agent_tenant_budget_minor" {
  description = "Tenant spend ceiling re-checked at execution time."
  type        = number
  default     = 5000000
}

variable "agent_cpu" {
  description = "Fargate CPU units for the assistant."
  type        = number
  default     = 512
}

variable "agent_memory" {
  description = "Fargate memory in MiB for the assistant."
  type        = number
  default     = 1024
}

variable "agent_desired_count" {
  description = "Baseline assistant task count."
  type        = number
  default     = 2
}

variable "agent_min_capacity" {
  description = "Autoscaling minimum for the assistant."
  type        = number
  default     = 2
}

variable "agent_max_capacity" {
  description = "Autoscaling maximum for the assistant."
  type        = number
  default     = 10
}

variable "agent_target_requests_per_task" {
  description = "Autoscaling target in requests per target per minute. Agent turns take seconds, so this is far below the best-offers target."
  type        = number
  default     = 120
}

variable "agent_max_concurrent" {
  description = "Concurrent turns a single task will accept before shedding."
  type        = number
  default     = 32
}
