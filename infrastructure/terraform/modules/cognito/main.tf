# Cognito Module for Healthcare Credentialing Application

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "callback_urls" {
  description = "Callback URLs for OAuth"
  type        = list(string)
  default     = ["http://localhost:5173/callback"]
}

variable "logout_urls" {
  description = "Logout URLs"
  type        = list(string)
  default     = ["http://localhost:5173/logout"]
}

# Cognito User Pool
resource "aws_cognito_user_pool" "main" {
  name = "credentials-${var.environment}"

  # Username configuration
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Password policy
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  # MFA configuration
  mfa_configuration = "OPTIONAL"
  software_token_mfa_configuration {
    enabled = true
  }

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # User attributes
  schema {
    name                = "email"
    attribute_data_type = "String"
    mutable             = true
    required            = true

    string_attribute_constraints {
      min_length = 0
      max_length = 255
    }
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    mutable             = true
    required            = false

    string_attribute_constraints {
      min_length = 0
      max_length = 255
    }
  }

  # Email configuration
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Device tracking
  device_configuration {
    challenge_required_on_new_device      = true
    device_only_remembered_on_user_prompt = true
  }

  # User pool add-ons
  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }

  # Admin create user config
  admin_create_user_config {
    allow_admin_create_user_only = true

    invite_message_template {
      email_message = "Your username is {username} and temporary password is {####}. Please login and change your password."
      email_subject = "Welcome to Credentials Management System"
      sms_message   = "Your username is {username} and temporary password is {####}"
    }
  }

  tags = {
    Name        = "credentials-${var.environment}"
    Environment = var.environment
  }
}

# User Pool Client
resource "aws_cognito_user_pool_client" "main" {
  name         = "credentials-${var.environment}-client"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH"
  ]

  supported_identity_providers = ["COGNITO"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  allowed_oauth_flows                  = ["code", "implicit"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]

  access_token_validity  = 1   # hours
  id_token_validity      = 1   # hours
  refresh_token_validity = 30  # days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"

  read_attributes = [
    "email",
    "email_verified",
    "name",
    "preferred_username"
  ]

  write_attributes = [
    "email",
    "name",
    "preferred_username"
  ]
}

# User Pool Domain
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "credentials-${var.environment}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.main.id
}

data "aws_caller_identity" "current" {}

# User Groups
resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Administrator users with full access"
  precedence   = 1
}

resource "aws_cognito_user_group" "credentialing_staff" {
  name         = "credentialing_staff"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Credentialing staff with provider management access"
  precedence   = 2
}

resource "aws_cognito_user_group" "provider" {
  name         = "provider"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Healthcare providers with self-service access"
  precedence   = 3
}

# Outputs
output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.main.arn
}

output "client_id" {
  value = aws_cognito_user_pool_client.main.id
}

output "domain" {
  value = aws_cognito_user_pool_domain.main.domain
}
