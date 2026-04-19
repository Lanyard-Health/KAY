import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import type { ResolvedField } from './recipe-resolver.js';

/**
 * PDF Engine — pure function that fills a PDF form's AcroForm fields
 * from a resolved recipe. Takes bytes in, returns bytes out. No S3, no
 * database, no HTTP.
 *
 * Design:
 *   - Caller (pdf-fill-runner) supplies the template PDF bytes already
 *     downloaded from S3.
 *   - Caller supplies `resolvedFields` (output of resolveRecipe().fields)
 *     — this engine does NOT re-resolve anything.
 *   - Each ResolvedField's `fieldKey` must match a PDF AcroForm field
 *     name exactly. Mapping strategies (CSS selectors for browser vs.
 *     PDF field names for pdf) are decided at recipe-authoring time.
 *   - For multi-value fields (checkbox truthy, radio group, dropdown),
 *     the engine uses the resolved string value with the matching
 *     semantics documented below.
 *
 * Behavior by fieldType:
 *   - text / date / email / phone / masked / signature: setText(value)
 *   - checkbox: "true"/"1"/"yes"/"on" → check, else uncheck
 *   - radio: select(value) — value is the option name
 *   - dropdown: select(value) — value is an option name
 *
 * Returns per-field outcome so the review UI can show what was filled
 * and what was skipped. Missing PDF fields produce `missing_in_pdf`
 * warnings — the recipe has a key but the PDF doesn't contain it (e.g.
 * because the template changed and the recipe is stale).
 */

export interface PdfFillLogEntry {
  fieldKey: string;
  fieldLabel: string;
  /** What the engine actually wrote into the PDF; null if skipped. */
  writtenValue: string | null;
  outcome:
    | 'filled'
    | 'skipped_no_value' // resolver had no value (required will be flagged separately)
    | 'missing_in_pdf' // PDF doesn't have a field by this name
    | 'type_mismatch' // PDF field is e.g. checkbox but recipe said text
    | 'error';
  errorMessage?: string;
}

export interface PdfFillResult {
  filledBytes: Uint8Array;
  log: PdfFillLogEntry[];
  filledCount: number;
  skippedCount: number;
}

const CHECKBOX_TRUTHY = new Set(['true', '1', 'yes', 'on', 'checked', 'y']);

function isCheckboxTruthy(value: string): boolean {
  return CHECKBOX_TRUTHY.has(value.trim().toLowerCase());
}

/**
 * Fill a PDF template with resolved values.
 *
 * @param templateBytes  Raw bytes of the unfilled template (from S3).
 * @param resolvedFields Output of resolveRecipe().fields — already
 *                       source-resolved and transformed.
 * @param options        Optional: flatten=true bakes values into the
 *                       PDF so downstream tools can't edit the filled
 *                       form. Defaults to false (keeps fields editable
 *                       so staff can tweak in the review UI).
 */
export async function fillPdfForm(
  templateBytes: Uint8Array,
  resolvedFields: ResolvedField[],
  options: { flatten?: boolean } = {}
): Promise<PdfFillResult> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  // Build a case-sensitive map of the PDF's actual field names so we can
  // report "missing_in_pdf" precisely rather than throw on each miss.
  const pdfFieldMap = new Map(form.getFields().map((f) => [f.getName(), f]));

  const log: PdfFillLogEntry[] = [];
  let filledCount = 0;
  let skippedCount = 0;

  for (const rf of resolvedFields) {
    if (rf.value === null) {
      log.push({
        fieldKey: rf.fieldKey,
        fieldLabel: rf.fieldLabel,
        writtenValue: null,
        outcome: 'skipped_no_value',
      });
      skippedCount++;
      continue;
    }

    const pdfField = pdfFieldMap.get(rf.fieldKey);
    if (!pdfField) {
      log.push({
        fieldKey: rf.fieldKey,
        fieldLabel: rf.fieldLabel,
        writtenValue: null,
        outcome: 'missing_in_pdf',
      });
      skippedCount++;
      continue;
    }

    try {
      switch (rf.fieldType) {
        case 'checkbox': {
          if (!(pdfField instanceof PDFCheckBox)) {
            log.push({
              fieldKey: rf.fieldKey,
              fieldLabel: rf.fieldLabel,
              writtenValue: null,
              outcome: 'type_mismatch',
              errorMessage: 'Recipe says checkbox; PDF field is not a checkbox',
            });
            skippedCount++;
            continue;
          }
          if (isCheckboxTruthy(rf.value)) {
            pdfField.check();
          } else {
            pdfField.uncheck();
          }
          log.push({
            fieldKey: rf.fieldKey,
            fieldLabel: rf.fieldLabel,
            writtenValue: isCheckboxTruthy(rf.value) ? 'checked' : 'unchecked',
            outcome: 'filled',
          });
          filledCount++;
          break;
        }
        case 'radio': {
          if (!(pdfField instanceof PDFRadioGroup)) {
            log.push({
              fieldKey: rf.fieldKey,
              fieldLabel: rf.fieldLabel,
              writtenValue: null,
              outcome: 'type_mismatch',
              errorMessage: 'Recipe says radio; PDF field is not a radio group',
            });
            skippedCount++;
            continue;
          }
          pdfField.select(rf.value);
          log.push({
            fieldKey: rf.fieldKey,
            fieldLabel: rf.fieldLabel,
            writtenValue: rf.value,
            outcome: 'filled',
          });
          filledCount++;
          break;
        }
        case 'dropdown': {
          if (!(pdfField instanceof PDFDropdown)) {
            log.push({
              fieldKey: rf.fieldKey,
              fieldLabel: rf.fieldLabel,
              writtenValue: null,
              outcome: 'type_mismatch',
              errorMessage: 'Recipe says dropdown; PDF field is not a dropdown',
            });
            skippedCount++;
            continue;
          }
          pdfField.select(rf.value);
          log.push({
            fieldKey: rf.fieldKey,
            fieldLabel: rf.fieldLabel,
            writtenValue: rf.value,
            outcome: 'filled',
          });
          filledCount++;
          break;
        }
        default: {
          // text, date, email, phone, masked, signature → setText
          if (!(pdfField instanceof PDFTextField)) {
            log.push({
              fieldKey: rf.fieldKey,
              fieldLabel: rf.fieldLabel,
              writtenValue: null,
              outcome: 'type_mismatch',
              errorMessage: `Recipe says ${rf.fieldType}; PDF field is not a text field`,
            });
            skippedCount++;
            continue;
          }
          pdfField.setText(rf.value);
          log.push({
            fieldKey: rf.fieldKey,
            fieldLabel: rf.fieldLabel,
            writtenValue: rf.value,
            outcome: 'filled',
          });
          filledCount++;
        }
      }
    } catch (err: unknown) {
      log.push({
        fieldKey: rf.fieldKey,
        fieldLabel: rf.fieldLabel,
        writtenValue: null,
        outcome: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      skippedCount++;
    }
  }

  if (options.flatten) {
    form.flatten();
  }

  const filledBytes = await pdfDoc.save();
  return { filledBytes, log, filledCount, skippedCount };
}
