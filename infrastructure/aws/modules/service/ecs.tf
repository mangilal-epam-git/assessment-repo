/**
 * ECS cluster, IAM roles, task definitions, services, service discovery and
 * autoscaling.
 */

resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${var.name_prefix}-cluster"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  # Production runs entirely on on-demand Fargate: Spot reclamation during a
  # severe-weather surge is exactly when capacity matters most. Lower
  # environments take the saving.
  default_capacity_provider_strategy {
    capacity_provider = var.environment == "prod" ? "FARGATE" : "FARGATE_SPOT"
    weight            = 100
    base              = var.environment == "prod" ? var.min_capacity : 0
  }
}

resource "aws_cloudwatch_log_group" "service" {
  name              = "/ecs/${var.name_prefix}/service"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.name_prefix}-service-logs"
  }
}

resource "aws_cloudwatch_log_group" "mocks" {
  count = var.deploy_mock_providers ? 1 : 0

  name              = "/ecs/${var.name_prefix}/mock-providers"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------------------
# IAM
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    # Confused-deputy protection: only this account's tasks may assume the role.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

# Execution role: used by the ECS agent to pull images and write logs.
resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_extra" {
  statement {
    sid       = "ReadInjectedSecrets"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.admin_token.arn]
  }

  statement {
    sid       = "ReadInjectedParameters"
    effect    = "Allow"
    actions   = ["ssm:GetParameters", "ssm:GetParameter"]
    resources = [aws_ssm_parameter.pricing_config.arn]
  }
}

resource "aws_iam_role_policy" "execution_extra" {
  name   = "${var.name_prefix}-execution-extra"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_extra.json
}

# Task role: the permissions the application itself holds at runtime. It needs
# to re-read its own configuration parameter and nothing else.
resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "ReadOwnPricingConfiguration"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.pricing_config.arn]
  }

  statement {
    sid    = "WriteOwnLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.service.arn}:*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "${var.name_prefix}-task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ---------------------------------------------------------------------------
# Service discovery for the in-VPC mock providers
# ---------------------------------------------------------------------------

resource "aws_service_discovery_private_dns_namespace" "this" {
  count = var.deploy_mock_providers ? 1 : 0

  name        = "${var.name_prefix}.internal"
  description = "Private namespace for in-VPC service-to-service calls"
  vpc         = var.vpc_id
}

resource "aws_service_discovery_service" "mocks" {
  count = var.deploy_mock_providers ? 1 : 0

  name = "mock-providers"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this[0].id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# ---------------------------------------------------------------------------
# Task definitions
# ---------------------------------------------------------------------------

resource "aws_ecs_task_definition" "service" {
  family                   = "${var.name_prefix}-service"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.service_cpu
  memory                   = var.service_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = var.service_image
      essential = true

      portMappings = [
        {
          containerPort = local.container_port
          protocol      = "tcp"
          name          = "http"
        },
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(local.container_port) },
        { name = "HOST", value = "0.0.0.0" },
        { name = "LOG_LEVEL", value = var.log_level },
        { name = "PROVIDER_TELEMETRY1_URL", value = var.telemetry1_url },
        { name = "PROVIDER_TELEMETRY2_URL", value = var.telemetry2_url },
        { name = "PROVIDER_TIMEOUT_MS", value = "2000" },
        { name = "PROVIDER_MAX_ATTEMPTS", value = "3" },
        { name = "PROVIDER_RETRY_INITIAL_DELAY_MS", value = "100" },
        { name = "PROVIDER_RETRY_MAX_DELAY_MS", value = "1000" },
        { name = "PROVIDER_RETRY_BUDGET_MS", value = "5000" },
        { name = "REQUEST_TIMEOUT_MS", value = "10000" },
        { name = "MAX_CONCURRENT_REQUESTS", value = "256" },
        # Must stay below the ECS stopTimeout so draining finishes first.
        { name = "SHUTDOWN_GRACE_MS", value = "15000" },
        { name = "CONFIG_WATCH_ENABLED", value = "true" },
        { name = "PRICING_CONFIG_PATH", value = "/app/config/pricing-config.json" },
      ]

      secrets = [
        {
          name      = "ADMIN_TOKEN"
          valueFrom = aws_secretsmanager_secret.admin_token.arn
        },
      ]

      readonlyRootFilesystem = true
      user                   = "node"

      linuxParameters = {
        initProcessEnabled = true
      }

      # The image ships a default config; this volume gives the process a
      # writable path for the parameter-store sync without unlocking the root
      # filesystem.
      mountPoints = [
        {
          sourceVolume  = "config"
          containerPath = "/app/config"
          readOnly      = false
        },
        {
          sourceVolume  = "tmp"
          containerPath = "/tmp"
          readOnly      = false
        },
      ]

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${local.container_port}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }

      stopTimeout = 30

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.service.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "service"
        }
      }
    },
  ])

  volume {
    name = "config"
  }

  volume {
    name = "tmp"
  }

  tags = {
    Name = "${var.name_prefix}-service-task"
  }
}

resource "aws_ecs_task_definition" "mocks" {
  count = var.deploy_mock_providers ? 1 : 0

  family                   = "${var.name_prefix}-mock-providers"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "mock-providers"
      image     = var.mock_provider_image
      essential = true

      portMappings = [
        {
          containerPort = local.mock_port
          protocol      = "tcp"
        },
      ]

      environment = [
        { name = "MOCK_PORT", value = tostring(local.mock_port) },
        { name = "MOCK_HOST", value = "0.0.0.0" },
      ]

      readonlyRootFilesystem = true
      user                   = "node"

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.mocks[0].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "mock"
        }
      }
    },
  ])

  tags = {
    Name = "${var.name_prefix}-mock-task"
  }
}

# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------

resource "aws_ecs_service" "this" {
  name            = "${var.name_prefix}-service"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.service.arn
  desired_count   = var.desired_count
  launch_type     = null

  # Rolling deployment with a circuit breaker, so a bad image rolls itself back
  # instead of draining healthy capacity.
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Give a new task time to pass health checks before the LB judges it.
  health_check_grace_period_seconds = 30
  enable_execute_command            = var.environment != "prod"
  propagate_tags                    = "SERVICE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = local.container_name
    container_port   = local.container_port
  }

  # Spread across AZs first, then pack by memory, so one AZ loss cannot take
  # out a disproportionate share of capacity.
  ordered_placement_strategy {
    type  = "spread"
    field = "attribute:ecs.availability-zone"
  }

  lifecycle {
    # Autoscaling owns desired_count after the first apply.
    ignore_changes = [desired_count]
  }

  depends_on = [
    aws_lb_listener.http,
    aws_iam_role_policy.task,
  ]

  tags = {
    Name = "${var.name_prefix}-service"
  }
}

resource "aws_ecs_service" "mocks" {
  count = var.deploy_mock_providers ? 1 : 0

  name            = "${var.name_prefix}-mock-providers"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.mocks[0].arn
  desired_count   = 2

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.mocks[0].id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.mocks[0].arn
  }

  tags = {
    Name = "${var.name_prefix}-mock-providers"
  }
}

# ---------------------------------------------------------------------------
# Autoscaling
# ---------------------------------------------------------------------------

resource "aws_appautoscaling_target" "this" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.this.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity
}

# Request-count scaling is the primary signal: this service is I/O bound on
# provider calls, so CPU alone lags the actual load.
resource "aws_appautoscaling_policy" "requests" {
  name               = "${var.name_prefix}-scale-on-requests"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  resource_id        = aws_appautoscaling_target.this.resource_id
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value = var.target_requests_per_task

    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${var.load_balancer_label != "" ? var.load_balancer_label : "${aws_lb.this.arn_suffix}/${aws_lb_target_group.this.arn_suffix}"}"
    }

    # Scale out quickly for surges, back in slowly to avoid flapping.
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name_prefix}-scale-on-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  resource_id        = aws_appautoscaling_target.this.resource_id
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value = 65

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}
