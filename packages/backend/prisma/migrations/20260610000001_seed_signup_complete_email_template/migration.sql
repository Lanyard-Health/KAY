-- Seeds the SIGNUP_COMPLETE welcome email template.
--
-- This is data, not schema, but we ship it as a migration so it lands
-- automatically on every deploy without an out-of-band seed step.
--
-- Idempotent: if a template with this trigger_event already exists, do nothing.
-- Picks the creator user via a fallback chain:
--   1. kay@lanyardhealth.com (founder, expected to exist on prod/staging)
--   2. any user with role='admin'
--   3. any user (last resort)
-- If users table is empty, the INSERT no-ops gracefully.

WITH creator AS (
  SELECT id FROM users WHERE email = 'kay@lanyardhealth.com'
  UNION ALL
  SELECT id FROM users WHERE role = 'admin' AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'kay@lanyardhealth.com')
  UNION ALL
  SELECT id FROM users WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'kay@lanyardhealth.com' OR role = 'admin')
  LIMIT 1
)
INSERT INTO email_templates (
  id, name, subject, body, type, trigger_event, is_active, created_by, updated_at, created_at
)
SELECT
  gen_random_uuid(),
  'Welcome — Signup Complete',
  'You''re in, {{firstName}} — welcome to Lanyard Health',
  $WELCOME_HTML$<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Lanyard Health</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif; color:#1a2e26;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f6f5; padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; background-color:#ffffff; border-radius:12px; box-shadow:0 1px 3px rgba(10,61,46,0.06); overflow:hidden;">
          <!-- Brand bar -->
          <tr>
            <td style="background-color:#0A3D2E; padding:32px 40px; text-align:left;">
              <img src="https://portal.lanyardhealth.com/logo.png" alt="Lanyard Health" width="48" height="48" style="display:block; filter:brightness(0) invert(1);" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 24px 0; font-size:24px; font-weight:600; line-height:1.3; color:#0A3D2E;">
                You're in, {{firstName}}.
              </h1>

              <p style="margin:0 0 16px 0; font-size:16px; line-height:1.6; color:#1a2e26;">
                <strong>{{practiceName}}</strong> is set up and ready. I'm glad you're here.
              </p>

              <p style="margin:0 0 16px 0; font-size:16px; line-height:1.6; color:#1a2e26;">
                I've lived the credentialing pain alongside other practice owners — the forms, the back-and-forth with payers, the silent rejections, the months of lost revenue waiting on a single signature. That's why I built Lanyard. To take that work off your plate and give you the visibility you should've had the whole time.
              </p>

              <p style="margin:0 0 32px 0; font-size:16px; line-height:1.6; color:#1a2e26;">
                Three small things to do in your first ten minutes:
              </p>

              <!-- Next steps -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 32px 0;">
                <tr>
                  <td style="padding:0 0 16px 0; vertical-align:top; width:32px;">
                    <div style="width:24px; height:24px; border-radius:50%; background-color:#0A3D2E; color:#ffffff; text-align:center; line-height:24px; font-size:13px; font-weight:600;">1</div>
                  </td>
                  <td style="padding:0 0 16px 0; vertical-align:top;">
                    <strong style="font-size:15px; color:#1a2e26;">Round out your practice profile.</strong><br />
                    <span style="font-size:14px; color:#4b5d57;">Two minutes — operating states and any payers you didn't add at signup. We use it to surface what's relevant and skip what isn't.</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 16px 0; vertical-align:top; width:32px;">
                    <div style="width:24px; height:24px; border-radius:50%; background-color:#0A3D2E; color:#ffffff; text-align:center; line-height:24px; font-size:13px; font-weight:600;">2</div>
                  </td>
                  <td style="padding:0 0 16px 0; vertical-align:top;">
                    <strong style="font-size:15px; color:#1a2e26;">Add your first provider.</strong><br />
                    <span style="font-size:14px; color:#4b5d57;">Drop in an NPI. We pull what we can from the NPI Registry and CAQH so you're not retyping things you've already typed somewhere else.</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 0 0; vertical-align:top; width:32px;">
                    <div style="width:24px; height:24px; border-radius:50%; background-color:#0A3D2E; color:#ffffff; text-align:center; line-height:24px; font-size:13px; font-weight:600;">3</div>
                  </td>
                  <td style="padding:0; vertical-align:top;">
                    <strong style="font-size:15px; color:#1a2e26;">Start an enrollment.</strong><br />
                    <span style="font-size:14px; color:#4b5d57;">Pick a payer. We'll walk it from intake to approval and tell you exactly what's needed at each step — no more guessing what the form actually wants.</span>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 32px 0;">
                <tr>
                  <td align="center">
                    <a href="{{dashboardUrl}}" style="display:inline-block; background-color:#0A3D2E; color:#ffffff; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:15px; font-weight:600; letter-spacing:0.2px;">
                      Go to your dashboard →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px 0; font-size:14px; line-height:1.6; color:#4b5d57;">
                Hit reply to this email and you'll reach me directly — not a help desk, not a ticket queue. I read every one, usually within a few hours. Tell me what's clunky, what's confusing, what you wish Lanyard did differently. Early users shape what this becomes.
              </p>
              <p style="margin:0; font-size:14px; line-height:1.6; color:#1a2e26;">
                — Kay Ward<br />
                <span style="color:#4b5d57;">Founder, Lanyard Health</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9faf9; padding:24px 40px; border-top:1px solid #e5ebe8; font-size:12px; line-height:1.6; color:#6b7976;">
              <p style="margin:0 0 12px 0;">
                <a href="https://lanyardhealth.com" style="color:#0A3D2E; text-decoration:none; font-weight:600; margin-right:16px;">Website</a>
                <a href="https://www.linkedin.com/company/lanyard-health" style="color:#0A3D2E; text-decoration:none; font-weight:600;">LinkedIn</a>
              </p>
              <p style="margin:0 0 4px 0;">
                Lanyard Health · Provider credentialing for small &amp; mid-size practices
              </p>
              <p style="margin:0;">
                You're receiving this because you just created an account at <a href="{{dashboardUrl}}" style="color:#0A3D2E; text-decoration:none;">portal.lanyardhealth.com</a>. This is a one-time welcome message, not a subscription.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>$WELCOME_HTML$,
  'AUTOMATED_ONBOARDING'::"EmailTemplateType",
  'SIGNUP_COMPLETE',
  TRUE,
  creator.id,
  NOW(),
  NOW()
FROM creator
WHERE NOT EXISTS (
  SELECT 1 FROM email_templates WHERE trigger_event = 'SIGNUP_COMPLETE'
);
