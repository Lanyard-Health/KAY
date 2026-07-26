import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';

/**
 * Payer Submission Details — the extra fields payer portals (currently the
 * Aetna RFP wizard) ask for that the core profile doesn't store. One record
 * per provider; edited inline in the provider profile.
 */

// Aetna's exact option labels (verified against a real successful submission,
// Request ID 06412261). Stored verbatim so the automation can select them.
const TELEHEALTH_SERVICE_OPTIONS = ['Hybrid services', 'Exclusive virtual services'];
const TELEHEALTH_METHOD_OPTIONS = [
  'Video Conference',
  'Telephone',
  'Remote Patient Monitoring',
  'Three Way Calling',
  'Online Adaptive Interviews',
];
const TELEHEALTH_TYPE_OPTIONS = [
  'Behavioral Health Services',
  'Chronic condition support, monitoring and management',
  'Virtual office visits for new or existing patients',
];
const AGE_GROUP_OPTIONS = [
  'Infants/Toddlers Ages: 5 and under',
  'Elementary School Ages: 6-12',
  'Adolescents Ages: 13-17',
  'Adults Ages: 18-64',
  'Seniors Ages: 65+',
];
const PLACE_OF_SERVICE_OPTIONS = ['Office based', 'Hospital / facility based'];
const SUBMITTER_ROLE_OPTIONS = [
  'Credentialing / Enrollment (Director, Manager, Coordinator)',
  'Provider',
  'Office Manager',
  'Billing Service',
  'Other',
];

export interface PayerSubmissionDetail {
  id?: string;
  fax: string | null;
  county: string | null;
  placeOfService: string | null;
  adaAccessible: boolean;
  accessAccommodations: string | null;
  workingDays: string | null;
  officeHours: string | null;
  facilityFee: boolean;
  telehealth: boolean;
  telehealthServices: string | null;
  telehealthMethods: string[];
  telehealthTypes: string[];
  telehealthHipaaAttested: boolean;
  submitterFirstName: string | null;
  submitterLastName: string | null;
  submitterRole: string | null;
  submitterEmail: string | null;
  submitterPhone: string | null;
  staffLanguages: string[];
  interpreterLanguages: string[];
  providerLanguages: string[];
  aslOffered: boolean;
  medicareCertified: boolean;
  medicarePtan: string | null;
  medicaidCertified: boolean;
  eapParticipation: boolean;
  hospitalAdmittingPrivileges: boolean;
  facilityAdmittingPrivileges: boolean;
  bhAgeGroups: string[];
  bhPracticeFocus: string[];
  w9DocumentId: string | null;
  w9Document?: { id: string; fileName: string } | null;
}

const EMPTY: PayerSubmissionDetail = {
  fax: '', county: '', placeOfService: '', adaAccessible: false, accessAccommodations: '',
  workingDays: '', officeHours: '', facilityFee: false,
  telehealth: false, telehealthServices: '', telehealthMethods: [], telehealthTypes: [],
  telehealthHipaaAttested: false,
  submitterFirstName: '', submitterLastName: '', submitterRole: '', submitterEmail: '', submitterPhone: '',
  staffLanguages: [], interpreterLanguages: [], providerLanguages: [], aslOffered: false,
  medicareCertified: false, medicarePtan: '', medicaidCertified: false, eapParticipation: false,
  hospitalAdmittingPrivileges: false, facilityAdmittingPrivileges: false,
  bhAgeGroups: [], bhPracticeFocus: [], w9DocumentId: null,
};

function CheckboxRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" className="rounded border-gray-300" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type="text"
        className="w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function MultiCheck({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-600 mb-1">{label}</p>
      <div className="space-y-1">
        {options.map((opt) => (
          <CheckboxRow
            key={opt}
            label={opt}
            checked={value.includes(opt)}
            onChange={(on) => onChange(on ? [...value, opt] : value.filter((v) => v !== opt))}
          />
        ))}
      </div>
    </div>
  );
}

function CsvField({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(', '));
  useEffect(() => setText(value.join(', ')), [value]);
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type="text"
        className="w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-primary-500 focus:ring-primary-500"
        value={text}
        placeholder={placeholder ?? 'Comma-separated, e.g. English, Spanish'}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.split(',').map((s) => s.trim()).filter(Boolean))}
      />
    </div>
  );
}

export default function PayerSubmissionDetailsSection({ providerId }: { providerId: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PayerSubmissionDetail>(EMPTY);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['payer-submission-details', providerId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: PayerSubmissionDetail | null }>(
        `/providers/${providerId}/payer-submission-details`
      );
      return res.data.data;
    },
  });

  const { data: w9Docs } = useQuery({
    queryKey: ['provider-w9-docs', providerId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: any }>(`/providers/${providerId}`);
      const docs = (res.data.data?.documents ?? []) as Array<{ id: string; fileName?: string; originalFileName?: string; documentType: string }>;
      return docs.filter((d) => d.documentType === 'w9');
    },
  });

  // Reset the form whenever the provider changes or their saved details load.
  // Without the providerId dependency (and the null branch), switching between
  // providers keeps the previous provider's values on screen — looking saved
  // when they are not.
  useEffect(() => {
    setForm(detail ? { ...EMPTY, ...detail } : EMPTY);
    setSavedAt(null);
  }, [detail, providerId]);

  const save = useMutation({
    mutationFn: async () => {
      const { w9Document, id, ...payload } = form as PayerSubmissionDetail & { id?: string };
      const res = await api.put(`/providers/${providerId}/payer-submission-details`, payload);
      return res.data;
    },
    onSuccess: () => {
      setSavedAt(Date.now());
      queryClient.invalidateQueries({ queryKey: ['payer-submission-details', providerId] });
      queryClient.invalidateQueries({ queryKey: ['aetna-readiness', providerId] });
    },
  });

  const set = <K extends keyof PayerSubmissionDetail>(key: K, value: PayerSubmissionDetail[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  if (isLoading) {
    return <div className="animate-pulse h-24 bg-gray-100 rounded" />;
  }

  return (
    <div className="space-y-6" data-testid="payer-submission-details">
      <p className="text-sm text-gray-500">
        Extra fields payer enrollment portals (Aetna “Join the Network”) require that aren’t part of the core profile.
        Multi-select values are stored exactly as Aetna’s form labels them.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TextField label="Fax" value={form.fax ?? ''} onChange={(v) => set('fax', v)} />
        <TextField label="County" value={form.county ?? ''} onChange={(v) => set('county', v)} />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Place of service</label>
          <select
            className="w-full rounded-md border-gray-300 text-sm shadow-sm"
            value={form.placeOfService ?? ''}
            onChange={(e) => set('placeOfService', e.target.value || null)}
          >
            <option value="">— select —</option>
            {PLACE_OF_SERVICE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <TextField label="Working days" value={form.workingDays ?? ''} onChange={(v) => set('workingDays', v)} placeholder="e.g. DAILY (S,M,T,W,TH,F,S)" />
        <TextField label="Office hours" value={form.officeHours ?? ''} onChange={(v) => set('officeHours', v)} placeholder="e.g. 8am - 5pm" />
        <TextField label="Access accommodations" value={form.accessAccommodations ?? ''} onChange={(v) => set('accessAccommodations', v)} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <CheckboxRow label="ADA accessible" checked={form.adaAccessible} onChange={(v) => set('adaAccessible', v)} />
        <CheckboxRow label="Facility fee charged" checked={form.facilityFee} onChange={(v) => set('facilityFee', v)} />
        <CheckboxRow label="EAP participation" checked={form.eapParticipation} onChange={(v) => set('eapParticipation', v)} />
        <CheckboxRow label="Hospital admitting privileges" checked={form.hospitalAdmittingPrivileges} onChange={(v) => set('hospitalAdmittingPrivileges', v)} />
        <CheckboxRow label="Facility admitting privileges" checked={form.facilityAdmittingPrivileges} onChange={(v) => set('facilityAdmittingPrivileges', v)} />
        <CheckboxRow label="ASL offered" checked={form.aslOffered} onChange={(v) => set('aslOffered', v)} />
      </div>

      {/* Telehealth */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <CheckboxRow label="Provides telehealth services" checked={form.telehealth} onChange={(v) => set('telehealth', v)} />
        {form.telehealth && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Services provided</label>
              <select
                className="w-full rounded-md border-gray-300 text-sm shadow-sm"
                value={form.telehealthServices ?? ''}
                onChange={(e) => set('telehealthServices', e.target.value || null)}
              >
                <option value="">— select —</option>
                {TELEHEALTH_SERVICE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <MultiCheck label="Service methods" options={TELEHEALTH_METHOD_OPTIONS} value={form.telehealthMethods} onChange={(v) => set('telehealthMethods', v)} />
            <MultiCheck label="Service types" options={TELEHEALTH_TYPE_OPTIONS} value={form.telehealthTypes} onChange={(v) => set('telehealthTypes', v)} />
            <div className="md:col-span-3">
              <CheckboxRow
                label="I attest telehealth is delivered on a HIPAA-compliant platform"
                checked={form.telehealthHipaaAttested}
                onChange={(v) => set('telehealthHipaaAttested', v)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Submitter */}
      <div className="border border-gray-200 rounded-lg p-4">
        <p className="text-sm font-medium text-gray-700 mb-3">Submitter (who files the application)</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TextField label="First name" value={form.submitterFirstName ?? ''} onChange={(v) => set('submitterFirstName', v)} />
          <TextField label="Last name" value={form.submitterLastName ?? ''} onChange={(v) => set('submitterLastName', v)} />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
            <select
              className="w-full rounded-md border-gray-300 text-sm shadow-sm"
              value={form.submitterRole ?? ''}
              onChange={(e) => set('submitterRole', e.target.value || null)}
            >
              <option value="">— select —</option>
              {SUBMITTER_ROLE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <TextField label="Email" value={form.submitterEmail ?? ''} onChange={(v) => set('submitterEmail', v)} />
          <TextField label="Phone" value={form.submitterPhone ?? ''} onChange={(v) => set('submitterPhone', v)} />
        </div>
      </div>

      {/* Languages */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CsvField label="Office staff languages" value={form.staffLanguages} onChange={(v) => set('staffLanguages', v)} />
        <CsvField label="Interpreter languages" value={form.interpreterLanguages} onChange={(v) => set('interpreterLanguages', v)} />
        <CsvField label="Provider languages" value={form.providerLanguages} onChange={(v) => set('providerLanguages', v)} />
      </div>

      {/* Medicare / Medicaid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div className="space-y-2">
          <CheckboxRow label="Medicare certified" checked={form.medicareCertified} onChange={(v) => set('medicareCertified', v)} />
          <CheckboxRow label="Medicaid certified" checked={form.medicaidCertified} onChange={(v) => set('medicaidCertified', v)} />
        </div>
        {form.medicareCertified && (
          <TextField label="Medicare PTAN" value={form.medicarePtan ?? ''} onChange={(v) => set('medicarePtan', v)} />
        )}
      </div>

      {/* BH multiselects */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MultiCheck label="Age groups treated (Aetna labels)" options={AGE_GROUP_OPTIONS} value={form.bhAgeGroups} onChange={(v) => set('bhAgeGroups', v)} />
        <CsvField
          label="Practice focus (Aetna labels)"
          value={form.bhPracticeFocus}
          onChange={(v) => set('bhPracticeFocus', v)}
          placeholder="e.g. Cognitive Behavioral Therapy, Group Therapy"
        />
      </div>

      {/* W9 */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">W9 document</label>
        <select
          className="w-full md:w-1/2 rounded-md border-gray-300 text-sm shadow-sm"
          value={form.w9DocumentId ?? ''}
          onChange={(e) => set('w9DocumentId', e.target.value || null)}
        >
          <option value="">— none selected —</option>
          {(w9Docs ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.originalFileName || d.fileName || d.id}</option>
          ))}
        </select>
        {(w9Docs ?? []).length === 0 && (
          <p className="text-xs text-amber-600 mt-1">No W9 documents on file — upload one in the Documents section first (type “W9”).</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save Payer Submission Details'}
        </button>
        {savedAt && !save.isPending && <span className="text-sm text-green-600">Saved</span>}
        {save.isError && <span className="text-sm text-red-600">{(save.error as Error)?.message || 'Save failed'}</span>}
      </div>
    </div>
  );
}
