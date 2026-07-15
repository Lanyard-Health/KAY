# Design

Visual system captured from the live codebase (tailwind.config.js, src/index.css, src/components/ui). Light theme only.

## Theme

Light, calm, soft-edged. App background `#f8f8fa`; content sits on white cards with hairline gray borders and very subtle shadows. Deep green is the identity color; semantic colors are tinted pills, never full-bleed.

## Colors

- **Primary (Lanyard green):** 50 `#f0faf6`, 100 `#d6f0e4`, 200 `#b0e0cb`, 300 `#7ccaab`, 400 `#4aab85`, 500 `#2d8b6a`, 600 `#1a6b4e` (primary buttons), 700 `#0A3D2E` (hover, brand anchor), 800 `#082f23`, 900 `#061f17`.
- **Status:** success `#16a34a`, warning `#d97706`, danger `#dc2626`, info `#2563eb`, neutral `#6b7280`.
- **Surfaces:** 0 `#ffffff`, 1 `#f9fafb`, 2 `#f3f4f6`, 3 `#e5e7eb`; page background `#f8f8fa`.
- Status rendering pattern: tinted background + same-hue text + inset ring at ~10–20% opacity (e.g. `bg-red-50 text-red-700 ring-red-600/20`), optional leading dot.

## Typography

- Family: **Inter**, falling back to the system sans stack. One family everywhere.
- Product-register scale: fixed rem sizes, mostly `text-xs`–`text-sm` for UI, `text-lg`/`text-xl` semibold for page and section titles. Labels: `text-sm font-medium text-gray-600`.

## Components

- **Buttons:** `rounded-xl`, `px-4 py-2.5`, `text-sm font-medium`, subtle shadow, `active:scale-[0.98]` press. Primary = green-600 → green-700 hover; secondary = white with `border-gray-200/80`; danger = red-600.
- **Cards:** white, `rounded-2xl`, `border-gray-200/60`, `shadow-sm`. Headers separated by `border-gray-100` hairline.
- **Inputs:** `rounded-xl`, gray-200 border, green focus ring.
- **Badges (StatusBadge):** pill (`rounded-full`), `text-xs font-medium`, tinted bg + inset ring per the status pattern, optional dot.
- **States:** dedicated EmptyState, ErrorState, LoadingState (skeleton) components exist; use them, don't invent new ones.

## Motion

- `fade-in 0.2s ease-out`, `slide-up 0.3s ease-out`, `scale-in 0.2s ease-out`. Transitions ~200ms. Motion signals state change only.

## Layout

- App shell: fixed side nav, content area on `#f8f8fa`.
- Tables and lists run dense; prose stays ≤75ch.
- Radius vocabulary: xl for controls, 2xl for containers, full for pills.
