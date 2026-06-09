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
| Current MFA enforcement | **No MFA** (rolled back after the 2026-06-09 enable attempt) |
| Founder user (Kay) MFA status | MFA setting: inactive. MFA methods: none. |

## What went wrong on the 2026-06-09 enable attempt

1. MFA enforcement was flipped to **Require MFA — Recommended**.
2. The MFA methods sub-section (which appears after picking "Require MFA") had **Email message** ticked by default — Cognito's new console version pre-checks Email as an MFA factor.
3. On next sign-in, Cognito issued `CONFIRM_SIGN_IN_WITH_EMAIL_CODE` (email MFA).
4. The frontend (`packages/frontend/src/stores/auth.store.ts`) has no handler for that challenge — only `CONFIRM_SIGN_IN_WITH_TOTP_CODE`, `CONTINUE_SIGN_IN_WITH_TOTP_SETUP`, `CONTINUE_SIGN_IN_WITH_MFA_SELECTION`, `NEW_PASSWORD_REQUIRED`, `DONE`.
5. Codes arrived in inbox; UI had no input. User-visible behavior: spinner returns to login with no error (before PR #341), or "Sign-in returned an unsupported step: CONFIRM_SIGN_IN_WITH_EMAIL_CODE" after PR #341 (would surface if rolled back to Required).
6. Rolled back to **No MFA** to restore normal login.

## The clean configuration

| Setting | Value | Why |
|---|---|---|
| MFA enforcement | **Require MFA** | Verdict P1-2 launch blocker. |
| MFA methods → **Authenticator apps** | ✅ ticked | TOTP via authenticator app; frontend already handles `CONTINUE_SIGN_IN_WITH_TOTP_SETUP` + `CONFIRM_SIGN_IN_WITH_TOTP_CODE`. |
| MFA methods → **SMS message** | ❌ unticked | NIST 800-63B deprecates SMS MFA for high-security apps; healthcare = high-security. Also pool has no SNS role configured, so SMS would error anyway. |
| MFA methods → **Email message** | ❌ unticked | Frontend has no `CONFIRM_SIGN_IN_WITH_EMAIL_CODE` UI. Don't add it — email MFA is weaker than TOTP. |
| Passkey | leave as configured (currently "Preferred" user verification) | Independent of MFA; separate sign-in factor for the choice-based flow. |
| App client auth flows | leave both `USER_AUTH` + `USER_SRP_AUTH` enabled | Amplify v6's default for `signIn()` is SRP, which is what gets used. USER_AUTH stays available for future passwordless flow. |

## Enable procedure

1. **Have an authenticator app ready before starting.** 1Password, Google Authenticator, or Authy. Open it before step 4 so you can scan immediately.
2. AWS console → Cognito → User pools → `User pool - 4mon7c` → Sign-in → **Multi-factor authentication** → Edit.
3. Select **Require MFA — Recommended**.
4. In the MFA methods section that appears: tick **only Authenticator apps**. Explicitly uncheck Email message + SMS message. Re-verify before clicking Save.
5. **Save changes.**
6. **Open an incognito browser window** (Cmd+Shift+N). Go to `portal.lanyardhealth.com`.
7. Sign in with email + password.
8. Expect: QR code page (not email codes).
9. Authenticator app → Add account → scan QR → enter 6-digit code → submit.
10. Logged in.
11. **Verify steady state**: log out, log back in. Expect 6-digit code prompt (no QR — already enrolled). Enter code → logged in.

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Email codes arrive instead of QR code | Email-MFA still ticked in MFA methods | AWS console → MFA Edit → uncheck Email message → Save |
| "Sign-in returned an unsupported step" error | Unhandled signInStep from Cognito (the catch-all from PR #341 working as intended) | Read the step name from the error message; if not `CONTINUE_SIGN_IN_WITH_TOTP_SETUP` or `CONFIRM_SIGN_IN_WITH_TOTP_CODE`, the MFA methods sub-section likely has SMS or Email ticked. Re-verify config. |
| Spinner with no error after submit | Stale Amplify cache in IndexedDB | Always test in incognito. Or clear all site data including IndexedDB. |
| Locked out of prod | Authenticator app lost / phone wiped | AWS console → Users → `kay@lanyardhealth.com` → Actions → Reset MFA. Instant. |

## Code references

- Frontend MFA challenge router: `packages/frontend/src/stores/auth.store.ts:324-411` (`login()` function)
- TOTP setup helper: `packages/frontend/src/stores/auth.store.ts:449-455` (`handleMfaSetup()`)
- TOTP code confirmation: `packages/frontend/src/stores/auth.store.ts:457-481` (`confirmMfaSetup()`)
- Login UI for MFA flows: `packages/frontend/src/features/auth/LoginPage.tsx:302-393`

## Open follow-ups

- Add a unit test for `auth.store.login()` that asserts `CONFIRM_SIGN_IN_WITH_EMAIL_CODE` and other unhandled steps surface the catch-all error — covered by PR #341's catch-all but no test yet.
- If we ever want Email MFA, add `CONFIRM_SIGN_IN_WITH_EMAIL_CODE` UI + handler. Don't enable Email MFA at the pool level until that ships.
- `lanyard-prod` app client purpose unclear — investigate whether it's still in use or can be retired.
