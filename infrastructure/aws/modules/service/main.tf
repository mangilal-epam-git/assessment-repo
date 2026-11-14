/**
 * ECS Fargate service behind an application load balancer.
 *
 * Fargate is chosen over EKS because this slice is a small, stateless HTTP
 * service and the team should not pay the operational cost of a Kubernetes
 * control plane on day one (ADR-0005). The task definition, roles, scaling
 * policy and configuration wiring all live here so that one module owns the
 * whole runtime contract of the service.
 */

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  container_name = "best-offers"
  container_port = 8080
  mock_port      = 8081
}

# ---------------------------------------------------------------------------
# Configuration and secrets
# ---------------------------------------------------------------------------

# The pricing snapshot is configuration, not code: it must be changeable at
# runtime with an audit trail, which is exactly what Parameter Store gives us.
resource "aws_ssm_parameter" "pricing_config" {
  name        = "/${var.name_prefix}/pricing-config"
  description = "Validated FX and margin snapshot consumed by the best-offers service"
  type        = "String"
  tier        = "Standard"

  value = jsonencode({
    fxVersion     = "fx-demo-1"
    marginVersion = "margin-demo-1"
    baseCurrency  = "EUR"
    fxRatesToBase = {
      EUR = "1.00"
      USD = "0.92"
      GBP = "1.18"
    }
    defaultMarginBasisPoints = 1000
    minimumQualityRatio      = "0.90"
  })

  lifecycle {
    # Pricing is changed by the approvals workflow, not by Terraform. Terraform
    # seeds the parameter; later edits must not be reverted by an apply.
    ignore_changes = [value]
  }
}

resource "random_password" "admin_token" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "admin_token" {
  name                    = "${var.name_prefix}-admin-token"
  description             = "Bearer token for POST /admin/config/reload"
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "admin_token" {
  secret_id     = aws_secretsmanager_secret.admin_token.id
  secret_string = random_password.admin_token.result

  lifecycle {
    # Rotation is owned by the security runbook, not by Terraform.
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "Public ingress to the best-offers load balancer"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-alb-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each = var.certificate_arn != "" ? toset(var.allowed_ingress_cidrs) : toset([])

  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from permitted clients"
  cidr_ipv4         = each.value
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each = toset(var.allowed_ingress_cidrs)

  security_group_id = aws_security_group.alb.id
  description       = var.certificate_arn != "" ? "HTTP, redirected to HTTPS" : "HTTP (no certificate configured)"
  cidr_ipv4         = each.value
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to the service tasks"
  referenced_security_group_id = aws_security_group.tasks.id
  from_port                    = local.container_port
  to_port                      = local.container_port
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "tasks" {
  name        = "${var.name_prefix}-tasks"
  description = "Best-offers Fargate tasks"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-tasks-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  description                  = "Traffic from the load balancer only"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = local.container_port
  to_port                      = local.container_port
  ip_protocol                  = "tcp"
}

# Egress is HTTPS-only: the service calls provider endpoints and AWS APIs and
# has no reason to open arbitrary ports.
resource "aws_vpc_security_group_egress_rule" "tasks_https" {
  security_group_id = aws_security_group.tasks.id
  description       = "HTTPS to provider endpoints and AWS service endpoints"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "tasks_to_mocks" {
  count = var.deploy_mock_providers ? 1 : 0

  security_group_id            = aws_security_group.tasks.id
  description                  = "Plain HTTP to the in-VPC mock providers"
  referenced_security_group_id = aws_security_group.mocks[0].id
  from_port                    = local.mock_port
  to_port                      = local.mock_port
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "mocks" {
  count = var.deploy_mock_providers ? 1 : 0

  name        = "${var.name_prefix}-mocks"
  description = "Mock telemetry provider tasks"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-mocks-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "mocks_from_tasks" {
  count = var.deploy_mock_providers ? 1 : 0

  security_group_id            = aws_security_group.mocks[0].id
  description                  = "Only the service may call the mocks"
  referenced_security_group_id = aws_security_group.tasks.id
  from_port                    = local.mock_port
  to_port                      = local.mock_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "mocks_https" {
  count = var.deploy_mock_providers ? 1 : 0

  security_group_id = aws_security_group.mocks[0].id
  description       = "HTTPS for image pulls and log shipping"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# ---------------------------------------------------------------------------
# Load balancer
# ---------------------------------------------------------------------------

resource "aws_lb" "this" {
  name               = substr("${var.name_prefix}-alb", 0, 32)
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.enable_deletion_protection
  enable_http2               = true
  idle_timeout               = 60
  drop_invalid_header_fields = true
  desync_mitigation_mode     = "strictest"

  tags = {
    Name = "${var.name_prefix}-alb"
  }
}

resource "aws_lb_target_group" "this" {
  name        = substr("${var.name_prefix}-tg", 0, 32)
  port        = local.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  # Shorter than the default so a failing task is pulled out quickly.
  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = "/readyz"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${var.name_prefix}-tg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  # With a certificate, port 80 exists only to redirect.
  dynamic "default_action" {
    for_each = var.certificate_arn != "" ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = var.certificate_arn == "" ? [1] : []
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.this.arn
    }
  }
}

resource "aws_lb_listener" "https" {
  count = var.certificate_arn != "" ? 1 : 0

  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

# The admin surface is not exposed publicly; operators reach it through the
# private network or a bastion, so the public listener returns 404.
resource "aws_lb_listener_rule" "block_admin" {
  listener_arn = var.certificate_arn != "" ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
  priority     = 1

  action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      status_code  = "404"
      message_body = "{\"code\":\"NOT_FOUND\",\"message\":\"Unknown route\",\"requestId\":\"edge\"}"
    }
  }

  condition {
    path_pattern {
      values = ["/admin/*"]
    }
  }
}
