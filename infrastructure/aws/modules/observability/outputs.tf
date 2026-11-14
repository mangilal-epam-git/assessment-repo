output "alarm_topic_arn" {
  description = "SNS topic that alarms publish to."
  value       = aws_sns_topic.alarms.arn
}

output "dashboard_name" {
  description = "CloudWatch dashboard name."
  value       = aws_cloudwatch_dashboard.this.dashboard_name
}

output "dashboard_url" {
  description = "Direct link to the dashboard."
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.this.dashboard_name}"
}

output "alarm_names" {
  description = "All alarm names, for runbook cross-referencing."
  value = [
    aws_cloudwatch_metric_alarm.unhealthy_hosts.alarm_name,
    aws_cloudwatch_metric_alarm.server_errors.alarm_name,
    aws_cloudwatch_metric_alarm.latency.alarm_name,
    aws_cloudwatch_metric_alarm.provider_unavailable.alarm_name,
    aws_cloudwatch_metric_alarm.config_reload_rejected.alarm_name,
    aws_cloudwatch_metric_alarm.cpu_saturation.alarm_name,
    aws_cloudwatch_metric_alarm.no_traffic.alarm_name,
  ]
}
