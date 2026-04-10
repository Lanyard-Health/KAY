/**
 * Email Templates Seed Script
 *
 * Seeds 8 email templates: 3 automated onboarding + 5 static on-demand.
 * Idempotent — safe to run multiple times (upserts by name).
 *
 * Usage:
 *   cd packages/backend && npx tsx prisma/seeds/emailTemplates.seed.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BRAND = '#0A3D2E';

function wrap(content: string): string {
  return `<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#333;line-height:1.6;padding:20px;">
${content}
<div style="margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb;">
  <p style="font-size:13px;color:#9ca3af;margin:0;">The Lanyard Health Team</p>
  <p style="font-size:12px;color:#d1d5db;margin:4px 0 0;">Credentialing, simplified.</p>
</div>
</div>`;
}

function cta(label: string): string {
  return `<p style="margin:28px 0;"><a href="https://app.lanyardhealth.com" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">${label}</a></p>`;
}

const templates = [
  // ──── AUTOMATED ONBOARDING ────
  {
    name: 'Welcome to Lanyard Health',
    subject: 'Welcome to Lanyard Health, {{practiceName}}! 🎉',
    type: 'AUTOMATED_ONBOARDING' as const,
    triggerEvent: 'SIGNUP_COMPLETE',
    body: wrap(`
<h2 style="color:${BRAND};margin:0 0 16px;">Welcome aboard, {{practiceName}}!</h2>
<p>We're thrilled you've joined Lanyard Health. You just took the first step toward making insurance credentialing a whole lot easier.</p>
<p>Lanyard automates the tedious parts of provider credentialing — from enrollment submissions to payer follow-ups — so your team can focus on what matters most: patient care.</p>
<p><strong>Here's what to do next:</strong></p>
<ol style="padding-left:20px;">
  <li>Complete your clinical profile (takes about 5 minutes)</li>
  <li>Add your first provider</li>
</ol>
${cta('Log in and get started')}
<p>If you have any questions along the way, just reply to this email. We're here to help.</p>`),
  },
  {
    name: 'Profile Complete — Nice Work!',
    subject: 'Your clinical profile is all set, {{practiceName}}',
    type: 'AUTOMATED_ONBOARDING' as const,
    triggerEvent: 'PROFILE_COMPLETE',
    body: wrap(`
<h2 style="color:${BRAND};margin:0 0 16px;">Nice work, {{practiceName}}!</h2>
<p>Your clinical profile is complete — that was quick! You're well on your way to getting your providers credentialed.</p>
<p><strong>What's next?</strong></p>
<p>Add a provider and kick off your first enrollment. If your providers are registered with CAQH, we can pull their data automatically to save you even more time.</p>
${cta('Add your first provider')}
<p>Need a hand? Just reply to this email and we'll walk you through it.</p>`),
  },
  {
    name: 'First Enrollment Submitted',
    subject: "You're on your way, {{practiceName}}!",
    type: 'AUTOMATED_ONBOARDING' as const,
    triggerEvent: 'FIRST_ENROLLMENT_SUBMITTED',
    body: wrap(`
<h2 style="color:${BRAND};margin:0 0 16px;">Your first enrollment is in!</h2>
<p>Great news, {{practiceName}} — your first enrollment has been submitted. That's a big milestone!</p>
<p>Here's what happens now:</p>
<ul style="padding-left:20px;">
  <li>Our team handles all the payer follow-ups</li>
  <li>You'll get status updates as things progress</li>
  <li>You can track everything from your dashboard</li>
</ul>
<p>Sit back and relax — <strong>we've got it from here.</strong></p>
${cta('View your dashboard')}
<p>Questions? We're always just an email away.</p>`),
  },

  // ──── STATIC ON-DEMAND ────
  {
    name: 'Document Request',
    subject: 'We need a few documents from you, {{practiceName}}',
    type: 'STATIC_ON_DEMAND' as const,
    triggerEvent: null,
    body: wrap(`
<h2 style="color:${BRAND};margin:0 0 16px;">Quick document request</h2>
<p>Hi {{practiceName}},</p>
<p>To move forward with your enrollment, we need the following documents:</p>
<ul style="padding-left:20px;background:#f9fafb;padding:16px 16px 16px 36px;border-radius:8px;border:1px solid #e5e7eb;">
  <li>[List documents needed]</li>
</ul>
<p>You can upload them directly through your Lanyard dashboard, or just reply to this email with the files attached — whatever's easiest.</p>
${cta('Upload documents')}
<p>Thanks for getting these over to us. It helps keep things moving smoothly!</p>`),
  },
  {
    name: 'Information Verification',
    subject: 'Quick check — can you verify some info, {{practiceName}}?',
    type: 'STATIC_ON_DEMAND' as const,
    triggerEvent: null,
    body: wrap(`
<h2 style="color:${BRAND};margin:0 0 16px;">Can you take a quick look?</h2>
<p>Hi {{practiceName}},</p>
<p>We noticed some information that may need a quick update:</p>
<div style="background:#f9fafb;padding:16px;border-radius:8px;border:1px solid #e5e7eb;margin:16px 0;">
  <p style="margin:0;color:#6b7280;">[Describe what needs verification]</p>
</div>
<p>Could you log in and double-check your practice or provider profile? Keeping everything accurate helps avoid delays with payers.</p>
${cta('Review your profile')}
<p>If everything looks right on your end, just let us know and we'll sort it out on ours.</p>`),
  },
  {
    name: 'Missing CAQH ID',
    subject: "Let's get your CAQH set up, {{practiceName}}",
    type: 'STATIC_ON_DEMAND' as const,
    triggerEvent: null,
    body: wrap(`
<h2 style="color:${BRAND};margin:0 0 16px;">We need your CAQH ID</h2>
<p>Hi {{practiceName}},</p>
<p>We tried to pull your provider's data from CAQH ProView but couldn't find a matching profile. Most insurance payers require an active CAQH profile for credentialing, so this is an important step.</p>
<p><strong>Here's how to get set up:</strong></p>
<ol style="padding-left:20px;">
  <li>Go to <a href="https://proview.caqh.org" style="color:${BRAND};font-weight:600;">proview.caqh.org</a></li>
  <li>Register for a new account or look up your existing CAQH ID</li>
  <li>Once you have it, enter it in your Lanyard provider profile</li>
</ol>
${cta('Update your provider profile')}
<p>If you're not sure where to start or run into any issues, just reply to this email. We're happy to walk you through it.</p>`),
  },
  {
    name: 'Enrollment Status Update',
    subject: 'Enrollment update for {{practiceName}}',
    type: 'STATIC_ON_DEMAND' as const,
    triggerEvent: null,
    body: wrap(`
<h2 style="color:${BRAND};margin:0 0 16px;">Enrollment status update</h2>
<p>Hi {{practiceName}},</p>
<p>Here's the latest on your enrollment:</p>
<div style="background:#f9fafb;padding:16px;border-radius:8px;border:1px solid #e5e7eb;margin:16px 0;">
  <p style="margin:0;color:#6b7280;">[Enrollment status details]</p>
</div>
<p>You can always check your dashboard for real-time status on all your enrollments. <strong>We're staying on top of it</strong> and will keep you posted as things progress.</p>
${cta('Check your dashboard')}
<p>Questions? Just reply — we're here.</p>`),
  },
  {
    name: 'We Miss You — Complete Your Setup',
    subject: 'Still there, {{practiceName}}? Let\'s finish what you started',
    type: 'STATIC_ON_DEMAND' as const,
    triggerEvent: null,
    body: wrap(`
<h2 style="color:${BRAND};margin:0 0 16px;">We noticed you haven't finished setting up</h2>
<p>Hi {{practiceName}},</p>
<p>It looks like you started setting up your Lanyard account but haven't completed the process yet. No worries — life gets busy!</p>
<p>The good news is your progress has been saved, so you can pick up right where you left off. Most practices are fully set up in under 10 minutes.</p>
${cta('Pick up where you left off')}
<p>If something was confusing or you hit a snag, we'd love to know. Just reply to this email and our team will personally help you get set up.</p>
<p>We built Lanyard to make credentialing painless — let us prove it. 😊</p>`),
  },
];

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Email Templates Seed');
  console.log('═══════════════════════════════════════════════════\n');

  // Find an admin user to use as creator
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true, email: true },
  });

  if (!admin) {
    console.error('ERROR: No admin user found in the database. Cannot seed templates without a createdBy user.');
    process.exit(1);
  }

  console.log(`Using admin user: ${admin.email} (${admin.id})\n`);

  let created = 0;
  let updated = 0;

  for (const tpl of templates) {
    const result = await prisma.emailTemplate.upsert({
      where: {
        // name is not unique in schema, so use a compound approach:
        // find existing by name first, then upsert by id
        id: (await prisma.emailTemplate.findFirst({ where: { name: tpl.name } }))?.id ?? 'nonexistent',
      },
      update: {
        subject: tpl.subject,
        body: tpl.body,
        type: tpl.type,
        triggerEvent: tpl.triggerEvent,
      },
      create: {
        name: tpl.name,
        subject: tpl.subject,
        body: tpl.body,
        type: tpl.type,
        triggerEvent: tpl.triggerEvent,
        createdBy: admin.id,
      },
    });

    const isNew = result.createdBy === admin.id && !result.updatedAt;
    // Check if it was just created by comparing timestamps
    const justCreated = new Date().getTime() - new Date(result.createdAt).getTime() < 5000;
    if (justCreated) {
      created++;
      console.log(`  ✓ Created: ${tpl.name}`);
    } else {
      updated++;
      console.log(`  ↻ Updated: ${tpl.name}`);
    }
  }

  console.log(`\nDone! ${created} created, ${updated} updated.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
