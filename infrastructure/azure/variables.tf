variable "location" {
  description = "Azure region. Must sit inside the jurisdiction the launch cohort may be served from."
  type        = string
  default     = "swedencentral"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of dev, staging or prod."
  }
}

variable "resource_group_name" {
  description = "Resource group to create. Leave empty to derive it from the naming convention."
  type        = string
  default     = ""
}

variable "owner_tag" {
  description = "Owning team, for cost attribution and incident routing."
  type        = string
  default     = "platform-data-marketplace"
}

variable "cost_centre" {
  description = "Finance cost centre code."
  type        = string
  default     = "CC-DATA-001"
}

variable "vnet_cidr" {
  description = "Address space for the virtual network."
  type        = string
  default     = "10.50.0.0/16"

  validation {
    condition     = can(cidrhost(var.vnet_cidr, 0))
    error_message = "vnet_cidr must be a valid IPv4 CIDR block."
  }
}

variable "service_image" {
  description = "Container image for the best-offers service. Leave empty to use the registry created here at the :latest tag."
  type        = string
  default     = ""
}

variable "mock_provider_image" {
  description = "Container image for the mock providers."
  type        = string
  default     = ""
}

variable "deploy_mock_providers" {
  description = "Deploy the mock telemetry providers. False in production, which consumes certified feeds."
  type        = bool
  default     = true
}

variable "service_cpu" {
  description = "vCPU allocated to each service replica."
  type        = number
  default     = 0.5
}

variable "service_memory" {
  description = "Memory per replica, e.g. \"1Gi\". Container Apps requires a valid CPU/memory pairing."
  type        = string
  default     = "1Gi"
}

variable "min_replicas" {
  description = "Minimum replica count. Keep at or above 2 outside dev so a node recycle is invisible."
  type        = number
  default     = 3
}

variable "max_replicas" {
  description = "Maximum replica count, sized for the seasonal and severe-weather surges."
  type        = number
  default     = 40
}

variable "concurrent_requests_per_replica" {
  description = "Concurrent requests per replica before KEDA scales out."
  type        = number
  default     = 100
}

variable "log_retention_days" {
  description = "Log Analytics retention in days."
  type        = number
  default     = 90
}

variable "enable_front_door" {
  description = "Put Azure Front Door with WAF in front of the Container App. Required for the DDoS resilience objective in staging and production."
  type        = bool
  default     = true
}

variable "waf_rate_limit_per_minute" {
  description = "Requests per minute from one IP before the Front Door WAF rate rule blocks it."
  type        = number
  default     = 2000
}

variable "waf_mode" {
  description = "Front Door WAF policy mode. Use Detection to tune, Prevention to enforce."
  type        = string
  default     = "Prevention"

  validation {
    condition     = contains(["Detection", "Prevention"], var.waf_mode)
    error_message = "waf_mode must be Detection or Prevention."
  }
}

variable "provider_telemetry1_url" {
  description = "Endpoint for the telemetry1 source. Ignored when deploy_mock_providers is true."
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

variable "alarm_email_subscriptions" {
  description = "Email addresses that receive alerts."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Fleet assistant (supervised agent)
#
# See docs/architecture/24-ai-model-strategy.md for the backend options and
# what each implies for cost and data residency.
# ---------------------------------------------------------------------------

variable "deploy_agent" {
  description = "Deploy the supervised fleet assistant."
  type        = bool
  default     = true
}

variable "agent_image" {
  description = "Container image for the fleet assistant. Leave empty to use the registry created here."
  type        = string
  default     = ""
}

variable "agent_model_backend" {
  description = "Inference backend. 'deterministic' needs no key, no network and no model."
  type        = string
  default     = "deterministic"

  validation {
    condition     = contains(["deterministic", "anthropic", "openai", "azure-openai", "ollama"], var.agent_model_backend)
    error_message = "agent_model_backend must be deterministic, anthropic, openai, azure-openai or ollama."
  }
}

variable "agent_model_name" {
  description = "Model identifier, or the deployment name for Azure OpenAI. Pin an explicit version."
  type        = string
  default     = ""
}

variable "agent_model_base_url" {
  description = "Inference endpoint. Required for azure-openai and ollama, e.g. https://my-resource.openai.azure.com"
  type        = string
  default     = ""
}

variable "agent_cpu" {
  description = "vCPU per assistant replica."
  type        = number
  default     = 0.5
}

variable "agent_memory" {
  description = "Memory per assistant replica."
  type        = string
  default     = "1Gi"
}

variable "agent_min_replicas" {
  description = "Minimum assistant replicas."
  type        = number
  default     = 2
}

variable "agent_max_replicas" {
  description = "Maximum assistant replicas."
  type        = number
  default     = 10
}

variable "agent_concurrent_requests_per_replica" {
  description = "Concurrent turns per replica before KEDA scales out. Agent turns are long, so this is low."
  type        = number
  default     = 20
}

variable "agent_proposal_ttl_millis" {
  description = "How long a proposal stays open before expiring unapproved."
  type        = number
  default     = 14400000
}

variable "agent_four_eyes_threshold_minor" {
  description = "Value above which a proposal needs a second approver."
  type        = number
  default     = 100000
}
