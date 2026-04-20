import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';

export type EmailTemplateType = 'AUTOMATED_ONBOARDING' | 'STATIC_ON_DEMAND';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  type: EmailTemplateType;
  triggerEvent: string | null;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  createdByUser?: { id: string; firstName: string; lastName: string } | null;
}

export type EmailTemplateUpdate = Partial<
  Pick<EmailTemplate, 'name' | 'subject' | 'body' | 'type' | 'triggerEvent'>
> & { isActive?: boolean };

/**
 * Read-only list — used by non-admin surfaces that need template metadata.
 * Hits the public /email-templates endpoint.
 */
export function useEmailTemplates(type?: EmailTemplateType) {
  return useQuery({
    queryKey: ['email-templates', type],
    queryFn: async () => {
      const params = type ? `?type=${type}` : '';
      const response = await api.get(`/email-templates${params}`);
      return response.data.data as EmailTemplate[];
    },
  });
}

/**
 * Admin list — full template rows for the admin editor. Requires admin role
 * (backend 403s otherwise).
 */
export function useAdminEmailTemplates(type?: EmailTemplateType) {
  return useQuery({
    queryKey: ['admin', 'email-templates', type ?? 'all'],
    queryFn: async () => {
      const qs = type ? `?type=${type}` : '';
      const res = await api.get<{ success: boolean; data: EmailTemplate[] }>(
        `/admin/email-templates${qs}`
      );
      return res.data.data;
    },
  });
}

export function useAdminEmailTemplate(id?: string) {
  return useQuery({
    queryKey: ['admin', 'email-template', id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: EmailTemplate }>(
        `/admin/email-templates/${id}`
      );
      return res.data.data;
    },
    enabled: !!id,
  });
}

export function useUpdateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: EmailTemplateUpdate }) => {
      const res = await api.put<{ success: boolean; data: EmailTemplate }>(
        `/admin/email-templates/${id}`,
        patch
      );
      return res.data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'email-templates'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'email-template', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
    },
  });
}

/**
 * Render a template's {{placeholder}} tokens against a sample variable map.
 * Frontend-only preview — no backend call.
 */
export function renderTemplatePreview(
  text: string,
  variables: Record<string, string>
): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => {
    const val = variables[name];
    return val !== undefined ? val : `{{${name}}}`;
  });
}

/** Extract every {{placeholder}} token used in the subject + body. */
export function extractVariables(template: Pick<EmailTemplate, 'subject' | 'body'>): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  for (const text of [template.subject, template.body]) {
    let match;
    while ((match = re.exec(text)) !== null) set.add(match[1]!);
  }
  return [...set].sort();
}
