# Premium UI Polish — Design Document

**Date:** 2026-02-26
**Status:** Approved

## Goal

Elevate Lanyard Health's frontend from "clean and consistent" to "world-class premium" through four focused phases: page/list animations, illustrated empty states, rich contextual toasts, and data visualization polish.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Animation library | Framer Motion | Industry standard (Linear, Stripe, Vercel). ~30KB gzipped. Full control over orchestrated sequences, layout animations, AnimatePresence for enter/exit. |
| Empty state style | Illustrated SVGs | Custom line-art illustrations per context. Biggest "designed by humans" signal. 6 reusable presets cover all 21 instances. |
| Toast approach | Rich contextual (custom renderer) | Keep react-hot-toast engine, fully custom render. Backwards-compatible — existing 45+ calls auto-upgrade. New `notify.*` API for descriptions. |
| Data viz scope | Polish existing only | Upgrade HealthScoreGauge, StatCard, EnrollmentPipelineChart, ProgressRing with animations and glass styling. No new visualizations. |

## Existing State (Pre-Work)

- **Animations:** Tailwind-only. Custom keyframes in 2 portal files. No animation library.
- **Empty states:** `EmptyState.tsx` component exists but 20/21 instances are hardcoded plain text.
- **Cmd+K:** Already fully implemented (CommandPalette.tsx). No work needed.
- **Toasts:** react-hot-toast with default styling. 45+ calls. Custom ApprovalToasts exists separately.
- **Data viz:** Recharts for one bar chart. SVG gauges for health score and progress rings. StatCard has sparklines.

---

## Phase 1: Framer Motion — Page & List Animations

**New dependency:** `framer-motion`

### 1.1 PageTransition wrapper

`components/ui/PageTransition.tsx` — wraps every lazy-loaded page in App.tsx.

- Mount: `opacity: 0 → 1`, `y: 8 → 0`, 200ms ease-out
- Applied once around `<Suspense>` children so every route transition animates automatically

### 1.2 Route progress bar

Replace the centered spinner `LoadingFallback` in App.tsx with a thin animated bar at the top of the viewport.

- Slim green line (`primary-600`), ease-in-out, auto-completes on mount
- Psychologically feels 2x faster than a centered spinner

### 1.3 AnimatedList

`components/ui/AnimatedList.tsx` — wraps table `<tbody>` or card grids.

- Children stagger in: 30ms delay between items, `opacity: 0 → 1`, `y: 6 → 0`
- `layout` prop on each item for smooth reflow when filtering/removing
- Used in: ProviderList, UsersList, EnrollmentsList, DocumentList, PendingProviders, all table views

### 1.4 AnimatedCard

`components/ui/AnimatedCard.tsx` — for dashboard stat cards.

- Scale-in on mount: `scale: 0.97 → 1`, `opacity: 0 → 1`
- Staggered across the grid

### 1.5 Modal transitions

Replace HeadlessUI CSS transitions with Framer Motion `AnimatePresence` for smoother modal enter/exit across all dialogs.

### 1.6 Skeleton-to-content crossfade

When `isLoading` flips to false, skeleton fades out as real content fades in — not an instant swap.

### 1.7 AnimatedNumber

`components/ui/AnimatedNumber.tsx` — animated count/morph for any numeric value.

- Uses `useMotionValue` + `useTransform` + `useSpring`
- Dashboard stat values count up on mount and morph on data change
- Applied to: StatCard values, HealthScoreGauge score, any visible metric

### 1.8 Layout animations on filter/remove

Framer Motion `layout` prop on list items so remaining rows smoothly reposition when items are filtered, removed, or reordered. Applies to provider list filtering, roster column drag-and-drop, enrollment list filtering.

---

## Phase 2: Illustrated Empty States

### 2.1 Upgrade EmptyState.tsx

Add `illustration` prop accepting a named preset. Falls back to `icon` prop for backwards compatibility.

### 2.2 Six SVG illustration presets

Minimal line-art style, single accent color (primary-600), consistent 120x120 viewBox:

| Preset | Visual | Context |
|--------|--------|---------|
| `search` | Magnifying glass over empty page | Filter/search returns zero results |
| `inbox` | Open box with dotted outline | List empty, first time |
| `clipboard` | Clipboard with checkmarks floating | No tasks/work items |
| `folder` | Open folder, paper peek | No documents |
| `chart` | Bar chart with zero-height bars | No data/analytics |
| `people` | Two person silhouettes, outlined | No users/providers/staff |

### 2.3 Instance mapping (21 locations)

| Files | Illustration | Action Button |
|-------|-------------|---------------|
| ProviderList, UsersList, OpsStaffPage, PendingProviders | `people` | "Add first provider" / contextual |
| DocumentList | `folder` | "Upload a document" |
| OpsWorkQueue, ProviderTasks, OpsDashboard | `clipboard` | — (filter message) |
| EnrollmentPipelineChart, RosterPreviewTable | `chart` | — |
| NotificationsPage, OpsActivityLog | `inbox` | — |
| CommandPalette "no results" | `search` | — |
| OpsPracticesList, PracticesList, OnboardingProgress | `inbox` | "Add a practice" |

Each instance: action button for first-time empty, softer "Try adjusting your filters" for filtered-to-zero.

---

## Phase 3: Rich Contextual Toasts

### 3.1 Custom toast renderer

`components/ui/Toast.tsx` — 4 variants:

| Variant | Left Border | Icon | Auto-Dismiss |
|---------|-------------|------|-------------|
| `success` | Green (primary-600) | Check circle | 4s |
| `error` | Red | X circle | 6s |
| `loading` | Amber, pulsing | Spinner | None |
| `info` | Blue | Info circle | 4s |

Styling: `rounded-xl shadow-lg border border-gray-200/60 bg-white backdrop-blur-sm`, 4px colored left border, icon + bold title + gray description, close button on hover. Slide-in from right, max 3 visible.

### 3.2 notify API

```ts
notify.success('Provider created', { description: 'John Smith added to Active Providers' })
notify.error('Upload failed', { description: 'File exceeds 10MB limit' })
notify.loading('Exporting roster...')
```

Wraps react-hot-toast. Old `toast.success('msg')` calls auto-render with new styling (no description line). Progressively upgrade high-value callsites.

### 3.3 Toaster config update

Replace `<Toaster position="top-right" />` in main.tsx with custom config using the new renderer.

### 3.4 Priority callsite upgrades

LoginPage, RegisterPage, RosterPage, PortalDocuments, EnrollmentsList, PendingProviders — upgrade from `toast.*` to `notify.*` with contextual descriptions.

---

## Phase 4: Data Visualization Polish

### 4.1 HealthScoreGauge

- Animated count-up: 0 → score using AnimatedNumber from Phase 1
- Glow ring: `filter: drop-shadow(0 0 6px ${color}40)` with soft pulse
- Glass-card container: `bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-gray-200/60`
- Smooth color transition when score changes

### 4.2 StatCard

- Value: AnimatedNumber for count-up/morph on change
- Sparkline: `pathLength` draw-on animation (line draws left-to-right, 800ms)
- Trend arrow: bounce-in on appear
- Hover: card lifts (`y: -2`, `shadow-md`), sparkline brightens

### 4.3 EnrollmentPipelineChart

- Bar segments grow from 0 → actual width, staggered 50ms per row
- Tooltip: `rounded-xl shadow-lg border border-gray-200/60 bg-white/95 backdrop-blur-sm`
- Legend: `rounded-full` pills with dot indicators
- Empty state: Phase 2 `chart` illustration

### 4.4 ProgressRing extraction

- Extract from ProviderList.tsx to `components/ui/ProgressRing.tsx`
- Animated stroke fill on mount (500ms, Framer Motion)
- Smooth color transition as percentage changes

---

## Implementation Order

Phase 1 first (foundation — other phases use AnimatedNumber, AnimatePresence).
Phases 2-4 can be parallelized after Phase 1 merges.

## What Does NOT Change

- All auth logic, data flow, API calls, routing
- Existing Tailwind transition utilities for hover/focus
- HeadlessUI for dropdowns/menus (only modals get FM transitions)
- Recharts as chart library
- react-hot-toast as toast engine
- Login page design (preserved per MEMORY.md rules)
