/**
 * The supervised fleet assistant.
 *
 * Deployed beside the best-offers service, behind the same load balancer on
 * the /agent/* path, so one hostname serves both and the WAF covers both.
 *
 * The only thing structurally different from the other service is the model
 * credential: it lives in Secrets Manager, is injected at task start, and
 * appears in no image, no log and no Terraform state value.
 */

locals {
  agent_container_name = "fleet-assistant"
  agent_port           = 8082
  # Hosted model backends need a key; the deterministic planner and a
  # self-hosted endpoint do not.
  agent_needs_model_key = contains(["anthropic", "openai", "azure-openai"], var.agent_model_backend)
}

resource "aws_cloudwatch_log_group" "agent" {
  count = var.deploy_agent ? 1 : 0

  name              = "/ecs/${var.name_prefix}/fleet-assistant"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "${var.name_prefix}-agent-logs"
  }
}

# ---------------------------------------------------------------------------
# Model credential
#
# Terraform creates the secret but never its value: the key is written out of
# band so it is not in a plan, a state file or a CI log.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "model_api_key" {
  count = var.deploy_agent && local.agent_needs_model_key ? 1 : 0

  name                    = "${var.name_prefix}-model-api-key"
  description             = "Inference API key for the ${var.agent_model_backend} backend"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "model_api_key_placeholder" {
  count = var.deploy_agent && local.agent_needs_model_key ? 1 : 0

  secret_id = aws_secretsmanager_secret.model_api_key[0].id
  # A placeholder so the task can start; replace with the real key via
  # `aws secretsmanager put-secret-value`. The service refuses to boot on a
  # hosted backend without a key, so a forgotten rotation fails loudly.
  secret_string = "REPLACE-ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

data "aws_iam_policy_document" "agent_execution_extra" {
  count = var.deploy_agent && local.agent_needs_model_key ? 1 : 0

  statement {
    sid       = "ReadModelApiKey"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.model_api_key[0].arn]
  }
}

resource "aws_iam_role_policy" "agent_execution_extra" {
  count = var.deploy_agent && local.agent_needs_model_key ? 1 : 0

  name   = "${var.name_prefix}-agent-execution-extra"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.agent_execution_extra[0].json
}

# ---------------------------------------------------------------------------
# Routing: same ALB, /agent/* path
# ---------------------------------------------------------------------------

resource "aws_lb_target_group" "agent" {
  count = var.deploy_agent ? 1 : 0

  name        = substr("${var.name_prefix}-agent-tg", 0, 32)
  port        = local.agent_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = "/readyz"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${var.name_prefix}-agent-tg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener_rule" "agent" {
  count = var.deploy_agent ? 1 : 0

  listener_arn = var.certificate_arn != "" ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
  # Priority 1 is the /admin/* block, which must stay ahead of this.
  priority = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.agent[0].arn
  }

  condition {
    path_pattern {
      values = ["/agent", "/agent/*"]
    }
  }
}

# The console is served from the root path of the agent service, so it gets
# its own hostname-free route on /console.
resource "aws_lb_listener_rule" "agent_console" {
  count = var.deploy_agent ? 1 : 0

  listener_arn = var.certificate_arn != "" ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
  priority     = 11

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.agent[0].arn
  }

  condition {
    path_pattern {
      values = ["/console", "/console/*"]
    }
  }
}

resource "aws_vpc_security_group_ingress_rule" "agent_from_alb" {
  count = var.deploy_agent ? 1 : 0

  security_group_id            = aws_security_group.agent[0].id
  description                  = "Traffic from the load balancer only"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = local.agent_port
  to_port                      = local.agent_port
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "agent" {
  count = var.deploy_agent ? 1 : 0

  name        = "${var.name_prefix}-agent"
  description = "Fleet assistant tasks"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-agent-sg"
  }
}

# HTTPS only: the agent calls the model API and AWS endpoints, nothing else.
resource "aws_vpc_security_group_egress_rule" "agent_https" {
  count = var.deploy_agent ? 1 : 0

  security_group_id = aws_security_group.agent[0].id
  description       = "HTTPS to the model API and AWS service endpoints"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_agent" {
  count = var.deploy_agent ? 1 : 0

  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to the fleet assistant tasks"
  referenced_security_group_id = aws_security_group.agent[0].id
  from_port                    = local.agent_port
  to_port                      = local.agent_port
  ip_protocol                  = "tcp"
}

# ---------------------------------------------------------------------------
# Task and service
# ---------------------------------------------------------------------------

resource "aws_ecs_task_definition" "agent" {
  count = var.deploy_agent ? 1 : 0

  family                   = "${var.name_prefix}-fleet-assistant"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.agent_cpu
  memory                   = var.agent_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = local.agent_container_name
      image     = var.agent_image
      essential = true

      portMappings = [
        {
          containerPort = local.agent_port
          protocol      = "tcp"
          name          = "http"
        },
      ]

      environment = concat(
        [
          { name = "NODE_ENV", value = "production" },
          { name = "AGENT_PORT", value = tostring(local.agent_port) },
          { name = "AGENT_HOST", value = "0.0.0.0" },
          { name = "LOG_LEVEL", value = var.log_level },
          { name = "MODEL_BACKEND", value = var.agent_model_backend },
          { name = "MODEL_NAME", value = var.agent_model_name },
          { name = "MODEL_TIMEOUT_MS", value = tostring(var.agent_model_timeout_millis) },
          { name = "MODEL_MAX_TOKENS", value = tostring(var.agent_model_max_tokens) },
          # Degrade to the deterministic planner rather than failing the turn.
          { name = "MODEL_FALLBACK_ENABLED", value = "true" },
          { name = "AGENT_MAX_ITERATIONS", value = tostring(var.agent_max_iterations) },
          { name = "PROPOSAL_TTL_MS", value = tostring(var.agent_proposal_ttl_millis) },
          { name = "FOUR_EYES_THRESHOLD_MINOR", value = tostring(var.agent_four_eyes_threshold_minor) },
          { name = "TENANT_BUDGET_MINOR", value = tostring(var.agent_tenant_budget_minor) },
          { name = "AGENT_MAX_CONCURRENT", value = tostring(var.agent_max_concurrent) },
          { name = "SHUTDOWN_GRACE_MS", value = "15000" },
        ],
        var.agent_model_base_url != "" ? [
          { name = "OPENAI_BASE_URL", value = var.agent_model_base_url },
          { name = "ANTHROPIC_BASE_URL", value = var.agent_model_base_url },
          { name = "OLLAMA_BASE_URL", value = var.agent_model_base_url },
        ] : [],
      )

      secrets = local.agent_needs_model_key ? [
        {
          name      = "MODEL_API_KEY"
          valueFrom = aws_secretsmanager_secret.model_api_key[0].arn
        },
      ] : []

      readonlyRootFilesystem = true
      user                   = "node"

      linuxParameters = {
        initProcessEnabled = true
      }

      mountPoints = [
        {
          sourceVolume  = "tmp"
          containerPath = "/tmp"
          readOnly      = false
        },
      ]

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${local.agent_port}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }

      stopTimeout = 30

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.agent[0].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "agent"
        }
      }
    },
  ])

  volume {
    name = "tmp"
  }

  tags = {
    Name = "${var.name_prefix}-agent-task"
  }
}

resource "aws_ecs_service" "agent" {
  count = var.deploy_agent ? 1 : 0

  name            = "${var.name_prefix}-fleet-assistant"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.agent[0].arn
  desired_count   = var.agent_desired_count

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  health_check_grace_period_seconds = 30
  enable_execute_command            = var.environment != "prod"
  propagate_tags                    = "SERVICE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.agent[0].id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.agent[0].arn
    container_name   = local.agent_container_name
    container_port   = local.agent_port
  }

  ordered_placement_strategy {
    type  = "spread"
    field = "attribute:ecs.availability-zone"
  }

  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.agent]

  tags = {
    Name = "${var.name_prefix}-fleet-assistant"
  }
}

resource "aws_appautoscaling_target" "agent" {
  count = var.deploy_agent ? 1 : 0

  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.agent[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.agent_min_capacity
  max_capacity       = var.agent_max_capacity
}

# Agent turns are long and model-bound, so concurrency matters more than CPU.
resource "aws_appautoscaling_policy" "agent_requests" {
  count = var.deploy_agent ? 1 : 0

  name               = "${var.name_prefix}-agent-scale-on-requests"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.agent[0].service_namespace
  resource_id        = aws_appautoscaling_target.agent[0].resource_id
  scalable_dimension = aws_appautoscaling_target.agent[0].scalable_dimension

  target_tracking_scaling_policy_configuration {
    # Requests per target per minute. Agent turns take seconds, not
    # milliseconds, so this is far lower than the best-offers target.
    target_value = var.agent_target_requests_per_task

    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.this.arn_suffix}/${aws_lb_target_group.agent[0].arn_suffix}"
    }

    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}
