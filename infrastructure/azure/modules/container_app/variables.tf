variable "name" {
  description = "Container App name."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group to deploy into."
  type        = string
}

variable "container_app_environment_id" {
  description = "Container Apps environment to host this app."
  type        = string
}

variable "identity_id" {
  description = "User-assigned managed identity used for registry pulls and Key Vault reads."
  type        = string
}

variable "registry_server" {
  description = "Container registry login server."
  type        = string
}

variable "image" {
  description = "Fully qualified container image."
  type        = string
}

variable "container_name" {
  description = "Name of the container inside the app."
  type        = string
}

variable "target_port" {
  description = "Port the container listens on."
  type        = number
}

variable "cpu" {
  description = "vCPU per replica."
  type        = number
}

variable "memory" {
  description = "Memory per replica, e.g. \"1Gi\"."
  type        = string
}

variable "min_replicas" {
  description = "Minimum replicas."
  type        = number
}

variable "max_replicas" {
  description = "Maximum replicas."
  type        = number
}

variable "concurrent_requests_per_replica" {
  description = "Concurrent requests per replica before scaling out."
  type        = number
  default     = 100
}

variable "external_ingress" {
  description = "Expose the app outside the Container Apps environment."
  type        = bool
  default     = true
}

variable "health_probe_path" {
  description = "Liveness and startup probe path."
  type        = string
  default     = "/healthz"
}

variable "readiness_probe_path" {
  description = "Readiness probe path."
  type        = string
  default     = "/readyz"
}

variable "environment_variables" {
  description = "Plain environment variables."
  type        = map(string)
  default     = {}
}

variable "key_vault_secrets" {
  description = "Map of secret name to versionless Key Vault secret id."
  type        = map(string)
  default     = {}
}

variable "secret_environment_variables" {
  description = "Map of environment variable name to the secret name it reads."
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Tags applied to the app."
  type        = map(string)
  default     = {}
}
