# Cognito MFA Runbook (Lanyard prod)

Verdict P1-2 — Require MFA on the prod Cognito user pool.

## Current state (audited 2026-06-09)

| Item | Value |
|---|---|
| Pool | `us-east-1_SXOvfeegD` (friendly name "User pool - 4mon7c") |
| Pool account | `prod-lanyardhealth (891612573861)` |
| App clients | `lanyard-frontend` (`60cbvvha4s4kuaqqoojs8f8amb`), `lanyard-prod` (`7fbcn34r23beebvqhrpvbotl91`) |
| Frontend client uses | `lanyard-frontend` (matches Render `COGNITO_CLIENT_ID`) |
| Frontend auth flows enabled | Choice-based sign-in (`USER_AUTH`), Secure remote password (`USER_SRP_AUTH`) |
| Pool factors configured | Email (SES `invites@lanyardhealth.com`), Passkey (Cognito prefix domain). **SMS not configured.** |
| Current MFA enforcement | **Require MFA** — Authenticator + Email both enabled (live 2026-06-09 after PR #345) |
| Founder user (Kay) MFA status | Active — verified working via dual-MFA picker flow |

## What went wrong on the 2026-06-09 enable attempt

1. MFA enforcement was flipped to **Require MFA — Recommended**.
2. The MFA methods sub-section (which appears after picking "Require MFA") had **Email message** ticked by default — Cognito's new console version pre-checks Email as an MFA factor.
3. On next sign-in, Cognito issued `CONFIRM_SIGN_IN_WITH_EMAIL_CODE` (email MFA).
4. The frontend (`packages/frontend/src/stores/auth.store.ts`) has no handler for that challenge — only `CONFIRM_SIGN_IN_WITH_TOTP_CODE`, `CONTINUE_SIGN_IN_WITH_TOTP_SETUP`, `CONTINUE_SIGN_IN_WITH_MFA_SELECTION`, `NEW_PASSWORD_REQUIRED`, `DONE`.
5. Codes arrived in inbox; UI had no input. User-visible behavior: spinner returns to login with no error (before PR #341), or "Sign-in returned an unsupported step: CONFIRM_SIGN_IN_WITH_EMAIL_CODE" after PR #341 (would surface if rolled back to Required).
6. Rolled back to **No MFA** to restore normal login.
7. **PR #343 closed the gap**: added the email-code UI + handler AND a method picker so users can choose Authenticator or Email. The "clean configuration" table below now reflects dual-MFA as the recommended state.

## The clean configuration

| Setting | Value | Why |
|---|---|---|
| MFA enforcement | **Require MFA** | Verdict P1-2 launch blocker. |
| MFA methods → **Authenticator apps** | ✅ ticked | TOTP via authenticator app; frontend handles `CONTINUE_SIGN_IN_WITH_TOTP_SETUP` + `CONFIRM_SIGN_IN_WITH_TOTP_CODE`. |
| MFA methods → **Email message** | ✅ ticked | Email is more accessible than TOTP for some users (founders, admin staff without an authenticator app). PR #343 added the `CONFIRM_SIGN_IN_WITH_EMAIL_CODE` handler + UI. |
| MFA methods → **SMS message** | ❌ unticked | NIST 800-63B deprecates SMS MFA for high-security apps; healthcare = high-security. Also pool has no SNS role configured, so SMS would error anyway. |
| Passkey | leave as configured (currently "Preferred" user verification) | Independent of MFA; separate sign-in factor for the choice-based flow. |
| App client auth flows | leave both `USER_AUTH` + `USER_SRP_AUTH` enabled | Amplify v6's default for `signIn()` is SRP, which is what gets used. USER_AUTH stays available for future passwordless flow. |

**Note on the dual-MFA design:** With both Authenticator and Email enabled, Cognito returns `CONTINUE_SIGN_IN_WITH_MFA_SELECTION` on the first sign-in. The frontend shows a picker (two buttons: Authenticator / Email); the user chooses. Per `project_lanyard_mfa_preference` (user memory), end users explicitly choose the factor — the frontend does NOT auto-pick.

## Enable procedure

1. **Confirm PR #343 is live in prod.** Required: `c97d014` or later on `kay-frontend`. If it's not deployed yet, the email-code path will fail silently (PR #341's catch-all will surface an error but the flow is broken).
2. **Have an authenticator app ready before starting** if you want to test the TOTP path. 1Password, Google Authenticator, or Authy.
3. AWS console → Cognito → User pools → `User pool - 4mon7c` → Sign-in → **Multi-factor authentication** → Edit.
4. Select **Require MFA — Recommended**.
5. In the MFA methods section that appears:
   - ✅ Tick **Authenticator apps**
   - ✅ Tick **Email message**
   - ❌ Leave **SMS message** unchecked
   - Re-verify all three checkboxes before clicking Save.
6. **Save changes.**
7. **Open an incognito browser window** (Cmd+Shift+N). Go to `portal.lanyardhealth.com`.
8. Sign in with email + password.
9. Expect: **"Choose verification method"** page with two buttons — Authenticator app and Email.
10. **Test the Email path first** (faster, no enrollment needed): click **Email** → 6-digit code arrives in inbox from `invites@lanyardhealth.com` → enter → logged in.
11. Log out → log back in → picker appears again → this time click **Authenticator app** → QR code page → scan → enter code → logged in.
12. Log out → log back in → expect 6-digit code prompt from authenticator (Cognito may remember the user's last-used method, depending on user pool config).

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| No picker appears, just QR code | Only Authenticator is ticked in MFA methods (Email forgot to be ticked) | AWS console → MFA Edit → re-tick Email message → Save |
| No picker, only email codes arrive with no UI | PR #343 not deployed yet | Confirm `kay-frontend` Render deploy is on commit `c97d014` or later. Trigger manual deploy if needed. |
| "Sign-in returned an unsupported step" error | Unhandled signInStep from Cognito (the catch-all from PR #341 working as intended) | Read the step name from the error message and report it. Likely an MFA method got enabled that the frontend doesn't handle (SMS?). |
| Spinner with no error after submit | Stale Amplify cache in IndexedDB | Always test in incognito. Or clear all site data including IndexedDB. |
| Locked out of prod | Authenticator app lost AND email inaccessible | AWS console → Users → `kay@lanyardhealth.com` → Actions → Reset MFA. Instant. |

## Code references

- Frontend MFA challenge router: `packages/frontend/src/stores/auth.store.ts:login()` — handles `MFA_SELECTION`, `EMAIL_CODE`, `TOTP_CODE`, `TOTP_SETUP`, `NEW_PASSWORD_REQUIRED`, `DONE`
- MFA method picker handler: `packages/frontend/src/stores/auth.store.ts:selectMfaMethod()`
- Email code verification: `packages/frontend/src/stores/auth.store.ts:handleEmailMfaCode()`
- TOTP code verification: `packages/frontend/src/stores/auth.store.ts:handleMfaChallenge()`
- TOTP setup helper: `packages/frontend/src/stores/auth.store.ts:handleMfaSetup()` / `confirmMfaSetup()`
- Login UI for all MFA flows: `packages/frontend/src/features/auth/LoginPage.tsx` cases `mfa-select`, `mfa-email`, `mfa-totp`, `mfa-setup`

## Open follow-ups

- Add a unit test for `auth.store.login()` that asserts `CONFIRM_SIGN_IN_WITH_EMAIL_CODE` and other unhandled steps surface the catch-all error — covered by PR #341's catch-all but no test yet.
- If we ever want Email MFA, add `CONFIRM_SIGN_IN_WITH_EMAIL_CODE` UI + handler. Don't enable Email MFA at the pool level until that ships.
- `lanyard-prod` app client purpose unclear — investigate whether it's still in use or can be retired.
