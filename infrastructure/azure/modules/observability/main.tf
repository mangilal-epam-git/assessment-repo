/**
 * Log Analytics, Application Insights, the action group and the alert set.
 *
 * Mirrors the AWS alarm set so that an on-call engineer sees the same signals
 * whichever cloud an environment runs in: availability, latency, error rate
 * and pricing-configuration integrity.
 *
 * This module owns everything that only needs the workspace. Alerts scoped to
 * the Container App itself live in modules/app_alerts, because the Container
 * Apps environment needs this workspace id and depending on the app here
 * would close a dependency cycle.
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

resource "azurerm_log_analytics_workspace" "this" {
  name                = "law-${var.name_prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = var.tags
}

resource "azurerm_application_insights" "this" {
  name                = "appi-${var.name_prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "web"
  tags                = var.tags
}

resource "azurerm_monitor_action_group" "this" {
  name                = "ag-${var.name_prefix}"
  resource_group_name = var.resource_group_name
  short_name          = substr(replace(var.name_prefix, "-", ""), 0, 12)
  tags                = var.tags

  dynamic "email_receiver" {
    for_each = var.alarm_email_subscriptions
    content {
      name                    = "email-${email_receiver.key}"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }
}

# ---------------------------------------------------------------------------
# Log-query alerts
#
# The application emits structured JSON to stdout, which Container Apps ships
# to ContainerAppConsoleLogs_CL. These queries turn the operationally
# significant events into alerts.
# ---------------------------------------------------------------------------

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "application_errors" {
  name                = "alert-${var.name_prefix}-errors"
  resource_group_name = var.resource_group_name
  location            = var.location
  description         = "The service logged errors. Investigate before the availability objective is breached."
  severity            = 1
  enabled             = true
  scopes              = [azurerm_log_analytics_workspace.this.id]

  evaluation_frequency = "PT5M"
  window_duration      = "PT15M"

  criteria {
    query                   = <<-QUERY
      ContainerAppConsoleLogs_CL
      | where Log_s has "\"level\":\"error\""
      | summarize AggregatedValue = count() by bin(TimeGenerated, 5m)
    QUERY
    time_aggregation_method = "Total"
    threshold               = var.error_count_threshold
    operator                = "GreaterThan"

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.this.id]
  }

  tags = var.tags
}

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "provider_unavailable" {
  name                = "alert-${var.name_prefix}-provider-unavailable"
  resource_group_name = var.resource_group_name
  location            = var.location
  description         = "A telemetry provider is repeatedly unreachable, so results are degrading to partial."
  severity            = 2
  enabled             = true
  scopes              = [azurerm_log_analytics_workspace.this.id]

  evaluation_frequency = "PT5M"
  window_duration      = "PT15M"

  criteria {
    query                   = <<-QUERY
      ContainerAppConsoleLogs_CL
      | where Log_s has "provider.unavailable"
      | summarize AggregatedValue = count() by bin(TimeGenerated, 5m)
    QUERY
    time_aggregation_method = "Total"
    threshold               = var.provider_failure_threshold
    operator                = "GreaterThan"

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 2
      number_of_evaluation_periods             = 2
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.this.id]
  }

  tags = var.tags
}

resource "azurerm_monitor_scheduled_query_rules_alert_v2" "config_reload_rejected" {
  name                = "alert-${var.name_prefix}-config-rejected"
  resource_group_name = var.resource_group_name
  location            = var.location
  description         = "A pricing configuration reload was rejected. The previous snapshot is still serving, but an invalid change was shipped."
  severity            = 2
  enabled             = true
  scopes              = [azurerm_log_analytics_workspace.this.id]

  evaluation_frequency = "PT5M"
  window_duration      = "PT15M"

  criteria {
    query                   = <<-QUERY
      ContainerAppConsoleLogs_CL
      | where Log_s has "config.reload.rejected" or Log_s has "config.reload.unreadable"
      | summarize AggregatedValue = count() by bin(TimeGenerated, 5m)
    QUERY
    time_aggregation_method = "Total"
    threshold               = 0
    operator                = "GreaterThan"

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.this.id]
  }

  tags = var.tags
}
