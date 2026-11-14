output "service_url" {
  description = "Base URL of the deployed best-offers service."
  value       = module.service.service_url
}

output "best_offers_endpoint" {
  description = "Full URL of the ranking endpoint."
  value       = "${module.service.service_url}/best-offers"
}

output "load_balancer_dns_name" {
  description = "DNS name of the application load balancer."
  value       = module.service.load_balancer_dns_name
}

output "service_repository_url" {
  description = "ECR repository to push the service image to."
  value       = module.ecr_service.repository_url
}

output "mock_provider_repository_url" {
  description = "ECR repository to push the mock provider image to."
  value       = module.ecr_mock.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name, for `aws ecs` CLI operations."
  value       = module.service.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name, used to force a new deployment."
  value       = module.service.service_name
}

output "log_group_name" {
  description = "CloudWatch log group holding structured application logs."
  value       = module.service.log_group_name
}

output "admin_token_secret_arn" {
  description = "Secrets Manager ARN holding the admin reload token."
  value       = module.service.admin_token_secret_arn
}

output "pricing_config_parameter_name" {
  description = "SSM parameter holding the pricing configuration snapshot."
  value       = module.service.pricing_config_parameter_name
}

output "alarm_topic_arn" {
  description = "SNS topic that alarms publish to."
  value       = module.observability.alarm_topic_arn
}

output "dashboard_url" {
  description = "CloudWatch dashboard for the service."
  value       = module.observability.dashboard_url
}

output "deployment_summary" {
  description = "Human-readable summary of what was deployed."
  value = {
    environment       = var.environment
    region            = var.aws_region
    availability_zone = module.network.availability_zones
    mocks_deployed    = var.deploy_mock_providers
    tls_enabled       = var.certificate_arn != ""
    account_id        = data.aws_caller_identity.current.account_id
  }
}
