#!/bin/bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
#  Lanyard Health — Cognito User Pool Setup
#
#  Usage:
#    ./setup-cognito.sh --profile lanyard-dev
#    ./setup-cognito.sh --profile lanyard-staging
#    ./setup-cognito.sh --profile lanyard-prod
#
#  REQUIRED: --profile flag (no default — prevents accidents)
# ─────────────────────────────────────────────────────────

PROFILE=""
REGION="us-east-1"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 --profile <aws-profile-name> [--region <region>]"
      echo ""
      echo "Examples:"
      echo "  $0 --profile lanyard-dev       # Dev account"
      echo "  $0 --profile lanyard-staging   # Staging account"
      echo "  $0 --profile lanyard-prod      # Production account"
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: $1"
      echo "Run '$0 --help' for usage."
      exit 1
      ;;
  esac
done

# Require --profile (safety: never run against a default/unknown account)
if [ -z "$PROFILE" ]; then
  echo "ERROR: --profile is required."
  echo ""
  echo "Usage: $0 --profile <aws-profile-name>"
  echo ""
  echo "Available profiles:"
  aws configure list-profiles 2>/dev/null || echo "  (run 'aws configure --profile <name>' to create one)"
  exit 1
fi

# Derive environment name from profile
case "$PROFILE" in
  *dev*)    ENV_NAME="dev" ;;
  *staging*) ENV_NAME="staging" ;;
  *prod*)   ENV_NAME="production" ;;
  *)        ENV_NAME="$PROFILE" ;;
esac

POOL_NAME="lanyard-health-${ENV_NAME}"
CLIENT_NAME="lanyard-health-web-${ENV_NAME}"
DOMAIN_PREFIX="lanyard-health-${ENV_NAME}"

echo "==========================================="
echo "  Lanyard Health — Cognito User Pool Setup"
echo "==========================================="
echo ""
echo "  Profile:     $PROFILE"
echo "  Environment: $ENV_NAME"
echo "  Region:      $REGION"
echo "  Pool Name:   $POOL_NAME"
echo "  Domain:      $DOMAIN_PREFIX"
echo ""

# Verify credentials
echo "Verifying AWS credentials for profile '$PROFILE'..."
ACCOUNT_INFO=$(aws sts get-caller-identity --profile "$PROFILE" --region "$REGION" 2>&1) || {
  echo "ERROR: Could not authenticate with profile '$PROFILE'."
  echo "Run 'aws configure --profile $PROFILE' to set up credentials."
  exit 1
}
echo "$ACCOUNT_INFO"
echo ""

# Confirm before proceeding
ACCOUNT_ID=$(echo "$ACCOUNT_INFO" | grep -o '"Account": "[^"]*"' | cut -d'"' -f4)
echo "This will create a Cognito User Pool in account $ACCOUNT_ID ($ENV_NAME)."
read -p "Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi
echo ""

# Check for existing pool with same name
EXISTING=$(aws cognito-idp list-user-pools \
  --max-results 20 \
  --profile "$PROFILE" \
  --region "$REGION" \
  --query "UserPools[?Name=='${POOL_NAME}'].Id" \
  --output text 2>/dev/null)

if [ -n "$EXISTING" ] && [ "$EXISTING" != "None" ]; then
  echo "WARNING: A User Pool named '$POOL_NAME' already exists: $EXISTING"
  echo "Delete it first or use a different name."
  exit 1
fi

# Create User Pool
echo "Creating Cognito User Pool: $POOL_NAME ..."
POOL_ID=$(aws cognito-idp create-user-pool \
  --pool-name "$POOL_NAME" \
  --auto-verified-attributes email \
  --username-attributes email \
  --mfa-configuration OPTIONAL \
  --enabled-mfas SOFTWARE_TOKEN_MFA \
  --policies '{
    "PasswordPolicy": {
      "MinimumLength": 12,
      "RequireLowercase": true,
      "RequireUppercase": true,
      "RequireNumbers": true,
      "RequireSymbols": true,
      "TemporaryPasswordValidityDays": 7
    }
  }' \
  --schema '[
    {"Name":"email","AttributeDataType":"String","Required":true,"Mutable":true},
    {"Name":"given_name","AttributeDataType":"String","Required":false,"Mutable":true},
    {"Name":"family_name","AttributeDataType":"String","Required":false,"Mutable":true}
  ]' \
  --account-recovery-setting '{
    "RecoveryMechanisms": [{"Name":"verified_email","Priority":1}]
  }' \
  --admin-create-user-config '{
    "AllowAdminCreateUserOnly": true,
    "InviteMessageTemplate": {
      "EmailSubject": "Welcome to Lanyard Health",
      "EmailMessage": "Your admin has created an account for you. Username: {username}, Temporary password: {####}. Log in at https://kay-frontend.onrender.com/login"
    }
  }' \
  --profile "$PROFILE" \
  --region "$REGION" \
  --query 'UserPool.Id' --output text)

echo "User Pool created: $POOL_ID"
echo ""

# Create App Client
echo "Creating App Client: $CLIENT_NAME ..."
CLIENT_ID=$(aws cognito-idp create-user-pool-client \
  --user-pool-id "$POOL_ID" \
  --client-name "$CLIENT_NAME" \
  --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --prevent-user-existence-errors ENABLED \
  --access-token-validity 1 \
  --id-token-validity 1 \
  --refresh-token-validity 30 \
  --token-validity-units '{"AccessToken":"hours","IdToken":"hours","RefreshToken":"days"}' \
  --profile "$PROFILE" \
  --region "$REGION" \
  --query 'UserPoolClient.ClientId' --output text)

echo "App Client created: $CLIENT_ID"
echo ""

# Create domain
echo "Setting up Cognito domain: $DOMAIN_PREFIX ..."
aws cognito-idp create-user-pool-domain \
  --domain "$DOMAIN_PREFIX" \
  --user-pool-id "$POOL_ID" \
  --profile "$PROFILE" \
  --region "$REGION" 2>/dev/null || {
  echo "WARNING: Domain '$DOMAIN_PREFIX' may already be taken."
  echo "You can set a custom domain in the AWS Console."
}

echo ""
echo "==========================================="
echo "  Cognito User Pool created successfully!"
echo "  Environment: $ENV_NAME"
echo "  Account: $ACCOUNT_ID"
echo "==========================================="
echo ""
echo "── Backend .env (packages/backend/.env) ──"
echo "COGNITO_USER_POOL_ID=$POOL_ID"
echo "COGNITO_CLIENT_ID=$CLIENT_ID"
echo ""
echo "── Frontend .env (packages/frontend/.env) ──"
echo "VITE_COGNITO_USER_POOL_ID=$POOL_ID"
echo "VITE_COGNITO_CLIENT_ID=$CLIENT_ID"
echo ""

if [ "$ENV_NAME" = "production" ]; then
  echo "── Render env vars ──"
  echo "Backend:  COGNITO_USER_POOL_ID=$POOL_ID  COGNITO_CLIENT_ID=$CLIENT_ID  DEV_AUTH_BYPASS=false"
  echo "Frontend: VITE_COGNITO_USER_POOL_ID=$POOL_ID  VITE_COGNITO_CLIENT_ID=$CLIENT_ID  VITE_DEV_AUTH_BYPASS=false"
  echo ""
fi

echo "── Create initial admin user ──"
echo "aws cognito-idp admin-create-user \\"
echo "  --user-pool-id $POOL_ID \\"
echo "  --username admin@lanyardhealth.com \\"
echo "  --temporary-password 'TempPass123!\@#' \\"
echo "  --user-attributes Name=email,Value=admin@lanyardhealth.com Name=email_verified,Value=true Name=given_name,Value=Admin Name=family_name,Value=User \\"
echo "  --profile $PROFILE \\"
echo "  --region $REGION"
