import { PrismaClient } from '@prisma/client';
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';

const prisma = new PrismaClient();

interface PayerRow {
  StediId: string;
  PrimaryPayerId: string;
  DisplayName: string;
  Names: string;
  CoverageTypes: string;
  OperatingStates: string;
  WebsiteUrl: string;
}

async function importPayers() {
  const csvPath = process.argv[2];

  if (!csvPath) {
    console.error('Usage: npx tsx scripts/import-payers.ts <csv-file-path>');
    process.exit(1);
  }

  console.log(`Importing payers from: ${csvPath}`);

  const records: PayerRow[] = [];

  const parser = createReadStream(csvPath).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    })
  );

  for await (const record of parser) {
    records.push(record as PayerRow);
  }

  console.log(`Found ${records.length} payers to import`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of records) {
    try {
      // Skip if no display name
      if (!row.DisplayName?.trim()) {
        skipped++;
        continue;
      }

      // Check if payer already exists
      const existing = await prisma.payer.findFirst({
        where: {
          OR: [
            { payerId: row.StediId },
            { name: { equals: row.DisplayName, mode: 'insensitive' } },
          ],
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Determine payer type from coverage types
      let payerType = 'insurance';
      if (row.CoverageTypes) {
        const types = row.CoverageTypes.toLowerCase();
        if (types.includes('medical') && types.includes('dental')) {
          payerType = 'medical_dental';
        } else if (types.includes('dental')) {
          payerType = 'dental';
        } else if (types.includes('vision')) {
          payerType = 'vision';
        } else if (types.includes('medical')) {
          payerType = 'medical';
        }
      }

      await prisma.payer.create({
        data: {
          payerId: row.StediId,
          name: row.DisplayName,
          payerType,
          state: row.OperatingStates?.split('|')[0] || null,
          website: row.WebsiteUrl || null,
          notes: row.Names ? `Also known as: ${row.Names}` : null,
          // Provenance tag: enables a clean rollback of this bulk import
          // without touching seeded or hand-created payers.
          verticalTags: ['stedi-import'],
        },
      });

      imported++;

      if (imported % 100 === 0) {
        console.log(`Imported ${imported} payers...`);
      }
    } catch (error) {
      errors++;
      console.error(`Error importing ${row.DisplayName}: ${error}`);
    }
  }

  console.log(`\nImport complete:`);
  console.log(`  - Imported: ${imported}`);
  console.log(`  - Skipped (duplicates or empty): ${skipped}`);
  console.log(`  - Errors: ${errors}`);

  await prisma.$disconnect();
}

importPayers().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
