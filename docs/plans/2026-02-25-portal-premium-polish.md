# Portal Premium Polish — Phase 4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the provider portal from a functional but plain CRUD app into a premium SaaS experience with guided onboarding, smart dashboard prompts, polished layout, and a celebration moment after wizard completion.

**Architecture:** Frontend-only changes across 4 portal files + 1 route file. No backend changes, no new API endpoints, no schema migrations. All data already available from existing hooks (`useCurrentProvider`, `useProfileCompleteness`, `useOnboardingProgress`). Add entrance animations reusing the login page's CSS keyframe system.

**Tech Stack:** React 18, Tailwind CSS, Heroicons, React Router (useSearchParams), existing React Query hooks

---

## Task 1: Add Logo + Provider Info to Portal Sidebar

**Files:**
- Modify: `packages/frontend/src/features/portal/PortalLayout.tsx`

**What:** Replace the text-only "Provider Portal" brand with the Lanyard Health logo, and show the provider's name + NPI below the nav items.

**Step 1: Read the current sidebar brand section**

In `PortalLayout.tsx`, the sidebar brand area (around line 104) currently renders:
```tsx
<div className="text-white text-xl font-bold">Provider Portal</div>
```

**Step 2: Replace brand text with logo + subtitle**

Find the sidebar brand `div` and replace it with:
```tsx
<div className="flex flex-col items-start">
  <img src="/logo-full.svg" alt="Lanyard Health" className="h-10 brightness-0 invert" />
  <span className="text-primary-200/60 text-xs mt-1 tracking-wide">Provider Portal</span>
</div>
```

Do the same replacement in the mobile sidebar (the `Dialog.Panel` section), which has the same text-only brand.

**Step 3: Add provider name + NPI to sidebar bottom**

Below the `<nav>` element (after the closing `</nav>` tag, before the sidebar's closing `</div>`), add a provider info footer. This requires importing `useCurrentProvider` and reading from it:

```tsx
// At the top of the component, add:
const { data: providerData } = useCurrentProvider();
const provider = providerData?.data?.provider;

// In the sidebar, after </nav>:
{provider && (
  <div className="mt-auto pt-6 px-6 pb-6 border-t border-white/10">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-semibold shrink-0">
        {provider.firstName?.[0]}{provider.lastName?.[0]}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-white truncate">{provider.firstName} {provider.lastName}</p>
        <p className="text-xs text-primary-200/60">NPI: {provider.npi}</p>
      </div>
    </div>
  </div>
)}
```

The sidebar `<div>` needs `flex flex-col` so that `mt-auto` pushes the provider info to the bottom. Ensure the sidebar's inner container uses `flex flex-col h-full` (or `flex-1` if there's already a flex parent).

**Step 4: Verify**

Run: `npm run build --workspace=packages/frontend`
Expected: Build passes, no TS errors.

Visual check: Sidebar shows logo at top, provider initials + name + NPI at bottom.

**Step 5: Commit**

```bash
git add packages/frontend/src/features/portal/PortalLayout.tsx
git commit -m "feat(portal): add logo and provider info to sidebar"
```

---

## Task 2: Upgrade Dashboard Cards to Rounded-2xl + Consistent Shadows

**Files:**
- Modify: `packages/frontend/src/features/portal/PortalDashboard.tsx`

**What:** The dashboard uses `rounded-lg shadow` on cards while the login page (our design reference) uses `rounded-2xl`. Standardize all dashboard cards to `rounded-2xl shadow-sm border border-gray-200/60` for a cohesive premium feel.

**Step 1: Find and replace card classes**

In `PortalDashboard.tsx`, search for all instances of card container classes. The cards currently use patterns like:
- `bg-white rounded-lg shadow p-6`
- `bg-white rounded-lg shadow`

Replace all card wrappers with the consistent pattern:
```
bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6
```

This applies to:
- Profile Completeness card
- Action Items card
- The 3 summary stat cards (Enrollments, Locations, Provider Status)
- Enrollment status list card (if wrapped in a card)

**Step 2: Format provider status display**

Find where `provider.status` is rendered raw (e.g., `"pending_verification"`) in the summary cards section. Replace with a formatted display:

```tsx
// Helper function at top of component or inline:
const formatStatus = (status: string) => {
  const map: Record<string, { label: string; color: string }> = {
    active: { label: 'Active', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    pending_verification: { label: 'Pending Verification', color: 'text-amber-700 bg-amber-50 border-amber-200' },
    inactive: { label: 'Inactive', color: 'text-gray-700 bg-gray-50 border-gray-200' },
    suspended: { label: 'Suspended', color: 'text-red-700 bg-red-50 border-red-200' },
  };
  const s = map[status] || { label: status, color: 'text-gray-700 bg-gray-50 border-gray-200' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.color}`}>
      {s.label}
    </span>
  );
};
```

Replace the raw status text in the Provider Status summary card with `{formatStatus(provider.status)}`.

**Step 3: Verify**

Run: `npm run build --workspace=packages/frontend`
Expected: Build passes.

Visual check: All cards have uniform rounded-2xl corners with subtle borders. Provider status shows as a colored badge.

**Step 4: Commit**

```bash
git add packages/frontend/src/features/portal/PortalDashboard.tsx
git commit -m "feat(portal): upgrade dashboard cards and format status badges"
```

---

## Task 3: Smart Prompts — Replace Static Action Items

**Files:**
- Modify: `packages/frontend/src/features/portal/PortalDashboard.tsx`

**What:** Replace the plain link-row action items with contextual, prioritized smart prompts. Each prompt has an icon, title, description of *why* it matters, and a direct action button. Priority order: profile → documents → licenses → locations → enrollments.

**Step 1: Define smart prompt data**

Add a `getSmartPrompts` function that takes the completeness sections and provider data, returns an ordered array:

```tsx
import {
  UserIcon,
  DocumentDuplicateIcon,
  ShieldCheckIcon,
  MapPinIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';

interface SmartPrompt {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  color: string; // Tailwind color prefix like 'primary', 'amber', 'blue'
}

function getSmartPrompts(
  sections: Array<{ name: string; complete: boolean }>,
  provider: { enrollments: unknown[]; status: string }
): SmartPrompt[] {
  const prompts: SmartPrompt[] = [];
  const incomplete = sections.filter(s => !s.complete);

  for (const section of incomplete) {
    switch (section.name.toLowerCase()) {
      case 'profile':
      case 'basic information':
        prompts.push({
          icon: UserIcon,
          title: 'Complete your profile',
          description: 'Payers require a complete provider profile before processing enrollments.',
          href: '/portal/profile',
          actionLabel: 'Update profile',
          color: 'primary',
        });
        break;
      case 'documents':
        prompts.push({
          icon: DocumentDuplicateIcon,
          title: 'Upload required documents',
          description: 'Malpractice insurance, DEA certificate, and board certifications speed up enrollment approvals.',
          href: '/portal/documents',
          actionLabel: 'Upload documents',
          color: 'blue',
        });
        break;
      case 'licenses':
        prompts.push({
          icon: ShieldCheckIcon,
          title: 'Add your state licenses',
          description: 'Each state you practice in requires a verified license on file.',
          href: '/portal/licenses',
          actionLabel: 'Add license',
          color: 'violet',
        });
        break;
      case 'locations':
        prompts.push({
          icon: MapPinIcon,
          title: 'Add a practice location',
          description: 'Payers need at least one service location for network directory listings.',
          href: '/portal/locations',
          actionLabel: 'Add location',
          color: 'amber',
        });
        break;
    }
  }

  return prompts;
}
```

**Step 2: Render smart prompts**

Replace the existing action items card content (the `incompleteSections.map(...)` block that renders link rows with yellow warning icons) with:

```tsx
const prompts = completeness ? getSmartPrompts(completeness.data.sections, provider) : [];

// In the JSX, replace the action items card body:
{prompts.length > 0 ? (
  <div className="space-y-3">
    {prompts.map((prompt) => (
      <Link
        key={prompt.href}
        to={prompt.href}
        className="flex items-start gap-4 p-4 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-100 hover:border-gray-200 transition-all duration-200 group"
      >
        <div className={`w-10 h-10 rounded-xl bg-${prompt.color}-100 flex items-center justify-center shrink-0`}>
          <prompt.icon className={`w-5 h-5 text-${prompt.color}-600`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{prompt.title}</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{prompt.description}</p>
        </div>
        <span className="text-xs font-medium text-primary-700 group-hover:text-primary-600 self-center shrink-0">
          {prompt.actionLabel} →
        </span>
      </Link>
    ))}
  </div>
) : (
  <div className="flex flex-col items-center py-8 text-center">
    <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
      <CheckCircleIcon className="w-6 h-6 text-emerald-600" />
    </div>
    <p className="text-sm font-semibold text-gray-900">All set!</p>
    <p className="text-xs text-gray-500 mt-1">Your credentialing profile is complete.</p>
  </div>
)}
```

**Important Tailwind note:** Dynamic class names like `bg-${prompt.color}-100` won't be picked up by Tailwind's JIT compiler. Instead, use a safelist or map to full class strings:

```tsx
const colorMap: Record<string, { bg: string; icon: string }> = {
  primary: { bg: 'bg-primary-100', icon: 'text-primary-600' },
  blue: { bg: 'bg-blue-100', icon: 'text-blue-600' },
  violet: { bg: 'bg-violet-100', icon: 'text-violet-600' },
  amber: { bg: 'bg-amber-100', icon: 'text-amber-600' },
};

// Usage in the map:
const colors = colorMap[prompt.color] || colorMap.primary;
<div className={`w-10 h-10 rounded-xl ${colors.bg} flex items-center justify-center shrink-0`}>
  <prompt.icon className={`w-5 h-5 ${colors.icon}`} />
</div>
```

**Step 3: Verify**

Run: `npm run build --workspace=packages/frontend`
Expected: Build passes.

Visual check: Dashboard shows contextual prompts with icons and descriptions instead of plain link rows. When all sections complete, shows the green "All set!" state.

**Step 4: Commit**

```bash
git add packages/frontend/src/features/portal/PortalDashboard.tsx
git commit -m "feat(portal): replace static action items with smart prompts"
```

---

## Task 4: Welcome State on Dashboard

**Files:**
- Modify: `packages/frontend/src/features/portal/PortalDashboard.tsx`

**What:** When providers land on the dashboard for the first time after self-serve signup (URL has `?welcome=true`), show a personalized welcome header instead of the plain "Welcome back" greeting.

**Step 1: Read the URL param**

At the top of the component, add:
```tsx
import { useSearchParams } from 'react-router-dom';

// Inside the component:
const [searchParams, setSearchParams] = useSearchParams();
const isWelcome = searchParams.get('welcome') === 'true';
```

**Step 2: Replace the welcome header conditionally**

Find the existing welcome header (around line 62):
```tsx
<h1 className="text-2xl font-bold text-gray-900">
  Welcome, {provider.firstName} {provider.lastName}
</h1>
<p className="text-sm text-gray-500">NPI: {provider.npi}</p>
```

Replace with:
```tsx
{isWelcome ? (
  <div className="mb-6 p-6 rounded-2xl bg-gradient-to-r from-primary-600 to-emerald-500 text-white">
    <h1 className="text-2xl font-bold">
      Welcome to Lanyard Health, {provider.firstName}!
    </h1>
    <p className="text-sm text-white/80 mt-1">
      Your provider account is ready. Let's get your credentialing profile set up.
    </p>
    <button
      onClick={() => {
        searchParams.delete('welcome');
        setSearchParams(searchParams, { replace: true });
      }}
      className="mt-3 text-xs text-white/60 hover:text-white/90 underline underline-offset-2 transition-colors"
    >
      Dismiss
    </button>
  </div>
) : (
  <div>
    <h1 className="text-2xl font-bold text-gray-900">
      Welcome, {provider.firstName} {provider.lastName}
    </h1>
    <p className="text-sm text-gray-500">NPI: {provider.npi}</p>
  </div>
)}
```

**Step 3: Verify**

Run: `npm run build --workspace=packages/frontend`
Expected: Build passes.

Visual check: Navigate to `/portal?welcome=true` — green gradient banner appears. Click dismiss — banner disappears, URL loses `?welcome=true`. Navigate to `/portal` normally — standard header shows.

**Step 4: Commit**

```bash
git add packages/frontend/src/features/portal/PortalDashboard.tsx
git commit -m "feat(portal): add personalized welcome state for new providers"
```

---

## Task 5: Animated Donut Gauge

**Files:**
- Modify: `packages/frontend/src/features/portal/PortalDashboard.tsx`

**What:** The SVG donut gauge currently renders at its final value instantly. Add an animated count-up from 0 to the actual percentage on mount, matching the login page's count-up pattern.

**Step 1: Add animated percentage state**

Near the top of the component (after hooks), add:
```tsx
const [animatedPercentage, setAnimatedPercentage] = useState(0);
const targetPercentage = completeness?.data?.percentage ?? 0;

useEffect(() => {
  if (targetPercentage === 0) return;
  const duration = 1200;
  const startTime = performance.now();
  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    setAnimatedPercentage(Math.round(eased * targetPercentage));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}, [targetPercentage]);
```

**Step 2: Use animatedPercentage in the SVG**

Find where `percentage` (or `completeness.data.percentage`) is used in the SVG donut's `strokeDasharray` and the center text. Replace both with `animatedPercentage`:

- `strokeDasharray`: change `${percentage} ${100 - percentage}` → `${animatedPercentage} ${100 - animatedPercentage}`
- Center text: change `{percentage}%` → `{animatedPercentage}%`

**Step 3: Verify**

Run: `npm run build --workspace=packages/frontend`
Expected: Build passes.

Visual check: Dashboard loads, donut fills up smoothly from 0% to actual percentage over ~1.2 seconds.

**Step 4: Commit**

```bash
git add packages/frontend/src/features/portal/PortalDashboard.tsx
git commit -m "feat(portal): animate donut gauge count-up on dashboard load"
```

---

## Task 6: Post-Onboarding Celebration

**Files:**
- Modify: `packages/frontend/src/features/portal/OnboardingWizard.tsx`

**What:** When the provider clicks "Complete Onboarding" on the review step and it succeeds, show a celebration screen with confetti-like animation before transitioning to the dashboard. Currently the wizard just disappears and the dashboard renders.

**Step 1: Add completion state**

In the `OnboardingWizard` component, add:
```tsx
const [showCelebration, setShowCelebration] = useState(false);
```

**Step 2: Modify the complete handler**

Find where `completeMutation.mutate()` is called (the "Complete Onboarding" button's onClick). Change it to:
```tsx
completeMutation.mutate(undefined, {
  onSuccess: () => {
    setShowCelebration(true);
  },
});
```

**Step 3: Add celebration screen**

Before the main wizard return, add an early return for the celebration:

```tsx
if (showCelebration) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {/* Animated checkmark */}
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center animate-bounce">
          <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        {/* Decorative rings */}
        <div className="absolute inset-0 w-20 h-20 rounded-full border-4 border-emerald-200 animate-ping opacity-20" />
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        You're all set!
      </h2>
      <p className="text-gray-500 max-w-md mb-8">
        Your credentialing profile is complete. Your information is now being reviewed — we'll notify you of any updates.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={() => window.location.href = '/portal'}
          className="px-6 py-3 bg-primary-700 text-white font-medium rounded-xl hover:bg-primary-800 transition-colors"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}
```

**Why `window.location.href` instead of `navigate`:** The celebration screen is rendered inside `OnboardingWizard`, which is rendered inside `PortalDashboard` when `!provider.onboardingCompletedAt`. After `completeOnboarding` mutation succeeds, the React Query cache is invalidated, meaning the dashboard will re-render and the wizard will unmount. Using `window.location.href` ensures a clean full reload after the celebration, so the dashboard picks up the fresh `onboardingCompletedAt` value. Alternatively, a 3-second `setTimeout` then `navigate('/portal')` works — the query invalidation from `useCompleteOnboarding` will cause `PortalDashboard` to re-evaluate and show the dashboard instead of the wizard.

**Better approach — use navigate with delay:**
```tsx
import { useNavigate } from 'react-router-dom';

// In celebration button:
<button
  onClick={() => navigate('/portal')}
  className="px-6 py-3 bg-primary-700 text-white font-medium rounded-xl hover:bg-primary-800 transition-colors"
>
  Go to Dashboard
</button>
```

Since `useCompleteOnboarding` already calls `queryClient.invalidateQueries({ queryKey: ['portal'] })` on success, by the time the user clicks "Go to Dashboard", the `useCurrentProvider` query will have refetched and `onboardingCompletedAt` will be set, so the dashboard will render instead of the wizard.

**Step 4: Verify**

Run: `npm run build --workspace=packages/frontend`
Expected: Build passes.

Visual check: Complete onboarding → celebration screen with animated checkmark and pulsing ring → click "Go to Dashboard" → normal dashboard renders.

**Step 5: Commit**

```bash
git add packages/frontend/src/features/portal/OnboardingWizard.tsx
git commit -m "feat(portal): add celebration screen after onboarding completion"
```

---

## Task 7: Entrance Animations on Dashboard

**Files:**
- Modify: `packages/frontend/src/features/portal/PortalDashboard.tsx`

**What:** Add staggered fade-in-up animations to dashboard elements, matching the login page's entrance animation system. The login page defines `login-fade-up`, `login-fade-up-d1`, etc. in an inline `<style>` block. We'll add a similar set for the portal dashboard.

**Step 1: Add animation CSS**

At the top of the dashboard's return JSX (before the main `<div>`), add:

```tsx
<>
  <style>{`
    @keyframes portalFadeUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .portal-fade-up { animation: portalFadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
    .portal-fade-up-d1 { animation: portalFadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.08s both; }
    .portal-fade-up-d2 { animation: portalFadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.16s both; }
    .portal-fade-up-d3 { animation: portalFadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.24s both; }
  `}</style>
  {/* ... rest of dashboard JSX */}
</>
```

**Step 2: Apply animation classes to dashboard sections**

- Welcome header: `portal-fade-up`
- Pending verification banner: `portal-fade-up`
- Profile Completeness + Action Items row: `portal-fade-up-d1`
- 3 summary stat cards: `portal-fade-up-d2`
- Enrollment list: `portal-fade-up-d3`

Add these classes to the outermost `<div>` of each section.

**Step 3: Verify**

Run: `npm run build --workspace=packages/frontend`
Expected: Build passes.

Visual check: Dashboard elements fade in with a subtle stagger — feels alive instead of popping in all at once.

**Step 4: Commit**

```bash
git add packages/frontend/src/features/portal/PortalDashboard.tsx
git commit -m "feat(portal): add staggered entrance animations to dashboard"
```

---

## Task 8: Registration Page Value Proposition

**Files:**
- Modify: `packages/frontend/src/features/portal/RegisterPage.tsx`

**What:** Add a brief value proposition above the form for self-serve registrations: headline, three checkmark features, and a more prominent "Already have an account?" link.

**Step 1: Find the form header area**

In `RegisterPage.tsx`, find where the form heading is rendered (the `<h2>` with "Create Your Provider Account" or similar). This is above the form fields, inside the white card.

**Step 2: Add value prop for self-serve flow**

Below the heading and above the form fields, add (only for self-serve, i.e., `isSelfServe`):

```tsx
{isSelfServe && (
  <div className="mb-6">
    <p className="text-sm text-gray-500 mb-4">
      Set up your credentialing profile for free. Submit payer enrollments when you're ready.
    </p>
    <div className="flex flex-col gap-2">
      {['Complete profile & upload documents', 'Track license expirations', 'NPI auto-lookup from NPPES'].map((feature) => (
        <div key={feature} className="flex items-center gap-2 text-sm text-gray-600">
          <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          {feature}
        </div>
      ))}
    </div>
  </div>
)}
```

**Step 3: Make "Already have an account?" more visible**

Find the existing sign-in link at the bottom of the form. Replace with:

```tsx
<p className="text-center text-sm text-gray-500 mt-6">
  Already have an account?{' '}
  <Link to="/login" className="text-primary-700 hover:text-primary-600 font-semibold transition-colors">
    Sign in
  </Link>
</p>
```

Ensure `font-semibold` (not `font-medium`) for better visibility.

**Step 4: Verify**

Run: `npm run build --workspace=packages/frontend`
Expected: Build passes.

Visual check: Navigate to `/register` (no `?practice=` param) — three green checkmarks visible above the form. "Sign in" link clearly visible.

**Step 5: Commit**

```bash
git add packages/frontend/src/features/portal/RegisterPage.tsx
git commit -m "feat(portal): add value proposition to self-serve registration page"
```

---

## Task 9: Final Build Verification + Cleanup

**Step 1: Full build**

Run: `npm run build --workspace=packages/frontend`
Expected: `✓ built in Xs` — no TypeScript errors, no missing imports.

**Step 2: Visual smoke test**

Check these pages in the browser at `http://localhost:5190`:

1. `/login` — existing glass panel still intact (regression check)
2. `/register` — value prop visible for self-serve, hidden for practice-linked (`/register?practice=test`)
3. `/portal` — logo in sidebar, provider info at bottom, animated donut, smart prompts, staggered animations
4. `/portal?welcome=true` — green gradient welcome banner visible, dismiss works
5. Complete onboarding wizard → celebration screen appears → "Go to Dashboard" works
6. Mobile: sidebar logo renders, dashboard is responsive

**Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix(portal): address Phase 4 polish review feedback"
```

**Step 4: Create branch and PR**

```bash
git checkout -b feature/portal-premium-polish
git push -u origin feature/portal-premium-polish
gh pr create --title "Portal premium polish: sidebar logo, smart prompts, celebration, animations" --body "..."
```

---

## Files Summary

| File | Changes |
|------|---------|
| `packages/frontend/src/features/portal/PortalLayout.tsx` | Logo in sidebar, provider name+NPI at bottom |
| `packages/frontend/src/features/portal/PortalDashboard.tsx` | Rounded-2xl cards, status badges, smart prompts, welcome state, animated donut, entrance animations |
| `packages/frontend/src/features/portal/OnboardingWizard.tsx` | Post-completion celebration screen |
| `packages/frontend/src/features/portal/RegisterPage.tsx` | Value proposition + prominent sign-in link |

**No backend changes. No new dependencies. No schema migrations. No new API endpoints.**
