import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import toast from 'react-hot-toast';
import PasswordStrength from '../../components/PasswordStrength';

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

export default function PracticeSignupPage() {
  const [form, setForm] = useState({
    practiceName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    isEnterprise: false,
  });
  const [operatingStates, setOperatingStates] = useState<string[]>([]);
  const [targetPayerIds, setTargetPayerIds] = useState<string[]>([]);
  const [payers, setPayers] = useState<{ id: string; name: string }[]>([]);
  const [payersLoading, setPayersLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { checkAuth, isDevMode } = useAuthStore();

  useEffect(() => {
    fetch(`${API_BASE_URL}/practices/payers`)
      .then((r) => r.json())
      .then((res) => setPayers(res.data ?? []))
      .catch(() => toast.error('Failed to load payers'))
      .finally(() => setPayersLoading(false));
  }, []);

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const toggleArrayItem = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter((i) => i !== item) : [...arr, item];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
                onChange={update('email')}
              />
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

          {/* Operating States */}
          <div className="bg-white/95 backdrop-blur rounded-2xl p-6 shadow-xl space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              Which states does your practice operate in?
            </h3>
            <p className="text-xs text-gray-500">Select all that apply</p>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-200 p-2 grid grid-cols-2 gap-1">
              {US_STATES.map((s) => (
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
            {payersLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-gray-400">Loading payers…</div>
            ) : payers.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-sm text-gray-400">No payers available</div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-200 p-2 space-y-1">
                {payers.map((p) => (
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
