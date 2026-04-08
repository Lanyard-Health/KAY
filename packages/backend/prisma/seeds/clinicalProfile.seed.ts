/**
 * Clinical Profile Seed Script
 *
 * Reads lanyard_clinical_profile_schema_v2.xlsx and populates 9 reference tables:
 *   1. OrganizationType (5 rows)
 *   2. Specialty (245 unique by name+section)
 *   3. SubSpecialty (642 rows)
 *   4. ServiceCategory (20 rows across 3 domains)
 *   5. ServiceOffering (52 rows)
 *   6. PatientAgeGroup (8 rows)
 *   7. PatientGenderIdentity (6 rows)
 *   8. PatientSexualOrientation (8 rows)
 *   9. SpecialPopulation (11 rows)
 *
 * Usage:
 *   npx tsx prisma/seeds/clinicalProfile.seed.ts              # seed all tables
 *   npx tsx prisma/seeds/clinicalProfile.seed.ts --dry-run    # parse only, no DB writes
 *
 * Idempotent — safe to run multiple times without creating duplicates.
 * Uses upsert on unique keys for every table.
 */

import { PrismaClient, TaxonomySection, ServiceDomain } from '@prisma/client';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

// Check for spreadsheet in multiple locations:
// 1. Bundled in repo (for Render/CI)
// 2. Local iCloud path (for dev)
const BUNDLED_PATH = path.resolve(import.meta.dirname, '../../data/lanyard_clinical_profile_schema_v2.xlsx');
const LOCAL_PATH = '/Users/kay/Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/lanyard_clinical_profile_schema_v2.xlsx';
const SPREADSHEET_PATH = fs.existsSync(BUNDLED_PATH) ? BUNDLED_PATH : path.resolve(LOCAL_PATH);

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Helpers ────────────────────────────────────────────────────────────────

function toSlug(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseAgeRange(range: string): { start: number; end: number | null } {
  const plusMatch = range.match(/(\d+)\+/);
  if (plusMatch) return { start: parseInt(plusMatch[1]), end: null };
  const rangeMatch = range.match(/(\d+)-(\d+)/);
  if (rangeMatch) return { start: parseInt(rangeMatch[1]), end: parseInt(rangeMatch[2]) };
  return { start: 0, end: null };
}

function cleanCell(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
}

// ─── Seeders ────────────────────────────────────────────────────────────────

async function seedOrganizationTypes(wb: XLSX.WorkBook): Promise<number> {
  const sheet = wb.Sheets['Organization Types'];
  if (!sheet) throw new Error('Sheet "Organization Types" not found');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  let count = 0;
  for (const row of rows) {
    const name = cleanCell(row['Organization Type']);
    const description = cleanCell(row['Description']) ?? '';
    if (!name) continue;

    if (!DRY_RUN) {
      await prisma.organizationType.upsert({
        where: { name },
        update: { description, slug: toSlug(name) },
        create: { name, slug: toSlug(name), description },
      });
    }
    count++;
  }
  return count;
}

async function seedSpecialties(wb: XLSX.WorkBook): Promise<Map<string, string>> {
  const sheet = wb.Sheets['Specialties & Sub Specialties'];
  if (!sheet) throw new Error('Sheet "Specialties & Sub Specialties" not found');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  // Deduplicate by (name, section)
  const seen = new Set<string>();
  const uniqueSpecialties: { name: string; section: TaxonomySection }[] = [];

  for (const row of rows) {
    const name = cleanCell(row['Specialty']);
    const sectionRaw = cleanCell(row['Section']);
    if (!name || !sectionRaw) continue;

    const section: TaxonomySection = sectionRaw === 'Individual'
      ? TaxonomySection.INDIVIDUAL
      : TaxonomySection.NON_INDIVIDUAL;

    const key = `${name}|${section}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueSpecialties.push({ name, section });
    }
  }

  const specialtyMap = new Map<string, string>();

  for (const { name, section } of uniqueSpecialties) {
    if (!DRY_RUN) {
      const record = await prisma.specialty.upsert({
        where: { name_taxonomySection: { name, taxonomySection: section } },
        update: {},
        create: { name, taxonomySection: section },
      });
      specialtyMap.set(`${name}|${section}`, record.id);
    } else {
      specialtyMap.set(`${name}|${section}`, `dry-run-${name}-${section}`);
    }
  }

  console.log(`  Specialties: ${uniqueSpecialties.length} unique (name, section) pairs`);
  return specialtyMap;
}

async function seedSubSpecialties(
  wb: XLSX.WorkBook,
  specialtyMap: Map<string, string>,
): Promise<number> {
  const sheet = wb.Sheets['Specialties & Sub Specialties'];
  if (!sheet) throw new Error('Sheet "Specialties & Sub Specialties" not found');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  let count = 0;
  for (const row of rows) {
    const subName = cleanCell(row['Sub Specialty']);
    if (!subName) continue;

    const specialtyName = cleanCell(row['Specialty']);
    const sectionRaw = cleanCell(row['Section']);
    if (!specialtyName || !sectionRaw) continue;

    const section: TaxonomySection = sectionRaw === 'Individual'
      ? TaxonomySection.INDIVIDUAL
      : TaxonomySection.NON_INDIVIDUAL;

    const specialtyId = specialtyMap.get(`${specialtyName}|${section}`);
    if (!specialtyId) {
      console.warn(`  WARNING: No specialty found for "${specialtyName}|${section}" — skipping sub-specialty "${subName}"`);
      continue;
    }

    if (!DRY_RUN) {
      await prisma.subSpecialty.upsert({
        where: { name_specialtyId: { name: subName, specialtyId } },
        update: {},
        create: { name: subName, specialtyId },
      });
    }
    count++;
  }
  return count;
}

type ServiceTab = {
  sheetName: string;
  domain: ServiceDomain;
};

const SERVICE_TABS: ServiceTab[] = [
  { sheetName: 'Services - Behavioral Health', domain: ServiceDomain.BEHAVIORAL_HEALTH },
  { sheetName: 'Services - Womens Health', domain: ServiceDomain.WOMENS_HEALTH },
  { sheetName: 'Services - Primary Care', domain: ServiceDomain.PRIMARY_CARE },
];

async function seedServiceCategories(wb: XLSX.WorkBook): Promise<Map<string, string>> {
  const categoryMap = new Map<string, string>();
  let totalCount = 0;

  for (const { sheetName, domain } of SERVICE_TABS) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    const seen = new Set<string>();
    for (const row of rows) {
      const categoryName = cleanCell(row['Service Category']);
      if (!categoryName) continue;

      const key = `${categoryName}|${domain}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!DRY_RUN) {
        const record = await prisma.serviceCategory.upsert({
          where: { name_domain: { name: categoryName, domain } },
          update: { slug: toSlug(categoryName) },
          create: { name: categoryName, slug: toSlug(categoryName), domain },
        });
        categoryMap.set(key, record.id);
      } else {
        categoryMap.set(key, `dry-run-${key}`);
      }
      totalCount++;
    }
  }

  console.log(`  Service categories: ${totalCount} unique (name, domain) pairs`);
  return categoryMap;
}

async function seedServiceOfferings(
  wb: XLSX.WorkBook,
  categoryMap: Map<string, string>,
): Promise<number> {
  let totalCount = 0;

  for (const { sheetName, domain } of SERVICE_TABS) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    for (const row of rows) {
      const name = cleanCell(row['Service Name']);
      const categoryName = cleanCell(row['Service Category']);
      if (!name || !categoryName) continue;

      const categoryKey = `${categoryName}|${domain}`;
      const serviceCategoryId = categoryMap.get(categoryKey);
      if (!serviceCategoryId) {
        console.warn(`  WARNING: No category found for "${categoryKey}" — skipping service "${name}"`);
        continue;
      }

      const description = cleanCell(row['Description']) ?? null;
      const cptRaw = cleanCell(row['Common CPT Codes']);
      const cptCodes = cptRaw ? cptRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

      if (!DRY_RUN) {
        await prisma.serviceOffering.upsert({
          where: { name_serviceCategoryId: { name, serviceCategoryId } },
          update: { slug: toSlug(name), description, cptCodes },
          create: { name, slug: toSlug(name), description, cptCodes, serviceCategoryId },
        });
      }
      totalCount++;
    }
  }
  return totalCount;
}

async function seedPatientAgeGroups(wb: XLSX.WorkBook): Promise<number> {
  const sheet = wb.Sheets['Patient Age Groups'];
  if (!sheet) throw new Error('Sheet "Patient Age Groups" not found');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  let count = 0;
  for (const row of rows) {
    const name = cleanCell(row['Value']);
    const ageRangeRaw = cleanCell(row['Age Range']);
    if (!name || !ageRangeRaw) continue;

    const { start, end } = parseAgeRange(ageRangeRaw);

    if (!DRY_RUN) {
      await prisma.patientAgeGroup.upsert({
        where: { name },
        update: { slug: toSlug(name), ageRangeStart: start, ageRangeEnd: end },
        create: { name, slug: toSlug(name), ageRangeStart: start, ageRangeEnd: end },
      });
    }
    count++;
  }
  return count;
}

async function seedPatientGenderIdentities(wb: XLSX.WorkBook): Promise<number> {
  const sheet = wb.Sheets['Patient Gender Identities'];
  if (!sheet) throw new Error('Sheet "Patient Gender Identities" not found');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  let count = 0;
  for (const row of rows) {
    const name = cleanCell(row['Value']);
    if (!name) continue;

    const isConvenienceToggle = name === 'All Gender Identities';

    if (!DRY_RUN) {
      await prisma.patientGenderIdentity.upsert({
        where: { name },
        update: { slug: toSlug(name), isConvenienceToggle },
        create: { name, slug: toSlug(name), isConvenienceToggle },
      });
    }
    count++;
  }
  return count;
}

async function seedPatientSexualOrientations(wb: XLSX.WorkBook): Promise<number> {
  const sheet = wb.Sheets['Patient Sexual Orientation'];
  if (!sheet) throw new Error('Sheet "Patient Sexual Orientation" not found');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  let count = 0;
  for (const row of rows) {
    const name = cleanCell(row['Value']);
    if (!name) continue;

    const isConvenienceToggle = name === 'All Sexual Orientations';

    if (!DRY_RUN) {
      await prisma.patientSexualOrientation.upsert({
        where: { name },
        update: { slug: toSlug(name), isConvenienceToggle },
        create: { name, slug: toSlug(name), isConvenienceToggle },
      });
    }
    count++;
  }
  return count;
}

async function seedSpecialPopulations(wb: XLSX.WorkBook): Promise<number> {
  const sheet = wb.Sheets['Special Patient Populations'];
  if (!sheet) throw new Error('Sheet "Special Patient Populations" not found');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  let count = 0;
  for (const row of rows) {
    const name = cleanCell(row['Value']);
    if (!name) continue;

    if (!DRY_RUN) {
      await prisma.specialPopulation.upsert({
        where: { name },
        update: { slug: toSlug(name) },
        create: { name, slug: toSlug(name) },
      });
    }
    count++;
  }
  return count;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nClinical Profile Seed Script`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'LIVE'}`);
  console.log(`Spreadsheet: ${SPREADSHEET_PATH}\n`);

  if (!fs.existsSync(SPREADSHEET_PATH)) {
    throw new Error(`Spreadsheet not found at ${SPREADSHEET_PATH}`);
  }

  const wb = XLSX.readFile(SPREADSHEET_PATH);
  console.log(`Sheets found: ${wb.SheetNames.join(', ')}\n`);

  // 1. Organization Types
  console.log('Seeding Organization Types...');
  const orgTypeCount = await seedOrganizationTypes(wb);

  // 2. Specialties
  console.log('Seeding Specialties...');
  const specialtyMap = await seedSpecialties(wb);

  // 3. Sub-Specialties
  console.log('Seeding Sub-Specialties...');
  const subSpecialtyCount = await seedSubSpecialties(wb, specialtyMap);

  // 4. Service Categories
  console.log('Seeding Service Categories...');
  const categoryMap = await seedServiceCategories(wb);

  // 5. Service Offerings
  console.log('Seeding Service Offerings...');
  const serviceOfferingCount = await seedServiceOfferings(wb, categoryMap);

  // 6. Patient Age Groups
  console.log('Seeding Patient Age Groups...');
  const ageGroupCount = await seedPatientAgeGroups(wb);

  // 7. Patient Gender Identities
  console.log('Seeding Patient Gender Identities...');
  const genderIdentityCount = await seedPatientGenderIdentities(wb);

  // 8. Patient Sexual Orientations
  console.log('Seeding Patient Sexual Orientations...');
  const sexualOrientationCount = await seedPatientSexualOrientations(wb);

  // 9. Special Populations
  console.log('Seeding Special Populations...');
  const specialPopulationCount = await seedSpecialPopulations(wb);

  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('  SEED SUMMARY');
  console.log('═'.repeat(50));
  console.log(`  Organization Types:        ${orgTypeCount}`);
  console.log(`  Specialties:               ${specialtyMap.size}`);
  console.log(`  Sub-Specialties:           ${subSpecialtyCount}`);
  console.log(`  Service Categories:        ${categoryMap.size}`);
  console.log(`  Service Offerings:         ${serviceOfferingCount}`);
  console.log(`  Patient Age Groups:        ${ageGroupCount}`);
  console.log(`  Patient Gender Identities: ${genderIdentityCount}`);
  console.log(`  Patient Sexual Orient.:    ${sexualOrientationCount}`);
  console.log(`  Special Populations:       ${specialPopulationCount}`);
  console.log('═'.repeat(50));
  console.log(DRY_RUN ? '  (Dry run — no data written)\n' : '  Done!\n');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
