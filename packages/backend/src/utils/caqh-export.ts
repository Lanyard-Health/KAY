import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// PII keys to redact from CAQH payloads before export. Matched case-insensitively,
// whole-key only. CAQH returns PascalCase (e.g. `SSN`, `BirthDate`) but we also
// accept camelCase in case mapper-shape data ever flows through here.
const REDACTED_KEYS = new Set([
  'ssn',
  'socialsecuritynumber',
  'birthdate',
  'dateofbirth',
  'dob',
]);

const REDACTED = '[REDACTED]';

export function scrubPii<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input.map((item) => scrubPii(item)) as unknown as T;
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        out[key] = REDACTED;
      } else {
        out[key] = scrubPii(value);
      }
    }
    return out as unknown as T;
  }
  return input;
}

type LicenseRow = {
  state: string | null;
  licenseNumber: string;
  expirationDate: Date;
};

type BoardCertRow = {
  boardName: string;
  specialty: string;
  expirationDate: Date | null;
};

export type ExportContext = {
  providerName: string;
  npi: string;
  practiceName: string | null;
  licenses: LicenseRow[];
  boardCertifications: BoardCertRow[];
  lastSyncedAt: Date;
};

function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toISOString().slice(0, 10);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(ctx: ExportContext): string {
  const licenseCell = ctx.licenses.length === 0
    ? ''
    : ctx.licenses
        .map((l) => `${l.state ?? '??'} #${l.licenseNumber} (exp ${formatDate(l.expirationDate)})`)
        .join('; ');

  const boardCell = ctx.boardCertifications.length === 0
    ? ''
    : ctx.boardCertifications
        .map((b) => `${b.boardName} — ${b.specialty} (exp ${formatDate(b.expirationDate)})`)
        .join('; ');

  const headers = ['providerName', 'npi', 'dob', 'licenses', 'boardCertifications', 'lastSync'];
  const row = [
    ctx.providerName,
    ctx.npi,
    REDACTED,
    licenseCell,
    boardCell,
    ctx.lastSyncedAt.toISOString(),
  ];

  return `${headers.join(',')}\n${row.map(csvEscape).join(',')}\n`;
}

export async function buildPdf(ctx: ExportContext): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 54;
  const pageHeight = 792;
  let y = pageHeight - 60;

  const brand = rgb(0.039, 0.239, 0.18); // #0A3D2E deep forest green
  const text = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);

  // Header
  page.drawText('CAQH Credentialing Summary', {
    x: marginX, y, size: 20, font: bold, color: brand,
  });
  y -= 24;
  page.drawText('Lanyard Health', {
    x: marginX, y, size: 10, font, color: muted,
  });
  y -= 28;

  // Provider block
  page.drawText('Provider', { x: marginX, y, size: 11, font: bold, color: text });
  y -= 16;
  page.drawText(ctx.providerName, { x: marginX, y, size: 13, font, color: text });
  y -= 16;
  page.drawText(`NPI: ${ctx.npi}`, { x: marginX, y, size: 10, font, color: muted });
  y -= 14;
  if (ctx.practiceName) {
    page.drawText(`Practice: ${ctx.practiceName}`, { x: marginX, y, size: 10, font, color: muted });
    y -= 14;
  }
  y -= 10;

  // Licenses
  page.drawText('Licenses', { x: marginX, y, size: 11, font: bold, color: text });
  y -= 16;
  if (ctx.licenses.length === 0) {
    page.drawText('None on record', { x: marginX, y, size: 10, font, color: muted });
    y -= 16;
  } else {
    for (const l of ctx.licenses) {
      const line = `${l.state ?? '??'}  ·  #${l.licenseNumber}  ·  Expires ${formatDate(l.expirationDate)}`;
      page.drawText(line, { x: marginX, y, size: 10, font, color: text });
      y -= 14;
      if (y < 120) break; // one-page contract
    }
  }
  y -= 10;

  // Board Certifications
  page.drawText('Board Certifications', { x: marginX, y, size: 11, font: bold, color: text });
  y -= 16;
  if (ctx.boardCertifications.length === 0) {
    page.drawText('None on record', { x: marginX, y, size: 10, font, color: muted });
    y -= 16;
  } else {
    for (const b of ctx.boardCertifications) {
      const line = `${b.boardName}  ·  ${b.specialty}  ·  Expires ${formatDate(b.expirationDate)}`;
      page.drawText(line, { x: marginX, y, size: 10, font, color: text });
      y -= 14;
      if (y < 80) break;
    }
  }

  // Footer
  const footerY = 50;
  page.drawText(
    `Last synced: ${ctx.lastSyncedAt.toISOString()}  ·  Generated ${new Date().toISOString().slice(0, 10)}`,
    { x: marginX, y: footerY, size: 8, font, color: muted },
  );

  return doc.save();
}

export function slugifyForFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'provider';
}
