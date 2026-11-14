/**
 * Alerts and diagnostics scoped to the deployed Container App.
 *
 * Separate from modules/observability so that the Container Apps environment
 * can consume the Log Analytics workspace without creating a dependency cycle
 * (environment -> workspace, alerts -> app -> environment).
 */

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.10"
    }
  }
}

resource "azurerm_monitor_metric_alert" "replica_restarts" {
  name                = "alert-${var.name_prefix}-restarts"
  resource_group_name = var.resource_group_name
  description         = "Replicas are restarting repeatedly, which usually means a crash loop or a failing probe."
  severity            = 1
  frequency           = "PT5M"
  window_size         = "PT15M"
  scopes              = [var.container_app_id]

  criteria {
    metric_namespace = "Microsoft.App/containerApps"
    metric_name      = "RestartCount"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = var.restart_threshold
  }

  action {
    action_group_id = var.action_group_id
  }

  tags = var.tags
}

resource "azurerm_monitor_metric_alert" "request_failures" {
  name                = "alert-${var.name_prefix}-5xx"
  resource_group_name = var.resource_group_name
  description         = "Sustained 5xx responses from the service, breaching the availability objective."
  severity            = 1
  frequency           = "PT1M"
  window_size         = "PT5M"
  scopes              = [var.container_app_id]

  criteria {
    metric_namespace = "Microsoft.App/containerApps"
    metric_name      = "Requests"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = var.error_request_threshold

    dimension {
      name     = "statusCodeCategory"
      operator = "Include"
      values   = ["5xx"]
    }
  }

  action {
    action_group_id = var.action_group_id
  }

  tags = var.tags
}

resource "azurerm_monitor_diagnostic_setting" "container_app" {
  name                       = "diag-${var.name_prefix}"
  target_resource_id         = var.container_app_id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "ContainerAppConsoleLogs"
  }

  enabled_log {
    category = "ContainerAppSystemLogs"
  }
}
