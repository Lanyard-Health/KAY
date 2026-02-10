import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

/**
 * Parse a CSV line respecting quoted fields.
 * Fields may contain commas, pipes, etc. inside double quotes.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

async function main() {
  const csvPath =
    process.env.CSV_PATH ||
    path.join(
      process.env.HOME || '/Users/kay',
      'Library/Mobile Documents/com~apple~CloudDocs/Lanyard Health/stedi-payers-2026-01-30.csv'
    );

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found at: ${csvPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  // Parse header to get column indices
  const header = parseCSVLine(lines[0]);
  const col = (name: string) => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`Column "${name}" not found in CSV header`);
    return idx;
  };

  const iDisplayName = col('DisplayName');
  const iPrimaryPayerId = col('PrimaryPayerId');
  const iCoverageTypes = col('CoverageTypes');
  const iOperatingStates = col('OperatingStates');
  const iWebsiteUrl = col('WebsiteUrl');

  const rows = lines.slice(1); // skip header
  console.log(`Parsed ${rows.length} payer rows from CSV`);

  const BATCH_SIZE = 50;
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const promises = batch.map((row) => {
      const fields = parseCSVLine(row);
      const displayName = fields[iDisplayName]?.trim();
      const primaryPayerId = fields[iPrimaryPayerId]?.trim();
      const coverageTypes = fields[iCoverageTypes]?.trim();
      const operatingStates = fields[iOperatingStates]?.trim();
      const websiteUrl = fields[iWebsiteUrl]?.trim();

      if (!displayName || !primaryPayerId) {
        console.warn(`Skipping row ${i}: missing name or payerId`);
        return Promise.resolve(null);
      }

      // Format payerType: "dental|medical" → "Dental, Medical"
      const payerType = coverageTypes
        ? coverageTypes
            .split('|')
            .map((t) => capitalize(t.trim()))
            .join(', ')
        : 'Other';

      return prisma.payer
        .upsert({
          where: { payerId: primaryPayerId },
          update: {
            name: displayName,
            payerType,
            state: operatingStates || null,
            website: websiteUrl || null,
          },
          create: {
            name: displayName,
            payerId: primaryPayerId,
            payerType,
            state: operatingStates || null,
            website: websiteUrl || null,
          },
        })
        .then((result) => {
          // Can't easily distinguish create vs update from upsert return,
          // but we track total processed
          return result;
        })
        .catch((err) => {
          console.error(`Error upserting payer "${primaryPayerId}":`, err.message);
          errors++;
          return null;
        });
    });

    const results = await Promise.all(promises);
    const processed = results.filter(Boolean).length;
    created += processed;

    if ((i + BATCH_SIZE) % 500 < BATCH_SIZE) {
      console.log(`Progress: ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length} rows processed`);
    }
  }

  console.log(`\nDone! Processed ${created} payers (${errors} errors)`);

  const total = await prisma.payer.count();
  console.log(`Total payers in database: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
