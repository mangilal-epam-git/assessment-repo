variable "name_prefix" {
  description = "Prefix applied to every resource name in this module."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
}

variable "availability_zones" {
  description = "Availability zones to spread subnets across."
  type        = list(string)
}

variable "single_nat_gateway" {
  description = "Share one NAT gateway across all AZs instead of one per AZ."
  type        = bool
  default     = false
}

variable "flow_log_retention" {
  description = "Retention in days for VPC flow logs."
  type        = number
  default     = 90
}
