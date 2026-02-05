#!/usr/bin/env node
/**
 * Import data from credentials_db_export.json into local PostgreSQL via Prisma
 */

import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EXPORT_PATH = '/Users/kay/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/json files/credmanager-export/credentials_db_export.json';

// snake_case → camelCase helper
function toCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Convert all keys of an object from snake_case to camelCase
function camelKeys(obj) {
  if (obj === null || obj === undefined) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[toCamel(k)] = v;
  }
  return out;
}

// Parse date strings, return null if empty
function parseDate(val) {
  if (!val) return null;
  return new Date(val);
}

// Parse optional int
function parseInt2(val) {
  if (val === null || val === undefined) return null;
  return parseInt(val, 10);
}

async function main() {
  console.log('Reading export file...');
  const raw = fs.readFileSync(EXPORT_PATH, 'utf8');
  const data = JSON.parse(raw);

  console.log('Tables found:', Object.keys(data).join(', '));
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) console.log(`  ${k}: ${v.length} records`);
  }

  // ── 1. Clean up auto-created dev user & import users ─────
  console.log('\n--- Importing users ---');

  // Delete auto-created dev user first to avoid conflicts
  try {
    await prisma.user.deleteMany({ where: { id: 'dev-user-id' } });
    console.log('  Removed auto-created dev user');
  } catch (_) {}

  // First pass: create users WITHOUT providerId (to avoid FK issues)
  for (const u of data.users) {
    try {
      await prisma.user.upsert({
        where: { id: u.id },
        update: {},
        create: {
          id: u.id,
          cognitoId: u.cognito_id,
          email: u.email,
          firstName: u.first_name,
          lastName: u.last_name,
          role: u.role,
          isActive: u.is_active,
          lastLoginAt: parseDate(u.last_login_at),
          providerId: null, // Link later after providers exist
          createdAt: parseDate(u.created_at) || new Date(),
          updatedAt: parseDate(u.updated_at) || new Date(),
        },
      });
      console.log(`  ✓ User: ${u.email} (${u.role})`);
    } catch (err) {
      if (err.code === 'P2002') {
        // Try to delete conflicting record and retry
        try {
          await prisma.user.deleteMany({ where: { email: u.email } });
          await prisma.user.create({
            data: {
              id: u.id,
              cognitoId: u.cognito_id,
              email: u.email,
              firstName: u.first_name,
              lastName: u.last_name,
              role: u.role,
              isActive: u.is_active,
              lastLoginAt: parseDate(u.last_login_at),
              providerId: null,
              createdAt: parseDate(u.created_at) || new Date(),
              updatedAt: parseDate(u.updated_at) || new Date(),
            },
          });
          console.log(`  ✓ User: ${u.email} (replaced existing)`);
        } catch (e2) {
          console.error(`  ✗ User ${u.email}: ${e2.message}`);
        }
      } else {
        console.error(`  ✗ User ${u.email}: ${err.message}`);
      }
    }
  }

  // ── 2. Providers ──────────────────────────────────────────
  console.log('\n--- Importing providers ---');
  for (const p of data.providers) {
    try {
      await prisma.provider.upsert({
        where: { id: p.id },
        update: {},
        create: {
          id: p.id,
          npi: p.npi,
          firstName: p.first_name,
          lastName: p.last_name,
          middleName: p.middle_name || null,
          suffix: p.suffix || null,
          maidenName: p.maiden_name || null,
          dateOfBirth: parseDate(p.date_of_birth) || new Date('1990-01-01'),
          gender: p.gender || 'prefer_not_to_say',
          ssnEncrypted: p.ssn_encrypted || null,
          email: p.email,
          phone: p.phone,
          mobilePhone: p.mobile_phone || null,
          fax: p.fax || null,
          providerType: p.provider_type || 'other',
          taxonomy: p.taxonomy || null,
          specialties: p.specialties || [],
          languages: p.languages || [],
          caqhProviderId: p.caqh_provider_id || null,
          caqhStatus: p.caqh_status || null,
          caqhLastSync: parseDate(p.caqh_last_sync),
          caqhUsername: p.caqh_username || null,
          caqhPassword: p.caqh_password || null,
          caqhCredentialsValid: p.caqh_credentials_valid ?? null,
          caqhCredentialsLastChecked: parseDate(p.caqh_credentials_last_checked),
          lastDirectoryUpdateAt: parseDate(p.last_directory_update_at),
          status: p.status || 'pending',
          createdAt: parseDate(p.created_at) || new Date(),
          updatedAt: parseDate(p.updated_at) || new Date(),
          createdById: p.created_by_id || null,
          updatedById: p.updated_by_id || null,
        },
      });
      console.log(`  ✓ Provider: ${p.first_name} ${p.last_name} (NPI: ${p.npi})`);
    } catch (err) {
      if (err.code === 'P2002') {
        console.log(`  ⚠ Provider ${p.first_name} ${p.last_name} already exists, skipping`);
      } else {
        console.error(`  ✗ Provider ${p.first_name} ${p.last_name}: ${err.message}`);
      }
    }
  }

  // Now re-link users to providers (if providerId was set)
  for (const u of data.users) {
    if (u.provider_id) {
      try {
        await prisma.user.update({
          where: { id: u.id },
          data: { providerId: u.provider_id },
        });
      } catch (_) {}
    }
  }

  // ── 3. Payers ─────────────────────────────────────────────
  console.log('\n--- Importing payers ---');
  let payerCount = 0;
  let payerSkip = 0;
  const BATCH_SIZE = 100;
  const payerBatches = [];
  for (let i = 0; i < data.payers.length; i += BATCH_SIZE) {
    payerBatches.push(data.payers.slice(i, i + BATCH_SIZE));
  }

  for (const batch of payerBatches) {
    const creates = batch.map((p) => ({
      id: p.id,
      name: p.name,
      payerId: p.payer_id,
      payerType: p.payer_type || 'medical',
      addressLine1: p.address_line_1 || null,
      city: p.city || null,
      state: p.state || null,
      zipCode: p.zip_code || null,
      phone: p.phone || null,
      website: p.website || null,
      notes: p.notes || null,
      createdAt: parseDate(p.created_at) || new Date(),
      updatedAt: parseDate(p.updated_at) || new Date(),
    }));

    try {
      const result = await prisma.payer.createMany({
        data: creates,
        skipDuplicates: true,
      });
      payerCount += result.count;
    } catch (err) {
      // Fallback: insert one by one
      for (const c of creates) {
        try {
          await prisma.payer.upsert({
            where: { id: c.id },
            update: {},
            create: c,
          });
          payerCount++;
        } catch (e2) {
          payerSkip++;
        }
      }
    }
  }
  console.log(`  ✓ Payers: ${payerCount} imported, ${payerSkip} skipped`);

  // ── 4. Practice Locations ─────────────────────────────────
  console.log('\n--- Importing practice locations ---');
  for (const loc of data.practice_locations) {
    try {
      await prisma.practiceLocation.upsert({
        where: { id: loc.id },
        update: {},
        create: {
          id: loc.id,
          providerId: loc.provider_id,
          locationName: loc.location_name,
          locationType: loc.location_type || 'office',
          isPrimary: loc.is_primary ?? false,
          isActive: loc.is_active ?? true,
          addressLine1: loc.address_line_1,
          addressLine2: loc.address_line_2 || null,
          city: loc.city,
          state: loc.state,
          zipCode: loc.zip_code,
          county: loc.county || null,
          country: loc.country || 'US',
          phone: loc.phone,
          fax: loc.fax || null,
          email: loc.email || null,
          taxId: loc.tax_id || null,
          npi: loc.npi || null,
          officeHours: loc.office_hours || null,
          wheelchairAccessible: loc.wheelchair_accessible ?? false,
          publicTransitAccess: loc.public_transit_access ?? false,
          parkingAvailable: loc.parking_available ?? true,
          acceptingNewPatients: loc.accepting_new_patients ?? true,
          languagesSpoken: loc.languages_spoken || [],
          specialServices: loc.special_services || [],
          notes: loc.notes || null,
          lastDirectoryUpdateAt: parseDate(loc.last_directory_update_at),
          createdAt: parseDate(loc.created_at) || new Date(),
          updatedAt: parseDate(loc.updated_at) || new Date(),
          createdById: loc.created_by_id || null,
          updatedById: loc.updated_by_id || null,
        },
      });
      console.log(`  ✓ Location: ${loc.location_name} (${loc.city}, ${loc.state})`);
    } catch (err) {
      console.error(`  ✗ Location ${loc.location_name}: ${err.message}`);
    }
  }

  // ── 5. Payer Enrollments ──────────────────────────────────
  console.log('\n--- Importing payer enrollments ---');
  for (const e of data.payer_enrollments) {
    try {
      await prisma.payerEnrollment.upsert({
        where: { id: e.id },
        update: {},
        create: {
          id: e.id,
          providerId: e.provider_id,
          payerId: e.payer_id,
          status: e.status || 'not_started',
          productTypes: e.product_types || [],
          applicationDate: parseDate(e.application_date),
          effectiveDate: parseDate(e.effective_date),
          terminationDate: parseDate(e.termination_date),
          dateContractReceived: parseDate(e.date_contract_received),
          dateContractSigned: parseDate(e.date_contract_signed),
          lastFollowUpDate: parseDate(e.last_follow_up_date),
          recredentialingDate: parseDate(e.recredentialing_date),
          providerNumber: e.provider_number || null,
          groupNumber: e.group_number || null,
          notes: e.notes || null,
          followUpEnabled: e.follow_up_enabled ?? false,
          followUpEmail: e.follow_up_email || null,
          followUpFrequencyDays: e.follow_up_frequency_days ?? 14,
          lastFollowUpSentAt: parseDate(e.last_follow_up_sent_at),
          nextFollowUpDate: parseDate(e.next_follow_up_date),
          pdmLastAttestedAt: parseDate(e.pdm_last_attested_at),
          pdmLastAttestedBy: e.pdm_last_attested_by || null,
          pdmEnabled: e.pdm_enabled ?? true,
          createdAt: parseDate(e.created_at) || new Date(),
          updatedAt: parseDate(e.updated_at) || new Date(),
          createdById: e.created_by_id || null,
          updatedById: e.updated_by_id || null,
        },
      });
      console.log(`  ✓ Enrollment: provider=${e.provider_id.substring(0, 8)}... payer=${e.payer_id.substring(0, 8)}... (${e.status})`);
    } catch (err) {
      if (err.code === 'P2002') {
        console.log(`  ⚠ Enrollment already exists, skipping`);
      } else {
        console.error(`  ✗ Enrollment: ${err.message}`);
      }
    }
  }

  // ── 6. Documents ──────────────────────────────────────────
  console.log('\n--- Importing documents ---');
  for (const d of data.documents) {
    try {
      await prisma.document.upsert({
        where: { id: d.id },
        update: {},
        create: {
          id: d.id,
          providerId: d.provider_id,
          fileName: d.file_name,
          originalFileName: d.original_file_name,
          fileSize: d.file_size || 0,
          mimeType: d.mime_type || 'application/octet-stream',
          s3Key: d.s3_key,
          documentType: d.document_type || 'other',
          description: d.description || null,
          linkedLicenseId: d.linked_license_id || null,
          linkedBoardCertificationId: d.linked_board_certification_id || null,
          linkedMalpracticeInsuranceId: d.linked_malpractice_insurance_id || null,
          linkedEducationId: d.linked_education_id || null,
          linkedContinuingEducationId: d.linked_continuing_education_id || null,
          expirationDate: parseDate(d.expiration_date),
          ocrStatus: d.ocr_status || 'not_applicable',
          ocrData: d.ocr_data || null,
          ocrConfidence: d.ocr_confidence ?? null,
          ocrReviewedAt: parseDate(d.ocr_reviewed_at),
          ocrReviewedBy: d.ocr_reviewed_by || null,
          isVerified: d.is_verified ?? false,
          verifiedAt: parseDate(d.verified_at),
          verifiedBy: d.verified_by || null,
          createdAt: parseDate(d.created_at) || new Date(),
          updatedAt: parseDate(d.updated_at) || new Date(),
          createdById: null, // Don't link to user - may not exist
        },
      });
      console.log(`  ✓ Document: ${d.original_file_name} (${d.document_type})`);
    } catch (err) {
      console.error(`  ✗ Document ${d.original_file_name}: ${err.message}`);
    }
  }

  // ── 7. Provider Checklists ────────────────────────────────
  console.log('\n--- Importing provider checklists ---');
  for (const c of data.provider_checklists) {
    try {
      await prisma.providerChecklist.upsert({
        where: { id: c.id },
        update: {},
        create: {
          id: c.id,
          providerId: c.provider_id,
          w9Status: c.w9_status || 'not_started',
          w9DocumentId: c.w9_document_id || null,
          w9ReviewedAt: parseDate(c.w9_reviewed_at),
          w9ReviewedBy: c.w9_reviewed_by || null,
          w9Notes: c.w9_notes || null,
          coiStatus: c.coi_status || 'not_started',
          coiDocumentId: c.coi_document_id || null,
          coiReviewedAt: parseDate(c.coi_reviewed_at),
          coiReviewedBy: c.coi_reviewed_by || null,
          coiNotes: c.coi_notes || null,
          cp575Status: c.cp575_status || 'not_started',
          cp575DocumentId: c.cp575_document_id || null,
          cp575ReviewedAt: parseDate(c.cp575_reviewed_at),
          cp575ReviewedBy: c.cp575_reviewed_by || null,
          cp575Notes: c.cp575_notes || null,
          licenseVerified: c.license_verified ?? false,
          credentialsComplete: c.credentials_complete ?? false,
          backgroundCheckComplete: c.background_check_complete ?? false,
          overallComplete: c.overall_complete ?? false,
          completedAt: parseDate(c.completed_at),
          createdAt: parseDate(c.created_at) || new Date(),
          updatedAt: parseDate(c.updated_at) || new Date(),
        },
      });
      console.log(`  ✓ Checklist for provider: ${c.provider_id.substring(0, 8)}...`);
    } catch (err) {
      if (err.code === 'P2002') {
        console.log(`  ⚠ Checklist already exists, skipping`);
      } else {
        console.error(`  ✗ Checklist: ${err.message}`);
      }
    }
  }

  // ── 8. Notifications ──────────────────────────────────────
  console.log('\n--- Importing notifications ---');
  for (const n of data.notifications) {
    try {
      await prisma.notification.upsert({
        where: { id: n.id },
        update: {},
        create: {
          id: n.id,
          recipientEmail: n.recipient_email,
          type: n.type,
          subject: n.subject,
          body: n.body,
          status: n.status || 'pending',
          sentAt: parseDate(n.sent_at),
          errorMessage: n.error_message || null,
          metadata: n.metadata || null,
          createdAt: parseDate(n.created_at) || new Date(),
        },
      });
      console.log(`  ✓ Notification: ${n.subject.substring(0, 50)}...`);
    } catch (err) {
      console.error(`  ✗ Notification: ${err.message}`);
    }
  }

  // ── 9. Audit Logs ─────────────────────────────────────────
  console.log('\n--- Importing audit logs ---');
  let auditCount = 0;
  try {
    const auditData = data.audit_logs.map((a) => ({
      id: a.id,
      userId: null, // Don't link - user may not exist
      action: a.action,
      resourceType: a.resource_type || 'unknown',
      resourceId: a.resource_id || null,
      changes: a.changes || null,
      ipAddress: a.ip_address || null,
      userAgent: a.user_agent || null,
      timestamp: parseDate(a.timestamp) || new Date(),
    }));

    const result = await prisma.auditLog.createMany({
      data: auditData,
      skipDuplicates: true,
    });
    auditCount = result.count;
  } catch (err) {
    // Fallback: one by one
    for (const a of data.audit_logs) {
      try {
        await prisma.auditLog.upsert({
          where: { id: a.id },
          update: {},
          create: {
            id: a.id,
            userId: null, // Don't link - user may not exist
            action: a.action,
            resourceType: a.resource_type || 'unknown',
            resourceId: a.resource_id || null,
            changes: a.changes || null,
            ipAddress: a.ip_address || null,
            userAgent: a.user_agent || null,
            timestamp: parseDate(a.timestamp) || new Date(),
          },
        });
        auditCount++;
      } catch (_) {}
    }
  }
  console.log(`  ✓ Audit logs: ${auditCount} imported`);

  // ── Summary ───────────────────────────────────────────────
  console.log('\n=== Import Complete ===');
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.provider.count(),
    prisma.payer.count(),
    prisma.practiceLocation.count(),
    prisma.payerEnrollment.count(),
    prisma.document.count(),
    prisma.providerChecklist.count(),
    prisma.notification.count(),
    prisma.auditLog.count(),
  ]);
  const labels = ['Users', 'Providers', 'Payers', 'Locations', 'Enrollments', 'Documents', 'Checklists', 'Notifications', 'Audit Logs'];
  for (let i = 0; i < labels.length; i++) {
    console.log(`  ${labels[i]}: ${counts[i]}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Import failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
