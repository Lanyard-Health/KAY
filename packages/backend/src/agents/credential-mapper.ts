import { logger } from '../utils/logger.js';

interface ExtractedField {
  value: string;
  confidence: number;
}

export interface MappingResult {
  mapped: Record<string, unknown>;
  unmappedFields: string[];
  fieldConfidences: Record<string, number>;
}

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

function normalizeState(value: string): string {
  if (value.length === 2) return value.toUpperCase();
  const lower = value.toLowerCase().trim();
  return STATE_NAMES[lower] ?? value;
}

function parseDate(value: string): Date | null {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseCurrency(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

type FieldMapper = (fields: Record<string, ExtractedField>) => {
  mapped: Record<string, unknown>;
  knownFields: string[];
};

const MAPPERS: Record<string, FieldMapper> = {
  license: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['licenseNumber', 'licenseType', 'state', 'issueDate', 'expirationDate', 'holderName', 'npi'];

    if (fields['licenseNumber']) mapped['licenseNumber'] = fields['licenseNumber'].value;
    if (fields['state']) mapped['state'] = normalizeState(fields['state'].value);
    if (fields['issueDate']) {
      const d = parseDate(fields['issueDate'].value);
      if (d) mapped['issueDate'] = d;
    }
    if (fields['expirationDate']) {
      const d = parseDate(fields['expirationDate'].value);
      if (d) mapped['expirationDate'] = d;
    }
    if (fields['licenseType']) mapped['licenseType'] = fields['licenseType'].value;
    if (fields['npi']) mapped['npi'] = fields['npi'].value;

    return { mapped, knownFields };
  },

  board_certification: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['certificationNumber', 'boardName', 'specialty', 'initialCertificationDate', 'expirationDate', 'holderName'];

    if (fields['certificationNumber']) mapped['certificationNumber'] = fields['certificationNumber'].value;
    if (fields['boardName']) mapped['boardName'] = fields['boardName'].value;
    if (fields['specialty']) mapped['specialty'] = fields['specialty'].value;
    if (fields['initialCertificationDate']) {
      const d = parseDate(fields['initialCertificationDate'].value);
      if (d) mapped['initialCertificationDate'] = d;
    }
    if (fields['expirationDate']) {
      const d = parseDate(fields['expirationDate'].value);
      if (d) mapped['expirationDate'] = d;
    }

    return { mapped, knownFields };
  },

  malpractice_certificate: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['carrierName', 'policyNumber', 'coverageType', 'perClaimAmount', 'aggregateAmount', 'effectiveDate', 'expirationDate', 'holderName'];

    if (fields['carrierName']) mapped['carrierName'] = fields['carrierName'].value;
    if (fields['policyNumber']) mapped['policyNumber'] = fields['policyNumber'].value;
    if (fields['coverageType']) mapped['coverageType'] = fields['coverageType'].value;
    if (fields['perClaimAmount']) {
      const n = parseCurrency(fields['perClaimAmount'].value);
      if (n !== null) mapped['perClaimAmount'] = n;
    }
    if (fields['aggregateAmount']) {
      const n = parseCurrency(fields['aggregateAmount'].value);
      if (n !== null) mapped['aggregateAmount'] = n;
    }
    if (fields['effectiveDate']) {
      const d = parseDate(fields['effectiveDate'].value);
      if (d) mapped['effectiveDate'] = d;
    }
    if (fields['expirationDate']) {
      const d = parseDate(fields['expirationDate'].value);
      if (d) mapped['expirationDate'] = d;
    }

    return { mapped, knownFields };
  },

  dea_certificate: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['deaNumber', 'schedules', 'state', 'issueDate', 'expirationDate', 'holderName'];

    if (fields['deaNumber']) mapped['licenseNumber'] = fields['deaNumber'].value;
    if (fields['state']) mapped['state'] = normalizeState(fields['state'].value);
    if (fields['issueDate']) {
      const d = parseDate(fields['issueDate'].value);
      if (d) mapped['issueDate'] = d;
    }
    if (fields['expirationDate']) {
      const d = parseDate(fields['expirationDate'].value);
      if (d) mapped['expirationDate'] = d;
    }

    return { mapped, knownFields };
  },

  diploma: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['institutionName', 'degree', 'fieldOfStudy', 'graduationDate', 'holderName'];

    if (fields['institutionName']) mapped['institutionName'] = fields['institutionName'].value;
    if (fields['degree']) mapped['degree'] = fields['degree'].value;
    if (fields['fieldOfStudy']) mapped['fieldOfStudy'] = fields['fieldOfStudy'].value;
    if (fields['graduationDate']) {
      const d = parseDate(fields['graduationDate'].value);
      if (d) mapped['graduationDate'] = d;
    }

    return { mapped, knownFields };
  },

  cme_certificate: (fields) => {
    const mapped: Record<string, unknown> = {};
    const knownFields = ['courseName', 'courseProvider', 'credits', 'creditType', 'completionDate', 'holderName'];

    if (fields['courseName']) mapped['courseName'] = fields['courseName'].value;
    if (fields['courseProvider']) mapped['courseProvider'] = fields['courseProvider'].value;
    if (fields['credits']) {
      const n = parseFloat(fields['credits'].value);
      if (!isNaN(n)) mapped['credits'] = n;
    }
    if (fields['creditType']) mapped['creditType'] = fields['creditType'].value;
    if (fields['completionDate']) {
      const d = parseDate(fields['completionDate'].value);
      if (d) mapped['completionDate'] = d;
    }

    return { mapped, knownFields };
  },
};

/**
 * Maps extracted fields to the internal Prisma credential schema for a given document type.
 * Returns the mapped data, a list of unmapped fields, and per-field confidence scores.
 */
export function mapToCredential(
  documentType: string,
  fields: Record<string, ExtractedField>
): MappingResult {
  const mapper = MAPPERS[documentType];
  const fieldConfidences: Record<string, number> = {};

  for (const [key, field] of Object.entries(fields)) {
    fieldConfidences[key] = field.confidence;
  }

  if (!mapper) {
    logger.warn(`No credential mapper for document type: ${documentType}`);
    return {
      mapped: {},
      unmappedFields: Object.keys(fields),
      fieldConfidences,
    };
  }

  const { mapped, knownFields } = mapper(fields);
  const unmappedFields = Object.keys(fields).filter((k) => !knownFields.includes(k));

  if (unmappedFields.length > 0) {
    logger.info(`Unmapped fields for ${documentType}: ${unmappedFields.join(', ')}`);
  }

  return { mapped, unmappedFields, fieldConfidences };
}
