# Development Environment Configuration

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  backend "s3" {
    bucket         = "credentials-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "credentials-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "CredentialsManagement"
      Environment = "dev"
      ManagedBy   = "Terraform"
    }
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

locals {
  environment = "dev"
}

# VPC
module "vpc" {
  source = "../../modules/vpc"

  environment = local.environment
  vpc_cidr    = "10.0.0.0/16"
}

# RDS
module "rds" {
  source = "../../modules/rds"

  environment            = local.environment
  vpc_id                 = module.vpc.vpc_id
  private_subnet_ids     = module.vpc.private_subnet_ids
  instance_class         = "db.t3.small"
  allocated_storage      = 20
  allowed_security_groups = [] # Will be updated with ECS security group
}

# S3
module "s3" {
  source = "../../modules/s3"

  environment          = local.environment
  cors_allowed_origins = ["http://localhost:5173", "https://dev.credentials.example.com"]
}

# Cognito
module "cognito" {
  source = "../../modules/cognito"

  environment   = local.environment
  callback_urls = ["http://localhost:5173/callback", "https://dev.credentials.example.com/callback"]
  logout_urls   = ["http://localhost:5173", "https://dev.credentials.example.com"]
}

# Outputs
output "vpc_id" {
  value = module.vpc.vpc_id
}

output "db_endpoint" {
  value     = module.rds.db_endpoint
  sensitive = true
}

output "db_secret_arn" {
  value = module.rds.db_secret_arn
}

output "documents_bucket" {
  value = module.s3.documents_bucket_name
}

output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}

output "cognito_client_id" {
  value = module.cognito.client_id
}
