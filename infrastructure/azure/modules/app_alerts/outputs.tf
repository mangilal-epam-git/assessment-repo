output "alert_names" {
  description = "Alert rule names, for runbook cross-referencing."
  value = [
    azurerm_monitor_metric_alert.replica_restarts.name,
    azurerm_monitor_metric_alert.request_failures.name,
  ]
}
