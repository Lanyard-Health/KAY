## Mandatory Security Rules
Before completing ANY task, automatically perform these checks on all changed files:

1. SECRETS SCAN: Check for any hardcoded API keys, passwords, tokens, database URLs, or credentials. If found, immediately move them to environment variables and flag the finding.

2. INPUT VALIDATION: Every API endpoint must validate and sanitize all user input. No raw user input should ever touch a database query.

3. AUTHORIZATION CHECK: Every API endpoint must verify the requesting user has permission to access the specific resource, not just that they're authenticated.

4. DATA EXPOSURE: Never return more data than the endpoint needs. Never log sensitive data (SSNs, tax IDs, NPI numbers, DOBs). Never store sensitive data in localStorage or cookies.

5. DEPENDENCY SAFETY: Before adding any new package, check if it has known vulnerabilities and if it's actively maintained.

6. ERROR HANDLING: Never expose stack traces, internal paths, or system details in error responses.

## Git Workflow
All changes to `master` must go through a pull request with:
- At least 1 approval
- Security Gate CI check passing

## After Every Task
Provide a brief security summary: what was checked, any issues found, and any issues fixed.
