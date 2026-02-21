export type ExceptionCategory =
  | 'missing_document'
  | 'invalid_data'
  | 'expired_credential'
  | 'duplicate_submission'
  | 'portal_error'
  | 'captcha_blocked'
  | 'payer_system_outage'
  | 'unknown_denial'
  | 'timeout_stall';

export interface ExceptionAnalysis {
  category: ExceptionCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  rootCause: string;
  autoRemediable: boolean;
  steps: Array<{ action: string; description: string }>;
}

export interface ExceptionJobData {
  workflowId: string;
  taskId?: string;
  issue: string;
  denialReason?: string;
  denialCode?: string;
}

export interface ExceptionJobResult {
  workflowId: string;
  category: ExceptionCategory;
  severity: string;
  analysis: ExceptionAnalysis;
}
