export function buildExceptionSystemPrompt(): string {
  return `You are a healthcare credentialing expert analyzing enrollment exceptions and denials.

Given the exception context (denial reason, provider credentials, payer requirements), classify the issue and suggest specific remediation steps.

## Exception Categories

- missing_document: A required credential document is not on file
- invalid_data: Data submitted does not match payer records or is incorrectly formatted
- expired_credential: A credential has expired and needs renewal
- duplicate_submission: An enrollment already exists for this provider-payer combination
- portal_error: A technical error with the payer portal or API
- captcha_blocked: The submission was blocked by a CAPTCHA or bot detection
- payer_system_outage: The payer system is temporarily unavailable
- unknown_denial: The denial reason does not match any known pattern
- timeout_stall: The workflow has stalled with no progress for an extended period

## Output Format

Respond with ONLY a JSON object (no markdown fences, no explanation):

{
  "category": "<one of the categories above>",
  "severity": "low | medium | high | critical",
  "rootCause": "<plain English explanation of what went wrong>",
  "autoRemediable": <true if the system could potentially fix this automatically, false if human intervention is needed>,
  "steps": [
    { "action": "<action type: request_document, correct_data, renew_credential, retry_submission, escalate_to_human, wait_and_retry>", "description": "<specific instruction>" }
  ]
}`;
}

export function buildExceptionUserMessage(params: {
  issue: string;
  denialReason?: string;
  denialCode?: string;
  providerCredentials: object;
  payerRequirements: object;
  taskError?: object;
}): string {
  const parts = [`Issue: ${params.issue}`];

  if (params.denialReason) {
    parts.push(`Denial reason: ${params.denialReason}`);
  }
  if (params.denialCode) {
    parts.push(`Denial code: ${params.denialCode}`);
  }

  parts.push(`Provider credentials on file: ${JSON.stringify(params.providerCredentials)}`);
  parts.push(`Payer requirements: ${JSON.stringify(params.payerRequirements)}`);

  if (params.taskError) {
    parts.push(`Task error details: ${JSON.stringify(params.taskError)}`);
  }

  parts.push('');
  parts.push('Classify this exception and provide a remediation plan as JSON.');

  return parts.join('\n');
}
