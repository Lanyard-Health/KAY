import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import toast from 'react-hot-toast';
import PasswordStrength from '../../components/PasswordStrength';
import { useFormPersistence } from '../../hooks/useFormPersistence';
import SelectWithOther from '../../components/SelectWithOther';
import {
  ENTITY_TYPES,
  GROUP_SPECIALTIES,
  EMR_VENDOR_GROUPS,
  BILLING_VENDORS,
  CLEARINGHOUSES,
} from '../../constants/practiceOptions';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC',
] as const;

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
  DC:'District of Columbia',
};

// Typo suggestions for common email TLD + domain mistakes.
// We don't reach for a library (~6KB dep) because the long tail of TLD typos
// isn't worth it; these 30-ish rules catch the typos that actually happen.
const TLD_FIXES: Record<string, string> = {
  co: 'com', con: 'com', cm: 'com', om: 'com', comm: 'com', vom: 'com', xom: 'com',
  ne: 'net', nett: 'net', met: 'net',
  og: 'org', or: 'org', orgg: 'org',
};
const DOMAIN_FIXES: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmaill.com': 'gmail.com',
  'yhoo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'hotnail.com': 'hotmail.com', 'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloook.com': 'outlook.com', 'outlook.co': 'outlook.com',
  'icoud.com': 'icloud.com', 'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com',
};
function suggestEmailFix(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (DOMAIN_FIXES[domain]) return `${local}@${DOMAIN_FIXES[domain]}`;
  const lastDot = domain.lastIndexOf('.');
  if (lastDot < 1) return null;
  const root = domain.slice(0, lastDot);
  const tld = domain.slice(lastDot + 1);
  if (TLD_FIXES[tld]) return `${local}@${root}.${TLD_FIXES[tld]}`;
  return null;
}

export default function PracticeSignupPage() {
  const [form, setForm, clearPersistedForm] = useFormPersistence(
    'practice-signup:form',
    {
      practiceName: '',
      firstName: '',
      lastName: '',
      email: '',
      confirmEmail: '',
      phone: '',
      password: '',
      confirmPassword: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      zipCode: '',
      isEnterprise: false,
      groupNpi: '',
      // Group profile intake
      legalName: '',
      dba: '',
      entityType: '',
      groupSpecialty: '',
      groupTin: '',
      emrVendor: '',
      billingVendor: '',
      billingClearinghouse: '',
      // Billing address
      billingAddressLine1: '',
      billingAddressLine2: '',
      billingCity: '',
      billingState: '',
      billingZipCode: '',
      // Mailing address
      mailingAddressLine1: '',
      mailingAddressLine2: '',
      mailingCity: '',
      mailingState: '',
      mailingZipCode: '',
    },
    // Never persist secrets or the tax ID to localStorage.
    { exclude: ['password', 'confirmPassword', 'groupTin'] }
  );
  const [sameBilling, setSameBilling] = useState(false);
  const [sameMailing, setSameMailing] = useState(false);
  const [operatingStates, setOperatingStates, clearPersistedStates] = useFormPersistence<string[]>(
    'practice-signup:operating-states',
    []
  );
  const [stateFilter, setStateFilter] = useState('');
  const [payerFilter, setPayerFilter] = useState('');
  const [targetPayerIds, setTargetPayerIds, clearPersistedPayers] = useFormPersistence<string[]>(
    'practice-signup:target-payers',
    []
  );
  const [payers, setPayers] = useState<{ id: string; name: string }[]>([]);
  const [payersLoading, setPayersLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [npiLoading, setNpiLoading] = useState(false);
  const [npiMessage, setNpiMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const navigate = useNavigate();
  const { checkAuth, isDevMode } = useAuthStore();

  useEffect(() => {
    fetch(`${API_BASE_URL}/practices/payers`)
      .then((r) => r.json())
      .then((res) => setPayers(res.data ?? []))
      .catch(() => toast.error('Failed to load payers'))
      .finally(() => setPayersLoading(false));
  }, []);

  // Keep billing/mailing in sync with the office address while "same as office" is on.
  useEffect(() => {
    if (!sameBilling) return;
    setForm((f) => ({
      ...f,
      billingAddressLine1: f.addressLine1, billingAddressLine2: f.addressLine2,
      billingCity: f.city, billingState: f.state, billingZipCode: f.zipCode,
    }));
  }, [sameBilling, form.addressLine1, form.addressLine2, form.city, form.state, form.zipCode, setForm]);
  useEffect(() => {
    if (!sameMailing) return;
    setForm((f) => ({
      ...f,
      mailingAddressLine1: f.addressLine1, mailingAddressLine2: f.addressLine2,
      mailingCity: f.city, mailingState: f.state, mailingZipCode: f.zipCode,
    }));
  }, [sameMailing, form.addressLine1, form.addressLine2, form.city, form.state, form.zipCode, setForm]);

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  // Group dropdowns are controlled by SelectWithOther (value/onChange of a string).
  const updateField = (field: string) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const toggleArrayItem = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item];

  const handleNpiLookup = async (npi: string) => {
    if (!/^\d{10}$/.test(npi)) return;
    setNpiLoading(true);
    setNpiMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/practices/npi-lookup/${npi}`);
      const data = await res.json();
      if (!res.ok || !data.success || !data.data?.found) {
        setNpiMessage({ type: 'error', text: 'NPI not found — enter address manually' });
        return;
      }
      const result = data.data;
      const loc = result.practiceLocation;
      const npiName = result.organizationName
        || [result.firstName, result.lastName].filter(Boolean).join(' ')
        || '';

      setForm((f) => ({
        ...f,
        practiceName: npiName || f.practiceName,
        addressLine1: loc?.addressLine1 || '',
        addressLine2: loc?.addressLine2 || '',
        city: loc?.city || '',
        state: loc?.state || '',
        zipCode: loc?.zipCode || '',
      }));
      setNpiMessage({ type: 'success', text: 'Address populated from NPI registry' });
    } catch {
      setNpiMessage({ type: 'error', text: 'Failed to look up NPI — enter address manually' });
    } finally {
      setNpiLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.email.trim().toLowerCase() !== form.confirmEmail.trim().toLowerCase()) {
      toast.error('Email addresses do not match');
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (operatingStates.length === 0) {
      toast.error('Select at least one operating state');
      return;
    }
    if (targetPayerIds.length === 0) {
      toast.error('Select at least one target payer');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/practices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          practiceName: form.practiceName,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          password: form.password,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2 || undefined,
          city: form.city,
          state: form.state,
          zipCode: form.zipCode,
          operatingStates,
          targetPayerIds,
          isEnterprise: form.isEnterprise,
          groupNpi: form.groupNpi || undefined,
          // Group profile intake (all optional)
          legalName: form.legalName || undefined,
          dba: form.dba || undefined,
          entityType: form.entityType || undefined,
          groupSpecialty: form.groupSpecialty || undefined,
          groupTin: form.groupTin || undefined,
          emrVendor: form.emrVendor || undefined,
          billingVendor: form.billingVendor || undefined,
          billingClearinghouse: form.billingClearinghouse || undefined,
          billingAddressLine1: form.billingAddressLine1 || undefined,
          billingAddressLine2: form.billingAddressLine2 || undefined,
          billingCity: form.billingCity || undefined,
          billingState: form.billingState || undefined,
          billingZipCode: form.billingZipCode || undefined,
          mailingAddressLine1: form.mailingAddressLine1 || undefined,
          mailingAddressLine2: form.mailingAddressLine2 || undefined,
          mailingCity: form.mailingCity || undefined,
          mailingState: form.mailingState || undefined,
          mailingZipCode: form.mailingZipCode || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          toast.error('An account with this email already exists');
        } else if (data.details) {
          toast.error(data.details[0]?.message || 'Validation failed');
        } else {
          toast.error(data.error || 'Registration failed');
        }
        return;
      }

      toast.success('Practice registered successfully!');

      clearPersistedForm();
      clearPersistedStates();
      clearPersistedPayers();

      // Login with the credentials just submitted
      if (isDevMode) {
        localStorage.setItem('dev_session', 'practice_admin');
        await checkAuth();
        navigate('/onboarding/clinical-profile');
      } else {
        const { login } = useAuthStore.getState();
        await login(form.email, form.password);
        navigate('/onboarding/clinical-profile');
      }
    } catch {
      toast.error('Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredStates = US_STATES.filter((s) => {
    if (!stateFilter) return true;
    const q = stateFilter.toLowerCase();
    return s.toLowerCase().includes(q) || STATE_NAMES[s].toLowerCase().includes(q);
  });

  const filteredPayers = payers.filter((p) => {
    if (!payerFilter) return true;
    return p.name.toLowerCase().includes(payerFilter.toLowerCase());
  });

  const inputClassName =
    'appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-xl focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-800 via-primary-600 to-emerald-500 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-lg w-full space-y-8">
        <div>
          <img src="/logo.png" alt="Lanyard Health" className="h-16 mx-auto brightness-0 invert" />
          <h2 className="mt-6 text-center text-2xl font-bold text-white">
            Sign up your practice
          </h2>
          <p className="mt-2 text-center text-sm text-white/70">
            Start managing your credentialing workflow today
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl space-y-4">
            <div>
              <label htmlFor="practiceName" className="block text-sm font-medium text-gray-700 mb-1">
                Practice Name
              </label>
              <input
                id="practiceName"
                type="text"
                required
                minLength={2}
                className={inputClassName}
                placeholder="Your practice name"
                value={form.practiceName}
                onChange={update('practiceName')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                  First Name
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  minLength={2}
                  className={inputClassName}
                  placeholder="First"
                  value={form.firstName}
                  onChange={update('firstName')}
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
                  Last Name
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  minLength={2}
                  className={inputClassName}
                  placeholder="Last"
                  value={form.lastName}
                  onChange={update('lastName')}
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                className={inputClassName}
                placeholder="you@practice.com"
                value={form.email}
                onChange={(e) => {
                  setForm((f) => ({ ...f, email: e.target.value }));
                  if (emailSuggestion) setEmailSuggestion(null);
                }}
                onBlur={(e) => setEmailSuggestion(suggestEmailFix(e.target.value))}
              />
              {emailSuggestion && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
                  <span>
                    Did you mean <strong>{emailSuggestion}</strong>?
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setForm((f) => ({ ...f, email: emailSuggestion, confirmEmail: emailSuggestion }));
                        setEmailSuggestion(null);
                      }}
                      className="px-2 py-1 rounded bg-amber-600 text-white text-xs font-medium hover:bg-amber-700"
                    >
                      Use this
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmailSuggestion(null)}
                      className="px-2 py-1 rounded bg-white border border-amber-300 text-amber-900 text-xs font-medium hover:bg-amber-100"
                    >
                      Keep mine
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirmEmail" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Email
              </label>
              <input
                id="confirmEmail"
                type="email"
                required
                autoComplete="off"
                onPaste={(e) => e.preventDefault()}
                className={inputClassName}
                placeholder="Re-type your email"
                value={form.confirmEmail}
                onChange={update('confirmEmail')}
              />
              {form.confirmEmail.length > 0 &&
                form.email.trim().toLowerCase() !== form.confirmEmail.trim().toLowerCase() && (
                  <p className="mt-1 text-xs text-red-600">Email addresses don't match.</p>
                )}
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                required
                className={inputClassName}
                placeholder="(555) 123-4567"
                value={form.phone}
                onChange={update('phone')}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={12}
                className={inputClassName}
                placeholder="Minimum 12 characters"
                value={form.password}
                onChange={update('password')}
              />
              <PasswordStrength password={form.password} />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={12}
                className={inputClassName}
                placeholder="Re-enter your password"
                value={form.confirmPassword}
                onChange={update('confirmPassword')}
              />
            </div>
          </div>

          {/* Practice Address */}
          <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Practice Address</h3>

            <div>
              <label htmlFor="groupNpi" className="block text-sm font-medium text-gray-700 mb-1">
                Group NPI <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="groupNpi"
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  className={inputClassName}
                  placeholder="10-digit Group NPI"
                  value={form.groupNpi}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setForm((f) => ({ ...f, groupNpi: v }));
                    setNpiMessage(null);
                  }}
                  onBlur={() => {
                    if (/^\d{10}$/.test(form.groupNpi)) handleNpiLookup(form.groupNpi);
                  }}
                />
                <button
                  type="button"
                  disabled={!/^\d{10}$/.test(form.groupNpi) || npiLoading}
                  onClick={() => handleNpiLookup(form.groupNpi)}
                  className="shrink-0 px-4 py-2 text-sm font-medium rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {npiLoading ? 'Looking up…' : 'Look Up'}
                </button>
              </div>
              {npiMessage && (
                <p className={`mt-1 text-xs ${npiMessage.type === 'success' ? 'text-green-600' : 'text-gray-500'}`}>
                  {npiMessage.text}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="addressLine1" className="block text-sm font-medium text-gray-700 mb-1">
                Address Line 1
              </label>
              <input
                id="addressLine1"
                type="text"
                required
                minLength={2}
                className={inputClassName}
                placeholder="123 Main St"
                value={form.addressLine1}
                onChange={update('addressLine1')}
              />
            </div>

            <div>
              <label htmlFor="addressLine2" className="block text-sm font-medium text-gray-700 mb-1">
                Address Line 2 <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="addressLine2"
                type="text"
                className={inputClassName}
                placeholder="Suite, unit, building, etc."
                value={form.addressLine2}
                onChange={update('addressLine2')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
                  City
                </label>
                <input
                  id="city"
                  type="text"
                  required
                  minLength={2}
                  className={inputClassName}
                  placeholder="City"
                  value={form.city}
                  onChange={update('city')}
                />
              </div>
              <div>
                <label htmlFor="state" className="block text-sm font-medium text-gray-700 mb-1">
                  State
                </label>
                <select
                  id="state"
                  required
                  className={inputClassName}
                  value={form.state}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                >
                  <option value="">Select</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s} — {STATE_NAMES[s]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="w-1/2">
              <label htmlFor="zipCode" className="block text-sm font-medium text-gray-700 mb-1">
                Zip Code
              </label>
              <input
                id="zipCode"
                type="text"
                required
                pattern="^\d{5}(-\d{4})?$"
                className={inputClassName}
                placeholder="12345"
                value={form.zipCode}
                onChange={update('zipCode')}
              />
            </div>
          </div>

          {/* Group Details */}
          <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Group Details</h3>
              <p className="text-xs text-gray-500 mt-1">Optional, but it speeds up your enrollments later.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="legalName" className="block text-sm font-medium text-gray-700 mb-1">
                  Group Legal Name <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id="legalName"
                  type="text"
                  className={inputClassName}
                  placeholder="Legal entity name"
                  value={form.legalName}
                  onChange={update('legalName')}
                />
              </div>
              <div>
                <label htmlFor="dba" className="block text-sm font-medium text-gray-700 mb-1">
                  Doing Business As <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id="dba"
                  type="text"
                  className={inputClassName}
                  placeholder="DBA (if different)"
                  value={form.dba}
                  onChange={update('dba')}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectWithOther
                label="Entity Type"
                value={form.entityType}
                onChange={updateField('entityType')}
                options={ENTITY_TYPES}
                placeholder="Select entity type..."
              />
              <SelectWithOther
                label="Group Specialty"
                value={form.groupSpecialty}
                onChange={updateField('groupSpecialty')}
                options={GROUP_SPECIALTIES}
                placeholder="Select specialty..."
              />
            </div>

            <div>
              <label htmlFor="groupTin" className="block text-sm font-medium text-gray-700 mb-1">
                Group TIN <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="groupTin"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className={inputClassName}
                placeholder="Tax ID number"
                value={form.groupTin}
                onChange={update('groupTin')}
              />
              <p className="mt-1 text-xs text-gray-500">Stored encrypted. We never display it back in full.</p>
            </div>

            <SelectWithOther
              label="EMR Vendor"
              value={form.emrVendor}
              onChange={updateField('emrVendor')}
              groups={EMR_VENDOR_GROUPS}
              placeholder="Select EMR vendor..."
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectWithOther
                label="Billing Vendor"
                value={form.billingVendor}
                onChange={updateField('billingVendor')}
                options={BILLING_VENDORS}
                placeholder="Select billing vendor..."
              />
              <SelectWithOther
                label="Billing Clearinghouse"
                value={form.billingClearinghouse}
                onChange={updateField('billingClearinghouse')}
                options={CLEARINGHOUSES}
                placeholder="Select clearinghouse..."
              />
            </div>
          </div>

          {/* Billing Address */}
          <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Billing Address</h3>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  checked={sameBilling}
                  onChange={(e) => {
                    setSameBilling(e.target.checked);
                    if (e.target.checked) toast('Billing address set to match your office address', { icon: 'ℹ️' });
                  }}
                />
                Same as office
              </label>
            </div>
            <input
              type="text"
              className={inputClassName}
              placeholder="Street address"
              value={form.billingAddressLine1}
              onChange={update('billingAddressLine1')}
              disabled={sameBilling}
            />
            <input
              type="text"
              className={inputClassName}
              placeholder="Suite, unit, etc. (optional)"
              value={form.billingAddressLine2}
              onChange={update('billingAddressLine2')}
              disabled={sameBilling}
            />
            <div className="grid grid-cols-6 gap-3">
              <input
                type="text"
                className={`${inputClassName} col-span-3`}
                placeholder="City"
                value={form.billingCity}
                onChange={update('billingCity')}
                disabled={sameBilling}
              />
              <input
                type="text"
                maxLength={2}
                className={`${inputClassName} col-span-1`}
                placeholder="ST"
                value={form.billingState}
                onChange={update('billingState')}
                disabled={sameBilling}
              />
              <input
                type="text"
                className={`${inputClassName} col-span-2`}
                placeholder="ZIP"
                value={form.billingZipCode}
                onChange={update('billingZipCode')}
                disabled={sameBilling}
              />
            </div>
          </div>

          {/* Mailing Address */}
          <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Mailing Address</h3>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  checked={sameMailing}
                  onChange={(e) => {
                    setSameMailing(e.target.checked);
                    if (e.target.checked) toast('Mailing address set to match your office address', { icon: 'ℹ️' });
                  }}
                />
                Same as office
              </label>
            </div>
            <input
              type="text"
              className={inputClassName}
              placeholder="Street address"
              value={form.mailingAddressLine1}
              onChange={update('mailingAddressLine1')}
              disabled={sameMailing}
            />
            <input
              type="text"
              className={inputClassName}
              placeholder="Suite, unit, etc. (optional)"
              value={form.mailingAddressLine2}
              onChange={update('mailingAddressLine2')}
              disabled={sameMailing}
            />
            <div className="grid grid-cols-6 gap-3">
              <input
                type="text"
                className={`${inputClassName} col-span-3`}
                placeholder="City"
                value={form.mailingCity}
                onChange={update('mailingCity')}
                disabled={sameMailing}
              />
              <input
                type="text"
                maxLength={2}
                className={`${inputClassName} col-span-1`}
                placeholder="ST"
                value={form.mailingState}
                onChange={update('mailingState')}
                disabled={sameMailing}
              />
              <input
                type="text"
                className={`${inputClassName} col-span-2`}
                placeholder="ZIP"
                value={form.mailingZipCode}
                onChange={update('mailingZipCode')}
                disabled={sameMailing}
              />
            </div>
          </div>

          {/* Operating States */}
          <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              Which states does your practice operate in?
            </h3>
            <p className="text-xs text-gray-500">Select all that apply</p>
            <div className="relative">
              <input
                type="text"
                placeholder="Search states..."
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 placeholder-gray-400 text-gray-900 rounded-xl text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
              {stateFilter && (
                <button
                  type="button"
                  onClick={() => setStateFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-200 p-2 grid grid-cols-2 gap-1">
              {filteredStates.length === 0 && (
                <p className="col-span-2 text-center text-sm text-gray-400 py-2">No matching states</p>
              )}
              {filteredStates.map((s) => (
                <label
                  key={s}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm cursor-pointer hover:bg-primary-50 transition-colors ${
                    operatingStates.includes(s) ? 'bg-primary-50 text-primary-800 font-medium' : 'text-gray-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    checked={operatingStates.includes(s)}
                    onChange={() => setOperatingStates((prev) => toggleArrayItem(prev, s))}
                  />
                  {s} — {STATE_NAMES[s]}
                </label>
              ))}
            </div>
            {operatingStates.length > 0 && (
              <p className="text-xs text-primary-700">{operatingStates.length} state{operatingStates.length > 1 ? 's' : ''} selected</p>
            )}
          </div>

          {/* Target Payers */}
          <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              Which insurance payers do you want to enroll with?
            </h3>
            <p className="text-xs text-gray-500">Select all that apply</p>
            <div className="relative">
              <input
                type="text"
                placeholder="Search payers..."
                value={payerFilter}
                onChange={(e) => setPayerFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 placeholder-gray-400 text-gray-900 rounded-xl text-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
              {payerFilter && (
                <button
                  type="button"
                  onClick={() => setPayerFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                >
                  ✕
                </button>
              )}
            </div>
            {payersLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-gray-400">Loading payers…</div>
            ) : payers.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-sm text-gray-400">No payers available</div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-200 p-2 space-y-1">
                {filteredPayers.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-2">No matching payers</p>
                )}
                {filteredPayers.map((p) => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm cursor-pointer hover:bg-primary-50 transition-colors ${
                      targetPayerIds.includes(p.id) ? 'bg-primary-50 text-primary-800 font-medium' : 'text-gray-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      checked={targetPayerIds.includes(p.id)}
                      onChange={() => setTargetPayerIds((prev) => toggleArrayItem(prev, p.id))}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
            {targetPayerIds.length > 0 && (
              <p className="text-xs text-primary-700">{targetPayerIds.length} payer{targetPayerIds.length > 1 ? 's' : ''} selected</p>
            )}
          </div>

          {/* Enterprise */}
          <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                checked={form.isEnterprise}
                onChange={(e) => setForm((f) => ({ ...f, isEnterprise: e.target.checked }))}
              />
              <span className="text-sm font-medium text-gray-700">We have multiple practice locations</span>
            </label>
            {form.isEnterprise && (
              <p className="text-xs text-primary-700 bg-primary-50 rounded-lg p-3">
                Our team will reach out to configure your multi-location setup.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-medium rounded-xl text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
          >
            {isLoading ? (
              <span className="flex items-center">
                <svg
                  className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Creating your account...
              </span>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <p className="text-center text-sm text-white/70">
          Already have an account?{' '}
          <Link to="/login" className="text-white hover:text-white/90 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
