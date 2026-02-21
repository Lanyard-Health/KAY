export interface StatusCheckResult {
  status: 'approved' | 'denied' | 'pending' | 'additional_info_needed';
  details?: string;
  denialReason?: string;
  denialCode?: string;
  effectiveDate?: string;
  confirmationId?: string;
}

export interface MonitorJobData {
  workflowId: string;
  taskId: string;
  enrollmentId?: string;
  providerId: string;
  payerId: string;
  submissionId?: string;
  submittedAt: string;
  nextCheckAt?: string;
  checkCount?: number;
}

export interface MonitorJobResult {
  taskId: string;
  status: string;
  nextCheckAt?: string;
  isStalled?: boolean;
}
