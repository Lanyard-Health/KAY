# Portal Completion & UI Polish Design

**Date:** 2026-02-17
**Scope:** Complete PortalLicenses + PortalLocations stubs, UI/UX polish across portal

---

## 1. PortalLicenses — Full CRUD

**Goal:** Providers can view, add, edit, and delete their own licenses.

**Layout:** Card grid (1 col mobile, 2 col desktop). Each card shows:
- License type (human-readable label), license number, state
- Issue date, expiration date, status badge (active/expired/pending/revoked)
- Expiration warning when <30 days remaining
- Edit and Delete buttons

**Add/Edit Modal:** Form with fields from License schema:
- licenseType (select from enum), licenseNumber, state (2-letter select)
- issueDate, expirationDate (date pickers)
- status (select), notes (optional textarea)

**API Integration:**
- List: `GET /api/v1/credentials/licenses/:providerId`
- Create: `POST /api/v1/credentials/licenses/:providerId`
- Update: `PUT /api/v1/credentials/licenses/:id`
- Delete: `DELETE /api/v1/credentials/licenses/:id`

**Backend consideration:** Portal routes currently use `requireProviderAccess` middleware — providers can already access their own license endpoints. Need to verify the `provider` role is authorized on credential routes (currently authorize for admin/staff/practice_admin). May need a portal-specific route or middleware adjustment.

---

## 2. PortalLocations — Full CRUD

**Goal:** Providers can view, add, edit their practice locations.

**Layout:** Card grid matching PortalLicenses style. Each card shows:
- Location name, type, primary badge
- Full address, phone, fax
- Accessibility indicators (wheelchair, transit, parking)
- Accepting new patients badge
- Edit button

**Add/Edit Modal:** Form with key fields:
- locationName, locationType, isPrimary toggle
- addressLine1, addressLine2, city, state, zipCode
- phone, fax (optional), email (optional)
- wheelchairAccessible, publicTransitAccess, parkingAvailable toggles
- acceptingNewPatients toggle
- notes (optional)

**API Integration:**
- List: `GET /api/v1/practiceLocation/provider/:providerId`
- Create: `POST /api/v1/practiceLocation/provider/:providerId`
- Update: `PUT /api/v1/practiceLocation/:id`

**Note:** Delete restricted to admin/staff per existing route config — providers can add/edit but not delete.

---

## 3. UI/UX Polish

- Consistent card component styling across all portal pages
- Improved empty states with icons and actionable messages
- Status badges use consistent color scheme (green=active, red=expired, yellow=pending, gray=revoked)
- Mobile-responsive card grids
- Smooth loading skeletons instead of plain spinners where appropriate

---

## Implementation Plan

1. Add portal license hooks (usePortalLicenses CRUD) in usePortalData.ts
2. Build LicenseFormModal component
3. Build PortalLicenses page with cards + modal
4. Add portal location hooks (CRUD) in usePortalData.ts
5. Build LocationFormModal component
6. Build PortalLocations page with cards + modal
7. UI polish pass across portal pages
8. Backend: verify/add provider role authorization on credential and location routes
