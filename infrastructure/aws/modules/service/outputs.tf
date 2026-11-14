output "service_url" {
  description = "Base URL of the service."
  value       = var.certificate_arn != "" ? "https://${aws_lb.this.dns_name}" : "http://${aws_lb.this.dns_name}"
}

output "load_balancer_dns_name" {
  description = "Load balancer DNS name."
  value       = aws_lb.this.dns_name
}

output "load_balancer_arn" {
  description = "Load balancer ARN, used for the WAF association."
  value       = aws_lb.this.arn
}

output "load_balancer_arn_suffix" {
  description = "Load balancer ARN suffix, used in CloudWatch dimensions."
  value       = aws_lb.this.arn_suffix
}

output "target_group_arn_suffix" {
  description = "Target group ARN suffix, used in CloudWatch dimensions."
  value       = aws_lb_target_group.this.arn_suffix
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.this.name
}

output "log_group_name" {
  description = "Application log group."
  value       = aws_cloudwatch_log_group.service.name
}

output "admin_token_secret_arn" {
  description = "Secrets Manager ARN of the admin token."
  value       = aws_secretsmanager_secret.admin_token.arn
}

output "pricing_config_parameter_name" {
  description = "SSM parameter name of the pricing snapshot."
  value       = aws_ssm_parameter.pricing_config.name
}

output "task_security_group_id" {
  description = "Security group attached to the service tasks."
  value       = aws_security_group.tasks.id
}

output "agent_deployed" {
  description = "Whether the fleet assistant was deployed."
  value       = var.deploy_agent
}

output "agent_service_name" {
  description = "ECS service name of the fleet assistant."
  value       = var.deploy_agent ? aws_ecs_service.agent[0].name : ""
}

output "agent_console_url" {
  description = "URL of the supervision console."
  value       = var.deploy_agent ? "${var.certificate_arn != "" ? "https" : "http"}://${aws_lb.this.dns_name}/console" : ""
}

output "agent_api_url" {
  description = "Base URL of the agent API."
  value       = var.deploy_agent ? "${var.certificate_arn != "" ? "https" : "http"}://${aws_lb.this.dns_name}/agent" : ""
}

output "agent_model_secret_name" {
  description = "Secrets Manager secret holding the inference API key. Empty when the backend needs no key."
  value       = var.deploy_agent && local.agent_needs_model_key ? aws_secretsmanager_secret.model_api_key[0].name : ""
}

output "agent_log_group_name" {
  description = "CloudWatch log group for the assistant."
  value       = var.deploy_agent ? aws_cloudwatch_log_group.agent[0].name : ""
}

output "agent_target_group_arn_suffix" {
  description = "Assistant target group ARN suffix, for CloudWatch dimensions."
  value       = var.deploy_agent ? aws_lb_target_group.agent[0].arn_suffix : ""
}
