/**
 * Dump the AcroForm field list from a PDF so we can author a recipe
 * against real field names.
 *
 * Usage: tsx scripts/inspect-pdf-fields.ts <path-to-pdf>
 */

import fs from 'node:fs/promises';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown } from 'pdf-lib';

const typeOf = (f: unknown): string => {
  if (f instanceof PDFTextField) return 'text';
  if (f instanceof PDFCheckBox) return 'checkbox';
  if (f instanceof PDFRadioGroup) return 'radio';
  if (f instanceof PDFDropdown) return 'dropdown';
  return 'unknown';
};

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: tsx scripts/inspect-pdf-fields.ts <pdf>');
    process.exit(1);
  }
  const bytes = await fs.readFile(path);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const fields = form.getFields();

  console.log(`\n${fields.length} AcroForm field(s) in ${path}:\n`);
  for (const f of fields) {
    const t = typeOf(f);
    const label = `  ${t.padEnd(9)}  ${f.getName()}`;
    if (f instanceof PDFRadioGroup) {
      console.log(`${label}  options=[${f.getOptions().join(', ')}]`);
    } else if (f instanceof PDFDropdown) {
      console.log(`${label}  options=[${f.getOptions().join(', ')}]`);
    } else {
      console.log(label);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
