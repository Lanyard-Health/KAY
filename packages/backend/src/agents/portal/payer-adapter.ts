// ==========================================
// Payer Adapter Interface + Registry
// ==========================================

export interface PayerAdapterResult {
  success: boolean;
  submissionId?: string;
  confirmationNumber?: string;
  statusUrl?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ReadinessCheck {
  ready: boolean;
  missingFields: string[];
  warnings: string[];
}

export interface SubmissionInput {
  workflowId: string;
  taskId: string;
  providerId: string;
  payerId: string;
  enrollmentId?: string;
  config: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

export interface PayerAdapter {
  readonly adapterType: string;
  checkReadiness(input: SubmissionInput): Promise<ReadinessCheck>;
  submit(input: SubmissionInput): Promise<PayerAdapterResult>;
}

// ==========================================
// Registry
// ==========================================

const adapterRegistry = new Map<string, PayerAdapter>();

export function registerAdapter(type: string, adapter: PayerAdapter): void {
  adapterRegistry.set(type, adapter);
}

export function getAdapter(type: string): PayerAdapter | undefined {
  return adapterRegistry.get(type);
}

export function listAdapterTypes(): string[] {
  return Array.from(adapterRegistry.keys());
}

/** Clear all registered adapters (for testing). */
export function clearAdapters(): void {
  adapterRegistry.clear();
}
