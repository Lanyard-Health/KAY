import { prisma } from '../../utils/prisma.js';
import type { ReadinessResult } from './types.js';

interface MissingField {
  field: string;
  label: string;
  fixPath: string;
}

function check(condition: boolean, field: string, label: string, fixPath: string, missing: MissingField[]): void {
  if (!condition) missing.push({ field, label, fixPath });
}

export async function checkAetnaReadiness(providerId: string): Promise<ReadinessResult> {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    include: {
      practice: true,
      practiceLocations: { where: { isPrimary: true, isActive: true }, take: 1 },
      licenses: { where: { status: 'active' }, orderBy: { expirationDate: 'desc' }, take: 1 },
      educations: { orderBy: { graduationDate: 'desc' }, take: 1 },
      hospitalAffiliations: { where: { status: 'active' } },
    },
  });

  if (!provider) throw new Error('Provider not found');

  const basePath = `/providers/${providerId}`;
  const loc = provider.practiceLocations[0] ?? null;
  const license = provider.licenses[0] ?? null;
  const edu = provider.educations[0] ?? null;

  // Page 2: Submitter Info — submitter is the logged-in user, always available.
  // Only provider NPI is needed from our data.
  const page2Missing: MissingField[] = [];
  check(!!provider.npi, 'npi', 'Individual Type 1 NPI #', basePath, page2Missing);

  // Page 3: Network & Tax Information
  const page3Missing: MissingField[] = [];
  check(!!loc?.state, 'state', 'Applying State', `${basePath}#locations`, page3Missing);
  check(!!loc?.zipCode, 'zipCode', 'Primary Location Zip Code', `${basePath}#locations`, page3Missing);
  check(!!loc?.taxIdEncrypted, 'taxID', 'Tax ID (TIN/EIN)', `${basePath}#locations`, page3Missing);
  check(!!provider.practice?.name, 'taxIDName', 'Tax ID Name (Practice Name)', `${basePath}#practice`, page3Missing);

  // Page 4: Degree & Specialty
  const page4Missing: MissingField[] = [];
  check(!!edu?.degree, 'degreeType', 'Degree Type', `${basePath}#education`, page4Missing);
  check(provider.specialties.length > 0, 'specialty', 'Primary Specialty', basePath, page4Missing);

  // Page 5: Provider Details & Credentials
  const page5Missing: MissingField[] = [];
  check(!!provider.firstName, 'firstName', 'Provider First Name', basePath, page5Missing);
  check(!!provider.lastName, 'lastName', 'Provider Last Name', basePath, page5Missing);
  check(!!provider.dateOfBirth, 'dob', 'Date of Birth', basePath, page5Missing);
  check(!!license?.licenseNumber, 'medicalLicenseNumber', 'Medical License Number', `${basePath}#licenses`, page5Missing);
  check(!!license?.state, 'licenseState', 'License State', `${basePath}#licenses`, page5Missing);
  check(!!provider.caqhProviderId, 'caqhID', 'CAQH Provider ID', basePath, page5Missing);

  // Page 6: Contact — uses submitter info, always available
  const page6Missing: MissingField[] = [];

  // Page 7: Primary Practice Location
  const page7Missing: MissingField[] = [];
  check(!!loc, 'primaryLocation', 'Primary Practice Location', `${basePath}#locations`, page7Missing);
  if (loc) {
    check(!!loc.addressLine1, 'street', 'Street Address', `${basePath}#locations`, page7Missing);
    check(!!loc.city, 'city', 'City', `${basePath}#locations`, page7Missing);
    check(!!loc.state, 'state', 'State', `${basePath}#locations`, page7Missing);
    check(!!loc.zipCode, 'zipcode', 'Zip Code', `${basePath}#locations`, page7Missing);
    check(!!loc.county, 'county', 'County', `${basePath}#locations`, page7Missing);
    check(!!loc.phone, 'phoneNumber', 'Phone Number', `${basePath}#locations`, page7Missing);
    check(!!loc.fax, 'faxNumber', 'Fax Number', `${basePath}#locations`, page7Missing);
  }

  // Page 8: Mailing & Billing — defaults to "same as primary", no required data
  const page8Missing: MissingField[] = [];

  // Page 9: Hospital Privileges — just needs yes/no, data optional
  const page9Missing: MissingField[] = [];

  // Page 10: Additional Questions — just needs yes/no selections, all have defaults
  const page10Missing: MissingField[] = [];

  const pages = [
    { page: 2, title: 'Submitter Information', ready: page2Missing.length === 0, missing: page2Missing },
    { page: 3, title: 'Network & Tax Information', ready: page3Missing.length === 0, missing: page3Missing },
    { page: 4, title: 'Degree & Specialty', ready: page4Missing.length === 0, missing: page4Missing },
    { page: 5, title: 'Provider Details & Credentials', ready: page5Missing.length === 0, missing: page5Missing },
    { page: 6, title: 'Contact Preferences', ready: page6Missing.length === 0, missing: page6Missing },
    { page: 7, title: 'Primary Practice Location', ready: page7Missing.length === 0, missing: page7Missing },
    { page: 8, title: 'Mailing & Billing Addresses', ready: page8Missing.length === 0, missing: page8Missing },
    { page: 9, title: 'Hospital Privileges & Attachments', ready: page9Missing.length === 0, missing: page9Missing },
    { page: 10, title: 'Additional Questions & Final Review', ready: page10Missing.length === 0, missing: page10Missing },
  ];

  return {
    ready: pages.every(p => p.ready),
    pages,
  };
}
