# Premium UI Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Elevate the entire frontend to world-class premium quality through Framer Motion animations, illustrated empty states, rich contextual toasts, and data visualization polish.

**Architecture:** Four phases executed sequentially. Phase 1 (Framer Motion) is the foundation — Phases 2-4 depend on animation primitives it creates. Each phase is a separate PR. All changes are frontend-only (no backend, no schema changes).

**Tech Stack:** React 18, Framer Motion (new), react-hot-toast (existing), Recharts (existing), Tailwind CSS, HeadlessUI

**Design doc:** `docs/plans/2026-02-26-premium-ui-polish-design.md`

---

## Phase 1: Framer Motion — Animations & Transitions

### Task 1: Install Framer Motion

**Files:**
- Modify: `packages/frontend/package.json`

**Step 1: Install the dependency**

```bash
cd /Users/kay/Documents/KAY && npm install framer-motion --workspace=packages/frontend
```

**Step 2: Verify it installed**

```bash
cd /Users/kay/Documents/KAY && node -e "require('framer-motion')" 2>/dev/null && echo 'OK' || echo 'FAIL'
```
Expected: OK (or just check `node_modules/framer-motion` exists)

**Step 3: Build to confirm no conflicts**

```bash
npm run build --workspace=packages/frontend
```
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/frontend/package.json packages/frontend/package-lock.json
git commit -m "chore: add framer-motion dependency"
```

---

### Task 2: Create AnimatedNumber component

**Files:**
- Create: `packages/frontend/src/components/ui/AnimatedNumber.tsx`

**Step 1: Create the component**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useMotionValue, useSpring, useTransform, motion } from 'framer-motion';

interface AnimatedNumberProps {
  value: number;
  /** Format function — receives the animated number, returns display string */
  format?: (n: number) => string;
  className?: string;
  /** Spring duration in seconds (default 0.8) */
  duration?: number;
}

export default function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  className,
  duration = 0.8,
}: AnimatedNumberProps) {
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, {
    duration: duration * 1000,
    bounce: 0,
  });
  const display = useTransform(spring, (v) => format(v));
  const [displayText, setDisplayText] = useState(format(0));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    const unsubscribe = display.on('change', (v) => {
      setDisplayText(v);
    });
    return unsubscribe;
  }, [display]);

  return (
    <span ref={ref} className={className}>
      {displayText}
    </span>
  );
}
```

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ui/AnimatedNumber.tsx
git commit -m "feat: add AnimatedNumber component with spring animation"
```

---

### Task 3: Create PageTransition wrapper

**Files:**
- Create: `packages/frontend/src/components/ui/PageTransition.tsx`

**Step 1: Create the component**

```tsx
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

const variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] },
  },
};

export default function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={variants}
      className={className}
    >
      {children}
    </motion.div>
  );
}
```

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ui/PageTransition.tsx
git commit -m "feat: add PageTransition wrapper component"
```

---

### Task 4: Create RouteProgressBar component

**Files:**
- Create: `packages/frontend/src/components/ui/RouteProgressBar.tsx`
- Modify: `packages/frontend/src/App.tsx:49-56` (replace LoadingFallback)

**Step 1: Create RouteProgressBar**

```tsx
import { motion } from 'framer-motion';

export default function RouteProgressBar() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-0.5">
      <motion.div
        className="h-full bg-primary-600"
        initial={{ width: '0%' }}
        animate={{ width: '85%' }}
        transition={{ duration: 2, ease: 'easeOut' }}
      />
    </div>
  );
}
```

**Step 2: Replace LoadingFallback in App.tsx**

In `packages/frontend/src/App.tsx`, replace the entire `LoadingFallback` function (lines 49-56) with:

```tsx
import RouteProgressBar from './components/ui/RouteProgressBar';

function LoadingFallback() {
  return <RouteProgressBar />;
}
```

Remove the inline `<style>` and spinner `<div>` — the progress bar replaces them entirely.

**Step 3: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 4: Commit**

```bash
git add packages/frontend/src/components/ui/RouteProgressBar.tsx packages/frontend/src/App.tsx
git commit -m "feat: replace spinner with route progress bar"
```

---

### Task 5: Create AnimatedList component

**Files:**
- Create: `packages/frontend/src/components/ui/AnimatedList.tsx`

**Step 1: Create the component**

```tsx
import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';

interface AnimatedListItemProps {
  children: ReactNode;
  /** Unique key for AnimatePresence tracking */
  itemKey: string | number;
  /** Stagger index (used for delay calculation) */
  index?: number;
  /** Renders as <tr> for table rows, <div> otherwise */
  as?: 'tr' | 'div';
  className?: string;
  onClick?: () => void;
}

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.03,
      duration: 0.2,
      ease: [0.25, 0.1, 0.25, 1],
    },
  }),
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

export function AnimatedListItem({
  children,
  itemKey,
  index = 0,
  as = 'div',
  className,
  onClick,
}: AnimatedListItemProps) {
  const Component = as === 'tr' ? motion.tr : motion.div;

  return (
    <Component
      key={itemKey}
      layout
      custom={index}
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={itemVariants}
      className={className}
      onClick={onClick}
    >
      {children}
    </Component>
  );
}

interface AnimatedListProps {
  children: ReactNode;
  className?: string;
  /** Renders as <tbody> for tables, <div> otherwise */
  as?: 'tbody' | 'div';
}

export function AnimatedList({
  children,
  className,
  as = 'div',
}: AnimatedListProps) {
  const Component = as === 'tbody' ? 'tbody' : 'div';

  return (
    <Component className={className}>
      <AnimatePresence mode="popLayout">
        {children}
      </AnimatePresence>
    </Component>
  );
}
```

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ui/AnimatedList.tsx
git commit -m "feat: add AnimatedList and AnimatedListItem with stagger + layout"
```

---

### Task 6: Create AnimatedCard component

**Files:**
- Create: `packages/frontend/src/components/ui/AnimatedCard.tsx`

**Step 1: Create the component**

```tsx
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface AnimatedCardProps {
  children: ReactNode;
  index?: number;
  className?: string;
  onClick?: () => void;
}

const cardVariants = {
  hidden: { opacity: 0, scale: 0.97, y: 4 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      delay: i * 0.05,
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1],
    },
  }),
};

export default function AnimatedCard({
  children,
  index = 0,
  className,
  onClick,
}: AnimatedCardProps) {
  return (
    <motion.div
      custom={index}
      initial="hidden"
      animate="visible"
      variants={cardVariants}
      className={className}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}
```

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ui/AnimatedCard.tsx
git commit -m "feat: add AnimatedCard with staggered scale-in animation"
```

---

### Task 7: Apply PageTransition to all page-level components

**Files:**
- Modify: `packages/frontend/src/features/dashboard/Dashboard.tsx` (wrap return in PageTransition)
- Modify: `packages/frontend/src/features/providers/ProviderList.tsx` (wrap return)
- Modify: `packages/frontend/src/features/providers/ProviderDetail.tsx` (wrap return)
- Modify: `packages/frontend/src/features/enrollments/EnrollmentsList.tsx` (wrap return)
- Modify: `packages/frontend/src/features/documents/DocumentList.tsx` (wrap return)
- Modify: `packages/frontend/src/features/roster/RosterPage.tsx` (wrap return)
- Modify: `packages/frontend/src/features/users/UsersList.tsx` (wrap return)
- Modify: `packages/frontend/src/features/admin/PendingProviders.tsx` (wrap return)
- Modify: `packages/frontend/src/features/notifications/NotificationsPage.tsx` (wrap return)
- Modify: `packages/frontend/src/features/ai-agent/AiAgentDashboard.tsx` (wrap return)
- Modify: `packages/frontend/src/features/payer-intelligence/PayerIntelligencePage.tsx` (wrap return)
- Modify: `packages/frontend/src/features/command-center/CommandCenter.tsx` (wrap return)
- Modify: `packages/frontend/src/features/practices/PracticesList.tsx` (wrap return)
- Modify: `packages/frontend/src/features/ops/OpsDashboard.tsx` (wrap return)
- Modify: `packages/frontend/src/features/ops/OpsWorkQueue.tsx` (wrap return)
- Modify: `packages/frontend/src/features/ops/OpsPracticesList.tsx` (wrap return)
- Modify: `packages/frontend/src/features/ops/OpsStaffPage.tsx` (wrap return)
- Modify: `packages/frontend/src/features/ops/OpsActivityLog.tsx` (wrap return)
- Modify: `packages/frontend/src/features/admin/OnboardingProgress.tsx` (wrap return)
- Modify: `packages/frontend/src/features/dashboard/ExpirationDashboard.tsx` (wrap return)

**Pattern for each file:**

1. Add import: `import PageTransition from '../../components/ui/PageTransition';`
   (adjust relative path based on file depth)

2. Wrap the **main return** (the non-loading, non-error return) in `<PageTransition>`:

```tsx
// Before:
return (
  <div>
    ...
  </div>
);

// After:
return (
  <PageTransition>
    <div>
      ...
    </div>
  </PageTransition>
);
```

Do NOT wrap loading skeleton returns or error returns — only the main content return.

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/features/ packages/frontend/src/components/
git commit -m "feat: wrap all pages in PageTransition for fade-up on route change"
```

---

### Task 8: Apply AnimatedList to key table views

**Files:**
- Modify: `packages/frontend/src/features/providers/ProviderList.tsx` — table view tbody
- Modify: `packages/frontend/src/features/users/UsersList.tsx` — tbody
- Modify: `packages/frontend/src/features/enrollments/EnrollmentsList.tsx` — table tbody
- Modify: `packages/frontend/src/features/documents/DocumentList.tsx` — tbody
- Modify: `packages/frontend/src/features/admin/PendingProviders.tsx` — tbody
- Modify: `packages/frontend/src/features/ops/OpsWorkQueue.tsx` — tbody

**Pattern for each table:**

1. Add import:
```tsx
import { AnimatedList, AnimatedListItem } from '../../components/ui/AnimatedList';
```

2. Replace `<tbody className="...">` with `<AnimatedList as="tbody" className="...">` and `</tbody>` with `</AnimatedList>`.

3. Replace each `<tr key={item.id} ...>` inside the `.map()` with:
```tsx
<AnimatedListItem
  itemKey={item.id}
  index={index}
  as="tr"
  className="hover:bg-gray-50/50 transition-colors cursor-pointer"
  onClick={() => navigate(`/path/${item.id}`)}
>
```
And close with `</AnimatedListItem>` instead of `</tr>`.

Note: The `index` comes from the `.map((item, index) => ...)` callback. Ensure the map callback captures the index parameter.

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Visual check**

Open http://localhost:5190/providers — rows should stagger in with a subtle fade-up. Filter the list — remaining rows should smoothly reposition.

**Step 4: Commit**

```bash
git add packages/frontend/src/features/
git commit -m "feat: animate table rows with stagger + layout reflow"
```

---

### Task 9: Apply AnimatedCard to dashboard stat cards

**Files:**
- Modify: `packages/frontend/src/features/dashboard/Dashboard.tsx:272-301` (stat cards grid)

**Step 1: Apply AnimatedCard**

Add import:
```tsx
import AnimatedCard from '../../components/ui/AnimatedCard';
```

Wrap each `<StatCard>` in `<AnimatedCard index={N}>`:

```tsx
<div className="dash-stagger dash-d1 grid grid-cols-2 lg:grid-cols-5 gap-4">
  <AnimatedCard index={0}>
    <StatCard label="Total Providers" ... />
  </AnimatedCard>
  <AnimatedCard index={1}>
    <StatCard label="Fully Credentialed" ... />
  </AnimatedCard>
  <AnimatedCard index={2}>
    <StatCard label="Active Enrollments" ... />
  </AnimatedCard>
  <AnimatedCard index={3}>
    <StatCard label="Revenue at Risk" ... />
  </AnimatedCard>
  <AnimatedCard index={4}>
    <StatCard label="AI Actions Today" ... />
  </AnimatedCard>
</div>
```

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/features/dashboard/Dashboard.tsx
git commit -m "feat: animate dashboard stat cards with staggered scale-in"
```

---

### Task 10: Apply AnimatedNumber to StatCard and HealthScoreGauge

**Files:**
- Modify: `packages/frontend/src/components/ui/StatCard.tsx:72` (value display)
- Modify: `packages/frontend/src/components/ui/HealthScoreGauge.tsx:66-69` (score display)

**Step 1: Update StatCard**

Add import:
```tsx
import AnimatedNumber from './AnimatedNumber';
```

Replace the value display (line 72):
```tsx
// Before:
<p className="text-2xl font-bold text-gray-900 tracking-tight">{value}</p>

// After:
<p className="text-2xl font-bold text-gray-900 tracking-tight">
  {typeof value === 'number' ? (
    <AnimatedNumber value={value} />
  ) : (
    value
  )}
</p>
```

**Step 2: Update HealthScoreGauge**

Add import:
```tsx
import AnimatedNumber from './AnimatedNumber';
```

Replace the score display (line 67-69):
```tsx
// Before:
<span className={clsx(
  'font-bold text-gray-900',
  size < 80 ? 'text-sm' : size < 120 ? 'text-xl' : 'text-3xl'
)}>{clamped}</span>

// After:
<span className={clsx(
  'font-bold text-gray-900',
  size < 80 ? 'text-sm' : size < 120 ? 'text-xl' : 'text-3xl'
)}>
  <AnimatedNumber value={clamped} duration={1.2} />
</span>
```

**Step 3: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 4: Commit**

```bash
git add packages/frontend/src/components/ui/StatCard.tsx packages/frontend/src/components/ui/HealthScoreGauge.tsx
git commit -m "feat: animate StatCard values and HealthScoreGauge with count-up"
```

---

### Task 11: Skeleton-to-content crossfade

**Files:**
- Create: `packages/frontend/src/components/ui/ContentTransition.tsx`

**Step 1: Create the component**

```tsx
import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';

interface ContentTransitionProps {
  isLoading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
}

export default function ContentTransition({
  isLoading,
  skeleton,
  children,
}: ContentTransitionProps) {
  return (
    <AnimatePresence mode="wait">
      {isLoading ? (
        <motion.div
          key="skeleton"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {skeleton}
        </motion.div>
      ) : (
        <motion.div
          key="content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, delay: 0.05 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

This component can be progressively applied to loading states across the app. Start with the dashboard stat cards and provider list.

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ui/ContentTransition.tsx
git commit -m "feat: add ContentTransition for skeleton-to-content crossfade"
```

---

### Task 12: Build, verify, and create Phase 1 PR

**Step 1: Full build**

```bash
npm run build --workspace=packages/frontend
```

**Step 2: Visual verification checklist**

Open http://localhost:5190 and check:
- [ ] Route changes show green progress bar (not spinner)
- [ ] Dashboard stat cards scale in with stagger
- [ ] Dashboard numbers count up from 0
- [ ] Health score gauge number counts up
- [ ] Provider list rows stagger in
- [ ] Users list rows stagger in
- [ ] Every page has subtle fade-up on navigation
- [ ] No hydration errors in console

**Step 3: Create branch and PR**

```bash
git checkout -b feature/phase1-framer-motion
git push -u origin feature/phase1-framer-motion
gh pr create --title "Phase 1: Framer Motion animations" --body "$(cat <<'EOF'
## Summary
- Add framer-motion dependency
- PageTransition wrapper on all 20+ pages (fade-up on route change)
- RouteProgressBar replaces centered loading spinner
- AnimatedList + AnimatedListItem for table row stagger + layout reflow
- AnimatedCard for dashboard stat card scale-in
- AnimatedNumber for count-up/morph on StatCard and HealthScoreGauge
- ContentTransition for skeleton-to-content crossfade

## Test plan
- [ ] Route transitions show progress bar, then page fades in
- [ ] Dashboard stat cards animate in with stagger
- [ ] Numeric values count up (not instant)
- [ ] Table rows stagger in on all list pages
- [ ] Filtering a list causes smooth layout reflow
- [ ] No console errors or hydration warnings
- [ ] Build passes: `npm run build --workspace=packages/frontend`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 2: Illustrated Empty States

### Task 13: Create SVG illustration components

**Files:**
- Create: `packages/frontend/src/components/ui/illustrations/SearchIllustration.tsx`
- Create: `packages/frontend/src/components/ui/illustrations/InboxIllustration.tsx`
- Create: `packages/frontend/src/components/ui/illustrations/ClipboardIllustration.tsx`
- Create: `packages/frontend/src/components/ui/illustrations/FolderIllustration.tsx`
- Create: `packages/frontend/src/components/ui/illustrations/ChartIllustration.tsx`
- Create: `packages/frontend/src/components/ui/illustrations/PeopleIllustration.tsx`
- Create: `packages/frontend/src/components/ui/illustrations/index.ts`

**Step 1: Create each SVG illustration component**

Each follows this pattern — minimal line-art, single accent color via `currentColor`, 120x120 viewBox. Example for SearchIllustration:

```tsx
interface IllustrationProps {
  className?: string;
  size?: number;
}

export default function SearchIllustration({ className, size = 120 }: IllustrationProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Magnifying glass over empty page — line art style */}
      {/* Page */}
      <rect x="25" y="15" width="50" height="65" rx="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.3" />
      <line x1="35" y1="30" x2="65" y2="30" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
      <line x1="35" y1="40" x2="58" y2="40" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
      <line x1="35" y1="50" x2="62" y2="50" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
      {/* Magnifying glass */}
      <circle cx="72" cy="72" r="18" stroke="currentColor" strokeWidth="2" opacity="0.6" />
      <line x1="85" y1="85" x2="100" y2="100" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      {/* Small sparkle inside glass */}
      <circle cx="66" cy="66" r="2" fill="currentColor" opacity="0.3" />
    </svg>
  );
}
```

Create all 6 illustrations following this same pattern. Each should be unique line-art:
- **InboxIllustration**: Open box with dotted outline, small up-arrow
- **ClipboardIllustration**: Clipboard shape with 3 small check lines floating/dissolving
- **FolderIllustration**: Open folder shape with a paper corner peeking out
- **ChartIllustration**: Three vertical bar outlines at zero height, dashed baseline
- **PeopleIllustration**: Two simple person silhouettes (head circle + shoulders curve), outlined

**Create the barrel export `index.ts`:**

```ts
export { default as SearchIllustration } from './SearchIllustration';
export { default as InboxIllustration } from './InboxIllustration';
export { default as ClipboardIllustration } from './ClipboardIllustration';
export { default as FolderIllustration } from './FolderIllustration';
export { default as ChartIllustration } from './ChartIllustration';
export { default as PeopleIllustration } from './PeopleIllustration';
```

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ui/illustrations/
git commit -m "feat: add 6 SVG illustration components for empty states"
```

---

### Task 14: Upgrade EmptyState component

**Files:**
- Modify: `packages/frontend/src/components/ui/EmptyState.tsx`

**Step 1: Add illustration support**

```tsx
import clsx from 'clsx';
import { motion } from 'framer-motion';
import {
  SearchIllustration,
  InboxIllustration,
  ClipboardIllustration,
  FolderIllustration,
  ChartIllustration,
  PeopleIllustration,
} from './illustrations';

const ILLUSTRATIONS = {
  search: SearchIllustration,
  inbox: InboxIllustration,
  clipboard: ClipboardIllustration,
  folder: FolderIllustration,
  chart: ChartIllustration,
  people: PeopleIllustration,
} as const;

export type IllustrationPreset = keyof typeof ILLUSTRATIONS;

interface EmptyStateProps {
  icon?: React.ReactNode;
  illustration?: IllustrationPreset;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export default function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const Illustration = illustration ? ILLUSTRATIONS[illustration] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      className={clsx('empty-state', className)}
    >
      {Illustration ? (
        <div className="mb-4 text-gray-300">
          <Illustration size={120} />
        </div>
      ) : icon ? (
        <div className="mb-4 text-gray-300">{icon}</div>
      ) : null}
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-gray-500 max-w-sm">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 btn-primary text-sm"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
```

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ui/EmptyState.tsx
git commit -m "feat: upgrade EmptyState with illustration presets and entrance animation"
```

---

### Task 15: Replace hardcoded empty states across the app

**Files to modify** (each one: replace hardcoded empty state with `<EmptyState>`):

**Group A — `people` illustration:**
- `packages/frontend/src/features/providers/ProviderList.tsx:270` — "No providers found"
- `packages/frontend/src/features/users/UsersList.tsx:119-135` — "No users found"
- `packages/frontend/src/features/admin/PendingProviders.tsx` — "No {status} applications found"
- `packages/frontend/src/features/admin/OnboardingProgress.tsx:172` — "No providers found"
- `packages/frontend/src/features/ops/OpsStaffPage.tsx:267` — "No staff members found"
- `packages/frontend/src/features/practices/PracticeProvidersTab.tsx:62` — "No providers assigned"
- `packages/frontend/src/features/practices/PracticeUsersTab.tsx:68` — "No users assigned"

**Group B — `folder` illustration:**
- `packages/frontend/src/features/documents/DocumentList.tsx:232` — "No documents"
- `packages/frontend/src/features/portal/PortalDocuments.tsx:135` — "No documents uploaded yet"

**Group C — `clipboard` illustration:**
- `packages/frontend/src/features/ops/OpsWorkQueue.tsx:455` — "No work items found"
- `packages/frontend/src/features/providers/ProviderTasks.tsx:146-157` — "No Tasks"
- `packages/frontend/src/features/ops/OpsDashboard.tsx:221` — "No staff members yet"

**Group D — `chart` illustration:**
- `packages/frontend/src/features/dashboard/EnrollmentPipelineChart.tsx:142-154` — "No enrollments yet"
- `packages/frontend/src/features/roster/RosterPreviewTable.tsx:65-73` — "No data found"
- `packages/frontend/src/features/payer-intelligence/PayerIntelligencePage.tsx:123` — "No payers with enough data"

**Group E — `inbox` illustration:**
- `packages/frontend/src/features/notifications/NotificationsPage.tsx:106` — "No notifications"
- `packages/frontend/src/features/ops/OpsActivityLog.tsx:199` — "No activity found"
- `packages/frontend/src/features/practices/PracticesList.tsx:58` — "No practices"
- `packages/frontend/src/features/ops/OpsPracticesList.tsx:160` — "No practices found"

**Group F — `search` illustration:**
- `packages/frontend/src/components/ui/CommandPalette.tsx:221-230` — "No results found"

**Pattern for each replacement:**

```tsx
import EmptyState from '../../components/ui/EmptyState';

// Before (example from UsersList.tsx):
<div className="text-center py-12">
  <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
  <h3 className="mt-2 text-sm font-medium text-gray-900">No users found</h3>
  <p className="mt-1 text-sm text-gray-500">
    {hasFilters ? 'Try adjusting your filters.' : 'Get started by creating a user.'}
  </p>
  {!hasFilters && <button ...>Create your first user</button>}
</div>

// After:
<EmptyState
  illustration="people"
  title="No users found"
  description={hasFilters ? 'Try adjusting your filters.' : 'Get started by creating a user.'}
  action={!hasFilters ? { label: 'Create your first user', onClick: () => setCreateModalOpen(true) } : undefined}
/>
```

Adapt the description and action for each context. If the original had a filter-aware message, keep that logic.

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/features/ packages/frontend/src/components/
git commit -m "feat: replace 21 hardcoded empty states with illustrated EmptyState component"
```

---

### Task 16: Phase 2 PR

**Step 1: Build**

```bash
npm run build --workspace=packages/frontend
```

**Step 2: Visual check**

Navigate to each page with no data and verify:
- [ ] SVG illustration appears (not just icon or text)
- [ ] Fade-in animation on empty state
- [ ] Action button where appropriate
- [ ] Filtered-to-zero shows "Try adjusting your filters"

**Step 3: Create PR**

```bash
git checkout -b feature/phase2-empty-states
git push -u origin feature/phase2-empty-states
gh pr create --title "Phase 2: Illustrated empty states" --body "$(cat <<'EOF'
## Summary
- 6 custom SVG illustration components (search, inbox, clipboard, folder, chart, people)
- Upgraded EmptyState component with `illustration` prop and entrance animation
- Replaced 21 hardcoded empty states across the app with consistent EmptyState usage
- Context-aware descriptions (filter vs first-time) and action buttons

## Test plan
- [ ] Each empty state shows the correct illustration
- [ ] Entrance animation works (fade-up)
- [ ] Action buttons work where present
- [ ] Build passes: `npm run build --workspace=packages/frontend`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 3: Rich Contextual Toasts

### Task 17: Create custom Toast component and notify API

**Files:**
- Create: `packages/frontend/src/components/ui/Toast.tsx`
- Create: `packages/frontend/src/utils/notify.ts`

**Step 1: Create Toast.tsx**

```tsx
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import type { Toast as HotToast } from 'react-hot-toast';
import {
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

type ToastVariant = 'success' | 'error' | 'info' | 'loading';

interface ToastProps {
  t: HotToast;
  variant: ToastVariant;
  title: string;
  description?: string;
}

const VARIANT_CONFIG = {
  success: {
    border: 'border-l-green-500',
    icon: CheckCircleIcon,
    iconColor: 'text-green-500',
  },
  error: {
    border: 'border-l-red-500',
    icon: XCircleIcon,
    iconColor: 'text-red-500',
  },
  info: {
    border: 'border-l-blue-500',
    icon: InformationCircleIcon,
    iconColor: 'text-blue-500',
  },
  loading: {
    border: 'border-l-amber-500',
    icon: null,
    iconColor: '',
  },
};

export default function Toast({ t, variant, title, description }: ToastProps) {
  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: t.visible ? 1 : 0, x: t.visible ? 0 : 40, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className={clsx(
        'pointer-events-auto w-full max-w-sm rounded-xl shadow-lg bg-white border border-gray-200/60',
        'border-l-4',
        config.border,
        'flex items-start gap-3 p-4'
      )}
    >
      {variant === 'loading' ? (
        <div className="mt-0.5 h-5 w-5 flex-shrink-0">
          <div className="h-5 w-5 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
        </div>
      ) : Icon ? (
        <Icon className={clsx('h-5 w-5 flex-shrink-0 mt-0.5', config.iconColor)} />
      ) : null}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {description && (
          <p className="mt-0.5 text-sm text-gray-500 line-clamp-2">{description}</p>
        )}
      </div>

      <button
        onClick={() => toast.dismiss(t.id)}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </motion.div>
  );
}
```

**Step 2: Create notify.ts**

```ts
import toast from 'react-hot-toast';
import { createElement } from 'react';
import ToastComponent from '../components/ui/Toast';

interface NotifyOptions {
  description?: string;
  duration?: number;
}

function createToast(
  variant: 'success' | 'error' | 'info' | 'loading',
  title: string,
  options?: NotifyOptions
) {
  const duration =
    options?.duration ??
    (variant === 'error' ? 6000 : variant === 'loading' ? Infinity : 4000);

  return toast.custom(
    (t) =>
      createElement(ToastComponent, {
        t,
        variant,
        title,
        description: options?.description,
      }),
    {
      duration,
      position: 'top-right',
    }
  );
}

export const notify = {
  success: (title: string, options?: NotifyOptions) =>
    createToast('success', title, options),
  error: (title: string, options?: NotifyOptions) =>
    createToast('error', title, options),
  info: (title: string, options?: NotifyOptions) =>
    createToast('info', title, options),
  loading: (title: string, options?: NotifyOptions) =>
    createToast('loading', title, options),
  dismiss: toast.dismiss,
};
```

**Step 3: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 4: Commit**

```bash
git add packages/frontend/src/components/ui/Toast.tsx packages/frontend/src/utils/notify.ts
git commit -m "feat: add custom Toast component and notify API"
```

---

### Task 18: Configure Toaster with custom default renderer

**Files:**
- Modify: `packages/frontend/src/main.tsx:54` (Toaster config)

**Step 1: Update Toaster config**

Replace line 54:
```tsx
// Before:
<Toaster position="top-right" />

// After:
<Toaster
  position="top-right"
  toastOptions={{
    duration: 4000,
    style: { background: 'transparent', boxShadow: 'none', padding: 0 },
  }}
  containerStyle={{ top: 16, right: 16 }}
  gutter={8}
/>
```

This ensures that when `toast.custom()` is used (via `notify`), the container doesn't add its own styling. Standard `toast.success()` calls will still work but with the default react-hot-toast look — progressively upgrade them in the next step.

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/main.tsx
git commit -m "feat: configure Toaster for custom toast rendering"
```

---

### Task 19: Upgrade high-value callsites to notify API

**Files to modify** (replace `toast.success`/`toast.error` with `notify.*`):

- `packages/frontend/src/features/auth/LoginPage.tsx` — all `toast.success` and `toast.error` calls
- `packages/frontend/src/features/portal/RegisterPage.tsx` — signup success/error
- `packages/frontend/src/features/roster/RosterPage.tsx` — export/template operations
- `packages/frontend/src/features/portal/PortalDocuments.tsx` — upload/delete
- `packages/frontend/src/features/enrollments/EnrollmentsList.tsx` — create enrollment
- `packages/frontend/src/features/admin/PendingProviders.tsx` — approve/reject

**Pattern:**

```tsx
// Before:
import toast from 'react-hot-toast';
toast.success('Template saved');
toast.error('Failed to save template');

// After:
import { notify } from '../../utils/notify';
notify.success('Template saved', { description: 'Your roster template has been updated' });
notify.error('Save failed', { description: 'Could not save template. Please try again.' });
```

For each file:
1. Replace `import toast from 'react-hot-toast'` with `import { notify } from '../../utils/notify'`
2. Replace each `toast.success('msg')` with `notify.success('Short Title', { description: 'msg' })`
3. Replace each `toast.error('msg')` with `notify.error('Short Title', { description: 'msg' })`

If a file still uses both `toast` and `notify` (e.g., some calls upgraded, others not yet), keep both imports.

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/features/
git commit -m "feat: upgrade high-value toast callsites to rich contextual notify API"
```

---

### Task 20: Phase 3 PR

**Step 1: Build**

```bash
npm run build --workspace=packages/frontend
```

**Step 2: Visual check**

- [ ] Login success shows green-bordered toast with title + description
- [ ] Error toasts show red border + X icon
- [ ] Toasts slide in from right
- [ ] Close button works
- [ ] Auto-dismiss after 4s (success) / 6s (error)
- [ ] Max 3 toasts stacked

**Step 3: Create PR**

```bash
git checkout -b feature/phase3-rich-toasts
git push -u origin feature/phase3-rich-toasts
gh pr create --title "Phase 3: Rich contextual toasts" --body "$(cat <<'EOF'
## Summary
- Custom Toast component with 4 variants (success, error, info, loading)
- New `notify` API wrapping react-hot-toast with title + description support
- Backwards-compatible — existing toast.* calls still work
- Upgraded 6 high-value files to notify API with contextual descriptions
- Toaster reconfigured for custom rendering

## Test plan
- [ ] Login success/error shows styled toast
- [ ] Toast has colored left border, icon, title, description
- [ ] Slide-in animation from right
- [ ] Close button dismisses
- [ ] Auto-dismiss timing works (4s success, 6s error)
- [ ] Build passes: `npm run build --workspace=packages/frontend`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 4: Data Visualization Polish

### Task 21: Add glow and glass container to HealthScoreGauge

**Files:**
- Modify: `packages/frontend/src/components/ui/HealthScoreGauge.tsx`

**Step 1: Add glow filter and glass wrapper**

Update the SVG to include a glow filter on the score ring, and wrap the whole component in a glass container when used standalone:

```tsx
// Add glow filter inside <svg>, before the circles:
<defs>
  <filter id={`glow-${clamped}`} x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur stdDeviation="3" result="blur" />
    <feFlood floodColor={color} floodOpacity="0.3" result="color" />
    <feComposite in="color" in2="blur" operator="in" result="shadow" />
    <feMerge>
      <feMergeNode in="shadow" />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>
</defs>

// On the score circle, add the filter:
<circle
  ...
  filter={`url(#glow-${clamped})`}
/>
```

Also add smooth color transition by using CSS transition on the SVG stroke:
```tsx
style={{ stroke: color, transition: 'stroke 0.5s ease' }}
```
(Replace the `stroke={color}` prop with this style.)

**Step 2: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ui/HealthScoreGauge.tsx
git commit -m "feat: add glow effect and smooth color transitions to HealthScoreGauge"
```

---

### Task 22: Animate StatCard sparkline draw-on

**Files:**
- Modify: `packages/frontend/src/components/ui/StatCard.tsx` (MiniSparkline function)

**Step 1: Add pathLength animation to sparkline**

Replace the `<polyline>` in MiniSparkline with a Framer Motion `motion.polyline`:

```tsx
import { motion } from 'framer-motion';

// In MiniSparkline, replace the <polyline> with:
<motion.polyline
  fill="none"
  stroke="currentColor"
  strokeWidth="1.5"
  strokeLinecap="round"
  strokeLinejoin="round"
  points={points}
  initial={{ pathLength: 0, opacity: 0 }}
  animate={{ pathLength: 1, opacity: 1 }}
  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
/>
```

Also animate the area fill:
```tsx
<motion.polygon
  fill="url(#sparkFill)"
  points={areaPoints}
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ duration: 0.5, delay: 0.6 }}
/>
```

**Step 2: Add hover lift to StatCard**

In the StatCard component, replace the outer `<div>` with `<motion.div>`:

```tsx
import { motion } from 'framer-motion';

// Replace:
<div className={clsx('stat-card group', className)}>

// With:
<motion.div
  className={clsx('stat-card group', className)}
  whileHover={{ y: -2, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.03)' }}
  transition={{ duration: 0.2 }}
>

// And close with </motion.div> instead of </div>
```

**Step 3: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 4: Commit**

```bash
git add packages/frontend/src/components/ui/StatCard.tsx
git commit -m "feat: animate sparkline draw-on and add hover lift to StatCard"
```

---

### Task 23: Polish EnrollmentPipelineChart tooltip and legend

**Files:**
- Modify: `packages/frontend/src/features/dashboard/EnrollmentPipelineChart.tsx`

**Step 1: Custom Recharts tooltip**

Add a custom tooltip component inside the file:

```tsx
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl shadow-lg border border-gray-200/60 bg-white/95 backdrop-blur-sm p-3 min-w-[180px]">
      <p className="text-sm font-semibold text-gray-900 mb-2">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-gray-600">{entry.name}</span>
          </div>
          <span className="font-medium text-gray-900">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}
```

Replace `<Tooltip />` with `<Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />`.

**Step 2: Update Legend to pill style**

Add a custom legend renderer:

```tsx
function CustomLegend({ payload }: any) {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3 justify-center">
      {payload.map((entry: any) => (
        <span
          key={entry.value}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-700"
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.value}
        </span>
      ))}
    </div>
  );
}
```

Replace `<Legend />` with `<Legend content={<CustomLegend />} />`.

**Step 3: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 4: Commit**

```bash
git add packages/frontend/src/features/dashboard/EnrollmentPipelineChart.tsx
git commit -m "feat: upgrade chart tooltip to glass style and legend to pill badges"
```

---

### Task 24: Extract and animate ProgressRing

**Files:**
- Create: `packages/frontend/src/components/ui/ProgressRing.tsx`
- Modify: `packages/frontend/src/features/providers/ProviderList.tsx` (import from new location)

**Step 1: Create ProgressRing component**

```tsx
import { motion } from 'framer-motion';
import clsx from 'clsx';

interface ProgressRingProps {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function getColor(value: number): string {
  if (value >= 80) return '#16a34a';
  if (value >= 50) return '#d97706';
  return '#dc2626';
}

export default function ProgressRing({
  value,
  size = 40,
  strokeWidth = 3,
  className,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color = getColor(clamped);

  return (
    <div className={clsx('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
          style={{ stroke: color, transition: 'stroke 0.3s ease' }}
        />
      </svg>
      <span className="absolute text-[10px] font-semibold text-gray-700">
        {clamped}%
      </span>
    </div>
  );
}
```

**Step 2: Update ProviderList.tsx import**

Find the inline ProgressRing definition in ProviderList.tsx and replace it with:

```tsx
import ProgressRing from '../../components/ui/ProgressRing';
```

Remove the inline ProgressRing function from ProviderList.tsx.

**Step 3: Build to verify**

```bash
npm run build --workspace=packages/frontend
```

**Step 4: Commit**

```bash
git add packages/frontend/src/components/ui/ProgressRing.tsx packages/frontend/src/features/providers/ProviderList.tsx
git commit -m "feat: extract ProgressRing to shared component with animated stroke"
```

---

### Task 25: Phase 4 PR

**Step 1: Build**

```bash
npm run build --workspace=packages/frontend
```

**Step 2: Visual check**

- [ ] Health score gauge has subtle glow behind the arc
- [ ] Health score number counts up on load
- [ ] Stat card sparklines draw left-to-right on mount
- [ ] Stat cards lift on hover
- [ ] Chart tooltip has glass styling (rounded-xl, backdrop-blur)
- [ ] Chart legend uses pill badges with colored dots
- [ ] Provider list progress rings animate on mount

**Step 3: Create PR**

```bash
git checkout -b feature/phase4-dataviz-polish
git push -u origin feature/phase4-dataviz-polish
gh pr create --title "Phase 4: Data visualization polish" --body "$(cat <<'EOF'
## Summary
- HealthScoreGauge: glow filter on score arc, smooth color transitions
- StatCard: sparkline draw-on animation, hover lift effect
- EnrollmentPipelineChart: glass-style custom tooltip, pill-badge legend
- ProgressRing: extracted to shared component with animated stroke fill

## Test plan
- [ ] Dashboard gauge glows subtly behind the arc
- [ ] Numbers count up (from Phase 1 AnimatedNumber)
- [ ] Sparklines draw left-to-right
- [ ] Stat cards lift on hover
- [ ] Chart tooltip matches design system (rounded-xl, glass)
- [ ] Provider list progress rings animate
- [ ] Build passes: `npm run build --workspace=packages/frontend`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Summary

| Phase | Tasks | New Files | Modified Files | New Deps |
|-------|-------|-----------|----------------|----------|
| 1: Framer Motion | 1-12 | 5 components | ~20 pages | framer-motion |
| 2: Empty States | 13-16 | 7 illustrations + barrel | ~21 pages | None |
| 3: Rich Toasts | 17-20 | Toast.tsx, notify.ts | main.tsx + 6 pages | None |
| 4: Data Viz | 21-25 | ProgressRing.tsx | 3 components + 1 page | None |

**Total: 25 tasks, 4 PRs, 1 new dependency**
