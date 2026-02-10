#!/usr/bin/env bash
# =============================================================================
# Security Lint Script for Lanyard Health
# =============================================================================
#
# Runs automated security checks against the codebase to catch common
# vulnerability patterns before they reach production.
#
# Usage:
#   bash scripts/security-lint.sh          # from repo root
#
# Exit codes:
#   0 = all checks passed (warnings are OK)
#   1 = one or more FAIL-level checks triggered
#
# CHECKS:
#   1. DEV_AUTH_BYPASS in production configs (FAIL)
#   2. Hardcoded dev tokens in non-test source files (FAIL)
#   3. Express route handlers missing auth middleware (WARN)
#   4. Prisma Provider queries without select clause (WARN)
#   5. Sensitive field names in route files (WARN)
#   6. .env files tracked by git (FAIL)
#
# HOW TO ADD NEW CHECKS:
#   1. Add a new section following the pattern below
#   2. Use fail_check() for security-critical issues that should block PRs
#   3. Use warn_check() for code quality issues that need reviewer attention
#   4. Update the CHECKS list above
#
# HOW TO WHITELIST EXCEPTIONS:
#   - Check 2: Add file paths to DEV_TOKEN_WHITELIST array
#   - Check 3: Add path patterns to PUBLIC_ENDPOINT_PATTERNS array
#   - Check 5: Add file paths to SENSITIVE_FIELD_WHITELIST array
#
# =============================================================================

set -euo pipefail

# Navigate to repo root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Counters
FAIL_COUNT=0
WARN_COUNT=0
PASS_COUNT=0

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  NC='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  NC=''
fi

pass_check() {
  echo -e "${GREEN}  PASS${NC}: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail_check() {
  echo -e "${RED}  FAIL${NC}: $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn_check() {
  echo -e "${YELLOW}  WARN${NC}: $1"
  WARN_COUNT=$((WARN_COUNT + 1))
}

echo ""
echo "========================================="
echo " Security Lint - Lanyard Health"
echo "========================================="
echo ""

# =============================================================================
# CHECK 1: DEV_AUTH_BYPASS in production configs
# =============================================================================
echo "CHECK 1: DEV_AUTH_BYPASS in production configs"

PROD_CONFIG_FILES=(
  "render.yaml"
  "docker-compose.prod.yml"
  "docker-compose.production.yml"
)

check1_failed=false

for config_file in "${PROD_CONFIG_FILES[@]}"; do
  if [ -f "$config_file" ]; then
    # Look for DEV_AUTH_BYPASS or VITE_DEV_AUTH_BYPASS set to true
    matches=$(grep -n -i 'DEV_AUTH_BYPASS' "$config_file" 2>/dev/null || true)
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      if echo "$line" | grep -qi 'true'; then
        line_num=$(echo "$line" | cut -d: -f1)
        fail_check "DEV_AUTH_BYPASS=true found in $config_file line $line_num"
        check1_failed=true
      fi
    done <<< "$matches"
  fi
done

if [ "$check1_failed" = false ]; then
  pass_check "No dev auth bypass in production configs"
fi

echo ""

# =============================================================================
# CHECK 2: Hardcoded dev tokens in non-test source files
# =============================================================================
echo "CHECK 2: Hardcoded dev tokens in non-test source files"

# Files allowed to contain dev-token references (dev bypass code gated by env var)
DEV_TOKEN_WHITELIST=(
  "scripts/security-lint.sh"
  "packages/frontend/src/stores/auth.store.ts"
  "packages/frontend/src/services/api.ts"
  "packages/frontend/src/hooks/useRoster.ts"
)

check2_failed=false

# Find all .ts/.tsx files, exclude test files and node_modules
dev_token_matches=$(grep -rn --include='*.ts' --include='*.tsx' \
  -e '"dev-token"' -e "'dev-token'" -e '"Bearer dev-token"' -e "'Bearer dev-token'" \
  packages/ 2>/dev/null || true)

while IFS= read -r line; do
  [ -z "$line" ] && continue
  file_path=$(echo "$line" | cut -d: -f1)

  # Skip test files
  if echo "$file_path" | grep -qE '\.(test|spec)\.(ts|tsx)$'; then
    continue
  fi
  if echo "$file_path" | grep -qE '/tests?/'; then
    continue
  fi
  if echo "$file_path" | grep -q '__mocks__'; then
    continue
  fi

  # Skip whitelisted files
  whitelisted=false
  for wl in "${DEV_TOKEN_WHITELIST[@]}"; do
    if echo "$file_path" | grep -q "$wl"; then
      whitelisted=true
      break
    fi
  done
  [ "$whitelisted" = true ] && continue

  line_num=$(echo "$line" | cut -d: -f2)
  fail_check "Hardcoded dev-token in $file_path:$line_num"
  check2_failed=true
done <<< "$dev_token_matches"

if [ "$check2_failed" = false ]; then
  pass_check "No hardcoded dev tokens in non-test source files"
fi

echo ""

# =============================================================================
# CHECK 3: Express route handlers missing auth middleware
# =============================================================================
echo "CHECK 3: Route handlers missing auth middleware"

# Public endpoint patterns that intentionally skip auth
PUBLIC_ENDPOINT_PATTERNS=(
  "/register"
  "/status/"
  "/practice/"
  "/npi-lookup"
  "/npi/"
  "/health"
  "/api-docs"
  "/webhook"
)

ROUTES_DIR="packages/backend/src/routes"

if [ -d "$ROUTES_DIR" ]; then
  check3_found=false

  # Detect files that apply authenticate at the file/router level (e.g., router.use(authenticate))
  files_with_global_auth=$(grep -rl -E '\.(use)\(authenticate' "$ROUTES_DIR" 2>/dev/null || true)

  # Find route handler definitions
  route_matches=$(grep -rn -E "router\.(get|post|put|patch|delete)\(|Routes\.(get|post|put|patch|delete)\(" "$ROUTES_DIR" 2>/dev/null || true)

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    file_path=$(echo "$line" | cut -d: -f1)
    line_num=$(echo "$line" | cut -d: -f2)
    line_content=$(echo "$line" | cut -d: -f3-)

    # Skip if authenticate is on this line
    if echo "$line_content" | grep -q "authenticate"; then
      continue
    fi

    # Skip if this file has a file-level .use(authenticate)
    if echo "$files_with_global_auth" | grep -qF "$file_path"; then
      continue
    fi

    # Check if this is a known public endpoint
    is_public=false
    for pattern in "${PUBLIC_ENDPOINT_PATTERNS[@]}"; do
      if echo "$line_content" | grep -q "$pattern"; then
        is_public=true
        break
      fi
    done
    [ "$is_public" = true ] && continue

    # Extract the route path for display
    route_path=$(echo "$line_content" | grep -oE "'[^']+'" | head -1 || echo "unknown")
    file_name=$(basename "$file_path")
    warn_check "Route without auth middleware: $file_name:$line_num ($route_path)"
    check3_found=true
  done <<< "$route_matches"

  if [ "$check3_found" = false ]; then
    pass_check "All non-public route handlers have auth middleware"
  fi
else
  warn_check "Routes directory not found: $ROUTES_DIR"
fi

echo ""

# =============================================================================
# CHECK 4: Prisma Provider queries without select clause
# =============================================================================
echo "CHECK 4: Provider queries without select clause"

PROVIDER_ROUTES="$ROUTES_DIR/provider.routes.ts"

if [ -f "$PROVIDER_ROUTES" ]; then
  check4_found=false

  # Look for prisma.provider.findMany or findUnique with include but no select
  # We check for lines with "include:" that are within Provider query blocks
  provider_includes=$(grep -n "include:" "$PROVIDER_ROUTES" 2>/dev/null || true)

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    line_num=$(echo "$line" | cut -d: -f1)

    # Check if there's a "select:" nearby (within 3 lines before)
    start=$((line_num - 5))
    [ "$start" -lt 1 ] && start=1
    context=$(sed -n "${start},${line_num}p" "$PROVIDER_ROUTES")

    if echo "$context" | grep -q "prisma\.provider\." && ! echo "$context" | grep -q "select:"; then
      warn_check "Provider query uses include without select at provider.routes.ts:$line_num"
      check4_found=true
    fi
  done <<< "$provider_includes"

  if [ "$check4_found" = false ]; then
    pass_check "Provider queries use select clauses appropriately"
  fi
else
  warn_check "Provider routes file not found: $PROVIDER_ROUTES"
fi

echo ""

# =============================================================================
# CHECK 5: Sensitive field names in route files
# =============================================================================
echo "CHECK 5: Sensitive fields in API responses"

SENSITIVE_FIELDS="ssnEncrypted|caqhPassword|caqhUsername"

# Files where sensitive field references are expected (definitions, stripping logic)
SENSITIVE_FIELD_WHITELIST=(
  "SENSITIVE_FIELDS"
  "stripSensitiveFields"
  "// Fields to NEVER"
)

if [ -d "$ROUTES_DIR" ]; then
  check5_found=false

  sensitive_matches=$(grep -rn -E "$SENSITIVE_FIELDS" "$ROUTES_DIR" 2>/dev/null || true)

  while IFS= read -r line; do
    [ -z "$line" ] && continue
    line_content=$(echo "$line" | cut -d: -f3-)

    # Skip whitelisted patterns (definition/stripping lines)
    whitelisted=false
    for pattern in "${SENSITIVE_FIELD_WHITELIST[@]}"; do
      if echo "$line_content" | grep -q "$pattern"; then
        whitelisted=true
        break
      fi
    done
    [ "$whitelisted" = true ] && continue

    file_path=$(echo "$line" | cut -d: -f1)
    line_num=$(echo "$line" | cut -d: -f2)
    file_name=$(basename "$file_path")
    warn_check "Sensitive field reference in $file_name:$line_num — ensure stripSensitiveFields is applied"
    check5_found=true
  done <<< "$sensitive_matches"

  if [ "$check5_found" = false ]; then
    pass_check "No exposed sensitive fields in route handlers"
  fi
else
  warn_check "Routes directory not found: $ROUTES_DIR"
fi

echo ""

# =============================================================================
# CHECK 6: .env files committed to git
# =============================================================================
echo "CHECK 6: .env files tracked by git"

check6_failed=false

if git rev-parse --is-inside-work-tree &>/dev/null; then
  tracked_envs=$(git ls-files | grep -E '(^|/)\.env$' || true)
  tracked_env_locals=$(git ls-files | grep -E '(^|/)\.env\.local$' || true)
  tracked_env_prod=$(git ls-files | grep -E '(^|/)\.env\.production$' || true)

  all_tracked="$tracked_envs"$'\n'"$tracked_env_locals"$'\n'"$tracked_env_prod"

  while IFS= read -r env_file; do
    [ -z "$env_file" ] && continue
    fail_check ".env file tracked by git: $env_file"
    check6_failed=true
  done <<< "$all_tracked"
fi

if [ "$check6_failed" = false ]; then
  pass_check "No .env files tracked by git"
fi

echo ""

# =============================================================================
# SUMMARY
# =============================================================================
echo "========================================="
TOTAL=$((PASS_COUNT + FAIL_COUNT + WARN_COUNT))
echo " Results: $PASS_COUNT passed, $FAIL_COUNT failed, $WARN_COUNT warnings"
echo "========================================="
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo -e "${RED}Security lint FAILED with $FAIL_COUNT critical issue(s).${NC}"
  echo "Fix all FAIL items before merging."
  exit 1
else
  if [ "$WARN_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}Security lint passed with $WARN_COUNT warning(s).${NC}"
    echo "Review warnings during code review."
  else
    echo -e "${GREEN}Security lint passed — all checks clean.${NC}"
  fi
  exit 0
fi
