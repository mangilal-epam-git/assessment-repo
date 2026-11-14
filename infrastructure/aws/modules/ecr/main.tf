/**
 * Container registry with vulnerability scanning, tag immutability and a
 * lifecycle policy that keeps the registry from growing without bound.
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

resource "aws_ecr_repository" "this" {
  name = var.repository_name

  # Immutable tags mean a deployed tag always refers to the same digest, which
  # is what makes a deployment traceable back to a commit in an audit.
  image_tag_mutability = var.immutable_tags ? "IMMUTABLE" : "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = var.repository_name
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the ${var.retained_release_images} most recent release images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "release", "sha-"]
          countType     = "imageCountMoreThan"
          countNumber   = var.retained_release_images
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
    ]
  })
}
