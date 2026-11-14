terraform {
  required_version = ">= 1.9.0, < 2.0.0"

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

  # Remote state is mandatory: local state cannot be reviewed, locked or
  # recovered. Supply the bucket and table with:
  #   terraform init -backend-config=environments/<env>.backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project        = "vectorharbor-data-marketplace"
      Component      = "best-offers"
      Environment    = var.environment
      ManagedBy      = "terraform"
      Owner          = var.owner_tag
      DataClassified = "internal"
      CostCentre     = var.cost_centre
    }
  }
}
