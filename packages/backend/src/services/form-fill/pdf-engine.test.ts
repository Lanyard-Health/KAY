import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { fillPdfForm } from './pdf-engine.js';
import type { ResolvedField } from './recipe-resolver.js';

// Build a fixture template PDF once: a single page with one of every
// form-field type we support. Tests fill it with known values and read
// back to verify.

async function buildFixturePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 600]);
  const form = pdf.getForm();

  const name = form.createTextField('provider_name');
  name.addToPage(page, { x: 20, y: 540, width: 200, height: 20 });

  const npi = form.createTextField('provider_npi');
  npi.addToPage(page, { x: 20, y: 510, width: 200, height: 20 });

  const consent = form.createCheckBox('consent');
  consent.addToPage(page, { x: 20, y: 480, width: 15, height: 15 });

  const gender = form.createRadioGroup('gender');
  gender.addOptionToPage('male', page, { x: 20, y: 450, width: 15, height: 15 });
  gender.addOptionToPage('female', page, { x: 50, y: 450, width: 15, height: 15 });
  gender.addOptionToPage('other', page, { x: 80, y: 450, width: 15, height: 15 });

  const state = form.createDropdown('state');
  state.setOptions(['OH', 'PA', 'MD', 'NY']);
  state.addToPage(page, { x: 20, y: 420, width: 100, height: 20 });

  return pdf.save();
}

async function readFilledPdf(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  return {
    name: form.getTextField('provider_name').getText(),
    npi: form.getTextField('provider_npi').getText(),
    consent: form.getCheckBox('consent').isChecked(),
    gender: form.getRadioGroup('gender').getSelected(),
    state: form.getDropdown('state').getSelected()[0],
  };
}

function rf(partial: Partial<ResolvedField> & { fieldKey: string; value: string | null }): ResolvedField {
  return {
    fieldLabel: partial.fieldKey,
    fieldType: 'text',
    fromFallback: false,
    missing: false,
    validationError: null,
    ...partial,
  } as ResolvedField;
}

describe('fillPdfForm', () => {
  let template: Uint8Array;

  beforeAll(async () => {
    template = await buildFixturePdf();
  });

  it('fills a simple text field', async () => {
    const result = await fillPdfForm(template, [
      rf({ fieldKey: 'provider_name', fieldType: 'text', value: 'Dr. Pat O\'Brien' }),
    ]);
    const read = await readFilledPdf(result.filledBytes);
    expect(read.name).toBe('Dr. Pat O\'Brien');
    expect(result.filledCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.log[0]?.outcome).toBe('filled');
  });

  it('fills multiple fields in one pass', async () => {
    const result = await fillPdfForm(template, [
      rf({ fieldKey: 'provider_name', value: 'Pat' }),
      rf({ fieldKey: 'provider_npi', value: '1234567893' }),
    ]);
    const read = await readFilledPdf(result.filledBytes);
    expect(read.name).toBe('Pat');
    expect(read.npi).toBe('1234567893');
    expect(result.filledCount).toBe(2);
  });

  it('checks and unchecks a checkbox based on truthy strings', async () => {
    const checked = await fillPdfForm(template, [
      rf({ fieldKey: 'consent', fieldType: 'checkbox', value: 'true' }),
    ]);
    expect((await readFilledPdf(checked.filledBytes)).consent).toBe(true);

    const unchecked = await fillPdfForm(template, [
      rf({ fieldKey: 'consent', fieldType: 'checkbox', value: 'false' }),
    ]);
    expect((await readFilledPdf(unchecked.filledBytes)).consent).toBe(false);

    // Accepts several truthy spellings
    for (const truthy of ['yes', '1', 'on', 'CHECKED', 'Y']) {
      const r = await fillPdfForm(template, [
        rf({ fieldKey: 'consent', fieldType: 'checkbox', value: truthy }),
      ]);
      expect((await readFilledPdf(r.filledBytes)).consent).toBe(true);
    }
  });

  it('selects a radio option', async () => {
    const result = await fillPdfForm(template, [
      rf({ fieldKey: 'gender', fieldType: 'radio', value: 'female' }),
    ]);
    expect((await readFilledPdf(result.filledBytes)).gender).toBe('female');
  });

  it('selects a dropdown option', async () => {
    const result = await fillPdfForm(template, [
      rf({ fieldKey: 'state', fieldType: 'dropdown', value: 'OH' }),
    ]);
    expect((await readFilledPdf(result.filledBytes)).state).toBe('OH');
  });

  it('skips fields with null value and records in log', async () => {
    const result = await fillPdfForm(template, [
      rf({ fieldKey: 'provider_name', value: null }),
      rf({ fieldKey: 'provider_npi', value: '999' }),
    ]);
    expect(result.filledCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    const skip = result.log.find((l) => l.fieldKey === 'provider_name');
    expect(skip?.outcome).toBe('skipped_no_value');
  });

  it('reports missing_in_pdf when recipe has a field the PDF does not', async () => {
    const result = await fillPdfForm(template, [
      rf({ fieldKey: 'does_not_exist', value: 'x' }),
    ]);
    expect(result.filledCount).toBe(0);
    expect(result.log[0]?.outcome).toBe('missing_in_pdf');
  });

  it('reports type_mismatch when recipe type does not match PDF field type', async () => {
    // provider_name is a text field; recipe claims it's a checkbox
    const result = await fillPdfForm(template, [
      rf({ fieldKey: 'provider_name', fieldType: 'checkbox', value: 'true' }),
    ]);
    expect(result.filledCount).toBe(0);
    expect(result.log[0]?.outcome).toBe('type_mismatch');
  });

  it('flatten=true prevents further edits to filled fields', async () => {
    const flattened = await fillPdfForm(
      template,
      [rf({ fieldKey: 'provider_name', value: 'Locked Name' })],
      { flatten: true }
    );
    const pdf = await PDFDocument.load(flattened.filledBytes);
    const form = pdf.getForm();
    // After flatten, the form should have no AcroForm fields remaining
    expect(form.getFields()).toHaveLength(0);
  });

  it('keeps the PDF editable by default (no flatten)', async () => {
    const result = await fillPdfForm(template, [
      rf({ fieldKey: 'provider_name', value: 'Editable' }),
    ]);
    const pdf = await PDFDocument.load(result.filledBytes);
    const form = pdf.getForm();
    expect(form.getFields().length).toBeGreaterThan(0);
  });

  it('continues past a field-level error without aborting the run', async () => {
    // radio with an option that does not exist — pdf-lib throws
    const result = await fillPdfForm(template, [
      rf({ fieldKey: 'provider_name', value: 'ok' }),
      rf({ fieldKey: 'gender', fieldType: 'radio', value: 'unknown_option' }),
      rf({ fieldKey: 'provider_npi', value: '1234567893' }),
    ]);
    // First and third succeed; middle is logged as error
    expect(result.filledCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    const errLog = result.log.find((l) => l.fieldKey === 'gender');
    expect(errLog?.outcome).toBe('error');
  });
});
