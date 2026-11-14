/**
 * Alarms, dashboard, log-based metrics and the alert topic.
 *
 * The alarm set is derived from the service level objectives in
 * docs/architecture/observability.md: availability, latency, provider health,
 * saturation and pricing-configuration integrity. Every alarm here is
 * actionable; anything merely interesting belongs on the dashboard instead.
 */

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

data "aws_region" "current" {}

resource "aws_sns_topic" "alarms" {
  name = "${var.name_prefix}-alarms"

  tags = {
    Name = "${var.name_prefix}-alarms"
  }
}

resource "aws_sns_topic_subscription" "email" {
  for_each = toset(var.alarm_email_subscriptions)

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------------------------------------------------------------------------
# Log-derived metrics
#
# The application already emits structured JSON; these turn the operationally
# significant events into first-class metrics without an agent.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "provider_unavailable" {
  name           = "${var.name_prefix}-provider-unavailable"
  log_group_name = var.log_group_name
  pattern        = "{ $.message = \"provider.unavailable\" }"

  metric_transformation {
    name      = "ProviderUnavailable"
    namespace = "VectorHarbor/BestOffers"
    value     = "1"
    unit      = "Count"
    dimensions = {
      providerId = "$.providerId"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "config_reload_rejected" {
  name           = "${var.name_prefix}-config-reload-rejected"
  log_group_name = var.log_group_name
  pattern        = "{ $.message = \"config.reload.rejected\" || $.message = \"config.reload.unreadable\" }"

  metric_transformation {
    name          = "ConfigReloadRejected"
    namespace     = "VectorHarbor/BestOffers"
    value         = "1"
    unit          = "Count"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "unhandled_error" {
  name           = "${var.name_prefix}-unhandled-error"
  log_group_name = var.log_group_name
  pattern        = "{ $.level = \"error\" }"

  metric_transformation {
    name          = "ApplicationErrors"
    namespace     = "VectorHarbor/BestOffers"
    value         = "1"
    unit          = "Count"
    default_value = "0"
  }
}

# ---------------------------------------------------------------------------
# Alarms
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "unhealthy_hosts" {
  alarm_name          = "${var.name_prefix}-unhealthy-targets"
  alarm_description   = "One or more tasks are failing the readiness check. Investigate before capacity is lost."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.load_balancer_suffix
    TargetGroup  = var.target_group_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "server_errors" {
  alarm_name          = "${var.name_prefix}-5xx-rate"
  alarm_description   = "Sustained 5xx responses from the service. This breaches the availability objective."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = var.error_count_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.load_balancer_suffix
    TargetGroup  = var.target_group_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "latency" {
  alarm_name          = "${var.name_prefix}-p99-latency"
  alarm_description   = "p99 response time is above the latency objective."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p99"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = var.p99_latency_seconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.load_balancer_suffix
    TargetGroup  = var.target_group_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "provider_unavailable" {
  alarm_name          = "${var.name_prefix}-provider-unavailable"
  alarm_description   = "A telemetry provider is repeatedly unreachable. Results are degrading to partial."
  namespace           = "VectorHarbor/BestOffers"
  metric_name         = "ProviderUnavailable"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.provider_failure_threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.provider_unavailable]
}

resource "aws_cloudwatch_metric_alarm" "config_reload_rejected" {
  alarm_name          = "${var.name_prefix}-config-reload-rejected"
  alarm_description   = "A pricing configuration reload was rejected. The service is still serving the previous snapshot, but someone shipped an invalid change."
  namespace           = "VectorHarbor/BestOffers"
  metric_name         = "ConfigReloadRejected"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.config_reload_rejected]
}

resource "aws_cloudwatch_metric_alarm" "cpu_saturation" {
  alarm_name          = "${var.name_prefix}-cpu-saturation"
  alarm_description   = "Service CPU is saturated and autoscaling may be at its ceiling."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_service_name
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "no_traffic" {
  alarm_name          = "${var.name_prefix}-no-traffic"
  alarm_description   = "The service received no requests for fifteen minutes. Either traffic is being dropped upstream or the service is unreachable."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "RequestCount"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    LoadBalancer = var.load_balancer_suffix
  }

  alarm_actions = [aws_sns_topic.alarms.arn]
}

# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = "${var.name_prefix}-overview"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Requests and errors"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.load_balancer_suffix],
            [".", "HTTPCode_Target_2XX_Count", ".", "."],
            [".", "HTTPCode_Target_5XX_Count", ".", "."],
            [".", "HTTPCode_ELB_5XX_Count", ".", "."],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Latency (p50 / p95 / p99)"
          region = var.aws_region
          view   = "timeSeries"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.load_balancer_suffix, { stat = "p50" }],
            ["...", { stat = "p95" }],
            ["...", { stat = "p99" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Capacity and saturation"
          region = var.aws_region
          view   = "timeSeries"
          period = 60
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", var.ecs_service_name, { stat = "Average" }],
            [".", "MemoryUtilization", ".", ".", ".", ".", { stat = "Average" }],
            ["AWS/ApplicationELB", "HealthyHostCount", "LoadBalancer", var.load_balancer_suffix, "TargetGroup", var.target_group_suffix, { stat = "Minimum" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Provider health and configuration integrity"
          region = var.aws_region
          view   = "timeSeries"
          stat   = "Sum"
          period = 300
          metrics = [
            ["VectorHarbor/BestOffers", "ProviderUnavailable"],
            [".", "ConfigReloadRejected"],
            [".", "ApplicationErrors"],
          ]
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 12
        width  = 24
        height = 6
        properties = {
          title  = "Recent warnings and errors"
          region = var.aws_region
          query  = "SOURCE '${var.log_group_name}' | fields @timestamp, level, message, requestId, providerId, cause | filter level in ['warn','error'] | sort @timestamp desc | limit 50"
        }
      },
    ]
  })
}
