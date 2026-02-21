export interface ApprovalJobData {
  approvalId: string;
  workflowId: string;
  taskId: string;
  type: string;
  expiresAt: string; // ISO date string
}

export interface ApprovalJobResult {
  approvalId: string;
  action: 'scheduled_expiry' | 'auto_denied' | 'already_decided';
}
