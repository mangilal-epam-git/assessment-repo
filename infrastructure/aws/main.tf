/**
 * VectorHarbor best-offers - AWS root module.
 *
 * Topology: public ALB (WAF-protected) -> ECS Fargate tasks in private
 * subnets -> provider endpoints via NAT. Configuration lives in SSM Parameter
 * Store, secrets in Secrets Manager, telemetry in CloudWatch.
 *
 * See docs/architecture/deployment.md for the reasoning and
 * docs/architecture/cost-model.md for the sizing assumptions behind the
 * defaults in variables.tf.
 */

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  name_prefix = "vh-${var.environment}-best-offers"

  azs = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)

  # Production keeps per-AZ NAT gateways so that losing one AZ does not remove
  # egress to the provider endpoints.
  use_single_nat = var.environment == "prod" ? false : var.single_nat_gateway

  service_image = var.service_image != "" ? var.service_image : "${module.ecr_service.repository_url}:latest"
  mock_image    = var.mock_provider_image != "" ? var.mock_provider_image : "${module.ecr_mock.repository_url}:latest"

  # When the mocks are deployed they are reached over the internal service
  # discovery namespace; otherwise the real certified provider endpoints are used.
  telemetry1_url = var.deploy_mock_providers ? "http://mock-providers.${local.name_prefix}.internal:8081/provider/telemetry1" : var.provider_telemetry1_url
  telemetry2_url = var.deploy_mock_providers ? "http://mock-providers.${local.name_prefix}.internal:8081/provider/telemetry2" : var.provider_telemetry2_url
}

# Fail the plan early rather than deploying a service that cannot reach a provider.
resource "terraform_data" "provider_endpoint_guard" {
  lifecycle {
    precondition {
      condition     = var.deploy_mock_providers || (var.provider_telemetry1_url != "" && var.provider_telemetry2_url != "")
      error_message = "With deploy_mock_providers = false you must set provider_telemetry1_url and provider_telemetry2_url."
    }
    precondition {
      condition     = var.environment != "prod" || var.certificate_arn != ""
      error_message = "Production requires certificate_arn so the listener can terminate TLS."
    }
    precondition {
      condition     = var.service_min_capacity <= var.service_desired_count && var.service_desired_count <= var.service_max_capacity
      error_message = "service_min_capacity <= service_desired_count <= service_max_capacity must hold."
    }
  }
}

module "network" {
  source = "./modules/network"

  name_prefix        = local.name_prefix
  vpc_cidr           = var.vpc_cidr
  availability_zones = local.azs
  single_nat_gateway = local.use_single_nat
  flow_log_retention = var.log_retention_days
}

module "ecr_service" {
  source = "./modules/ecr"

  repository_name = "${local.name_prefix}-service"
  # Dev may overwrite tags while iterating; everything else is immutable so a
  # deployed digest can always be traced back to a commit.
  immutable_tags = var.environment != "dev"
}

module "ecr_mock" {
  source = "./modules/ecr"

  repository_name = "${local.name_prefix}-mock-providers"
  immutable_tags  = false
}

module "observability" {
  source = "./modules/observability"

  name_prefix               = local.name_prefix
  aws_region                = var.aws_region
  alarm_email_subscriptions = var.alarm_email_subscriptions
  load_balancer_suffix      = module.service.load_balancer_arn_suffix
  target_group_suffix       = module.service.target_group_arn_suffix
  ecs_cluster_name          = module.service.cluster_name
  ecs_service_name          = module.service.service_name
  log_group_name            = module.service.log_group_name
}

module "waf" {
  source = "./modules/waf"

  name_prefix         = local.name_prefix
  resource_arn        = module.service.load_balancer_arn
  rate_limit_per_5min = var.waf_rate_limit_per_5min
  log_retention_days  = var.log_retention_days
}

module "service" {
  source = "./modules/service"

  name_prefix = local.name_prefix
  environment = var.environment
  aws_region  = var.aws_region

  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  private_subnet_ids    = module.network.private_subnet_ids
  allowed_ingress_cidrs = var.allowed_ingress_cidrs
  certificate_arn       = var.certificate_arn

  service_image  = local.service_image
  service_cpu    = var.service_cpu
  service_memory = var.service_memory
  desired_count  = var.service_desired_count
  min_capacity   = var.service_min_capacity
  max_capacity   = var.service_max_capacity

  target_requests_per_task   = var.target_requests_per_task
  log_retention_days         = var.log_retention_days
  enable_deletion_protection = var.enable_deletion_protection
  log_level                  = var.log_level

  deploy_mock_providers = var.deploy_mock_providers
  mock_provider_image   = local.mock_image
  telemetry1_url        = local.telemetry1_url
  telemetry2_url        = local.telemetry2_url
}
