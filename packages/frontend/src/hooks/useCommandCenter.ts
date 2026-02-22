import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export interface MatrixCell {
  enrollmentId: string;
  status: string;
  applicationDate: string | null;
  effectiveDate: string | null;
  lastFollowUpDate: string | null;
  daysSinceUpdate: number;
}

export interface MatrixRow {
  provider: {
    id: string;
    firstName: string;
    lastName: string;
    npi: string;
    status: string;
  };
  enrollments: Record<string, MatrixCell>;
}

export interface MatrixData {
  payers: { id: string; name: string; payerId: string }[];
  rows: MatrixRow[];
  totals: { total: number; byStatus: Record<string, number> };
}

export function useCommandCenterMatrix() {
  return useQuery({
    queryKey: ['command-center-matrix'],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: MatrixData }>('/command-center/matrix');
      return res.data.data;
    },
  });
}
