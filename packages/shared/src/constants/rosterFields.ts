export interface RosterField {
  key: string;
  label: string;
  category: string;
  dataType: 'string' | 'date' | 'boolean' | 'number' | 'enum' | 'array';
  prismaPath: string; // dot-notation path, e.g. "provider.firstName" or "licenses.licenseNumber"
}

export const ROSTER_CATEGORIES = [
  'Provider Info',
  'Contact',
  'Address',
  'License',
  'Board Certification',
  'Malpractice',
  'Education',
  'Work History',
  'Hospital Affiliation',
  'Payer Enrollment',
  'Practice Location',
  'Professional Reference',
  'Disciplinary Action',
  'Continuing Education',
] as const;

export type RosterCategory = (typeof ROSTER_CATEGORIES)[number];

export const ROSTER_FIELDS: RosterField[] = [
  // ==========================================
  // Provider Info
  // ==========================================
  { key: 'provider.firstName', label: 'First Name', category: 'Provider Info', dataType: 'string', prismaPath: 'firstName' },
  { key: 'provider.lastName', label: 'Last Name', category: 'Provider Info', dataType: 'string', prismaPath: 'lastName' },
  { key: 'provider.middleName', label: 'Middle Name', category: 'Provider Info', dataType: 'string', prismaPath: 'middleName' },
  { key: 'provider.suffix', label: 'Suffix', category: 'Provider Info', dataType: 'string', prismaPath: 'suffix' },
  { key: 'provider.maidenName', label: 'Maiden Name', category: 'Provider Info', dataType: 'string', prismaPath: 'maidenName' },
  { key: 'provider.npi', label: 'NPI', category: 'Provider Info', dataType: 'string', prismaPath: 'npi' },
  { key: 'provider.dateOfBirth', label: 'Date of Birth', category: 'Provider Info', dataType: 'date', prismaPath: 'dateOfBirth' },
  { key: 'provider.gender', label: 'Gender', category: 'Provider Info', dataType: 'enum', prismaPath: 'gender' },
  { key: 'provider.providerType', label: 'Provider Type', category: 'Provider Info', dataType: 'enum', prismaPath: 'providerType' },
  { key: 'provider.taxonomy', label: 'Taxonomy', category: 'Provider Info', dataType: 'string', prismaPath: 'taxonomy' },
  { key: 'provider.specialties', label: 'Specialties', category: 'Provider Info', dataType: 'array', prismaPath: 'specialties' },
  { key: 'provider.languages', label: 'Languages', category: 'Provider Info', dataType: 'array', prismaPath: 'languages' },
  { key: 'provider.status', label: 'Status', category: 'Provider Info', dataType: 'enum', prismaPath: 'status' },
  { key: 'provider.caqhProviderId', label: 'CAQH Provider ID', category: 'Provider Info', dataType: 'string', prismaPath: 'caqhProviderId' },
  { key: 'provider.caqhStatus', label: 'CAQH Status', category: 'Provider Info', dataType: 'enum', prismaPath: 'caqhStatus' },

  // ==========================================
  // Contact
  // ==========================================
  { key: 'provider.email', label: 'Email', category: 'Contact', dataType: 'string', prismaPath: 'email' },
  { key: 'provider.phone', label: 'Phone', category: 'Contact', dataType: 'string', prismaPath: 'phone' },
  { key: 'provider.mobilePhone', label: 'Mobile Phone', category: 'Contact', dataType: 'string', prismaPath: 'mobilePhone' },
  { key: 'provider.fax', label: 'Fax', category: 'Contact', dataType: 'string', prismaPath: 'fax' },

  // ==========================================
  // Address
  // ==========================================
  { key: 'addresses.type', label: 'Address Type', category: 'Address', dataType: 'enum', prismaPath: 'addresses.type' },
  { key: 'addresses.addressLine1', label: 'Address Line 1', category: 'Address', dataType: 'string', prismaPath: 'addresses.addressLine1' },
  { key: 'addresses.addressLine2', label: 'Address Line 2', category: 'Address', dataType: 'string', prismaPath: 'addresses.addressLine2' },
  { key: 'addresses.city', label: 'Address City', category: 'Address', dataType: 'string', prismaPath: 'addresses.city' },
  { key: 'addresses.state', label: 'Address State', category: 'Address', dataType: 'string', prismaPath: 'addresses.state' },
  { key: 'addresses.zipCode', label: 'Address Zip Code', category: 'Address', dataType: 'string', prismaPath: 'addresses.zipCode' },
  { key: 'addresses.country', label: 'Address Country', category: 'Address', dataType: 'string', prismaPath: 'addresses.country' },
  { key: 'addresses.isPrimary', label: 'Address Is Primary', category: 'Address', dataType: 'boolean', prismaPath: 'addresses.isPrimary' },

  // ==========================================
  // License
  // ==========================================
  { key: 'licenses.licenseType', label: 'License Type', category: 'License', dataType: 'enum', prismaPath: 'licenses.licenseType' },
  { key: 'licenses.licenseNumber', label: 'License Number', category: 'License', dataType: 'string', prismaPath: 'licenses.licenseNumber' },
  { key: 'licenses.state', label: 'License State', category: 'License', dataType: 'string', prismaPath: 'licenses.state' },
  { key: 'licenses.issueDate', label: 'License Issue Date', category: 'License', dataType: 'date', prismaPath: 'licenses.issueDate' },
  { key: 'licenses.expirationDate', label: 'License Expiration Date', category: 'License', dataType: 'date', prismaPath: 'licenses.expirationDate' },
  { key: 'licenses.status', label: 'License Status', category: 'License', dataType: 'enum', prismaPath: 'licenses.status' },
  { key: 'licenses.verificationDate', label: 'License Verification Date', category: 'License', dataType: 'date', prismaPath: 'licenses.verificationDate' },
  { key: 'licenses.verificationSource', label: 'License Verification Source', category: 'License', dataType: 'string', prismaPath: 'licenses.verificationSource' },

  // ==========================================
  // Board Certification
  // ==========================================
  { key: 'boardCertifications.boardType', label: 'Board Type', category: 'Board Certification', dataType: 'enum', prismaPath: 'boardCertifications.boardType' },
  { key: 'boardCertifications.boardName', label: 'Board Name', category: 'Board Certification', dataType: 'string', prismaPath: 'boardCertifications.boardName' },
  { key: 'boardCertifications.certificationNumber', label: 'Certification Number', category: 'Board Certification', dataType: 'string', prismaPath: 'boardCertifications.certificationNumber' },
  { key: 'boardCertifications.specialty', label: 'Board Specialty', category: 'Board Certification', dataType: 'string', prismaPath: 'boardCertifications.specialty' },
  { key: 'boardCertifications.initialCertificationDate', label: 'Initial Certification Date', category: 'Board Certification', dataType: 'date', prismaPath: 'boardCertifications.initialCertificationDate' },
  { key: 'boardCertifications.expirationDate', label: 'Board Cert Expiration Date', category: 'Board Certification', dataType: 'date', prismaPath: 'boardCertifications.expirationDate' },
  { key: 'boardCertifications.status', label: 'Board Cert Status', category: 'Board Certification', dataType: 'enum', prismaPath: 'boardCertifications.status' },
  { key: 'boardCertifications.isBoardEligible', label: 'Board Eligible', category: 'Board Certification', dataType: 'boolean', prismaPath: 'boardCertifications.isBoardEligible' },

  // ==========================================
  // Malpractice
  // ==========================================
  { key: 'malpracticeInsurances.carrierName', label: 'Malpractice Carrier', category: 'Malpractice', dataType: 'string', prismaPath: 'malpracticeInsurances.carrierName' },
  { key: 'malpracticeInsurances.policyNumber', label: 'Malpractice Policy Number', category: 'Malpractice', dataType: 'string', prismaPath: 'malpracticeInsurances.policyNumber' },
  { key: 'malpracticeInsurances.coverageType', label: 'Coverage Type', category: 'Malpractice', dataType: 'enum', prismaPath: 'malpracticeInsurances.coverageType' },
  { key: 'malpracticeInsurances.perClaimAmount', label: 'Per Claim Amount', category: 'Malpractice', dataType: 'number', prismaPath: 'malpracticeInsurances.perClaimAmount' },
  { key: 'malpracticeInsurances.aggregateAmount', label: 'Aggregate Amount', category: 'Malpractice', dataType: 'number', prismaPath: 'malpracticeInsurances.aggregateAmount' },
  { key: 'malpracticeInsurances.effectiveDate', label: 'Malpractice Effective Date', category: 'Malpractice', dataType: 'date', prismaPath: 'malpracticeInsurances.effectiveDate' },
  { key: 'malpracticeInsurances.expirationDate', label: 'Malpractice Expiration Date', category: 'Malpractice', dataType: 'date', prismaPath: 'malpracticeInsurances.expirationDate' },
  { key: 'malpracticeInsurances.status', label: 'Malpractice Status', category: 'Malpractice', dataType: 'enum', prismaPath: 'malpracticeInsurances.status' },
  { key: 'malpracticeInsurances.hasTailCoverage', label: 'Has Tail Coverage', category: 'Malpractice', dataType: 'boolean', prismaPath: 'malpracticeInsurances.hasTailCoverage' },

  // ==========================================
  // Education
  // ==========================================
  { key: 'educations.institutionName', label: 'Institution Name', category: 'Education', dataType: 'string', prismaPath: 'educations.institutionName' },
  { key: 'educations.degree', label: 'Degree', category: 'Education', dataType: 'enum', prismaPath: 'educations.degree' },
  { key: 'educations.fieldOfStudy', label: 'Field of Study', category: 'Education', dataType: 'string', prismaPath: 'educations.fieldOfStudy' },
  { key: 'educations.city', label: 'Education City', category: 'Education', dataType: 'string', prismaPath: 'educations.city' },
  { key: 'educations.state', label: 'Education State', category: 'Education', dataType: 'string', prismaPath: 'educations.state' },
  { key: 'educations.graduationDate', label: 'Graduation Date', category: 'Education', dataType: 'date', prismaPath: 'educations.graduationDate' },
  { key: 'educations.isCompleted', label: 'Education Completed', category: 'Education', dataType: 'boolean', prismaPath: 'educations.isCompleted' },

  // ==========================================
  // Work History
  // ==========================================
  { key: 'workHistories.organizationName', label: 'Organization Name', category: 'Work History', dataType: 'string', prismaPath: 'workHistories.organizationName' },
  { key: 'workHistories.organizationType', label: 'Organization Type', category: 'Work History', dataType: 'string', prismaPath: 'workHistories.organizationType' },
  { key: 'workHistories.position', label: 'Position', category: 'Work History', dataType: 'string', prismaPath: 'workHistories.position' },
  { key: 'workHistories.department', label: 'Department', category: 'Work History', dataType: 'string', prismaPath: 'workHistories.department' },
  { key: 'workHistories.startDate', label: 'Work Start Date', category: 'Work History', dataType: 'date', prismaPath: 'workHistories.startDate' },
  { key: 'workHistories.endDate', label: 'Work End Date', category: 'Work History', dataType: 'date', prismaPath: 'workHistories.endDate' },
  { key: 'workHistories.isCurrent', label: 'Current Position', category: 'Work History', dataType: 'boolean', prismaPath: 'workHistories.isCurrent' },

  // ==========================================
  // Hospital Affiliation
  // ==========================================
  { key: 'hospitalAffiliations.facilityName', label: 'Facility Name', category: 'Hospital Affiliation', dataType: 'string', prismaPath: 'hospitalAffiliations.facilityName' },
  { key: 'hospitalAffiliations.facilityType', label: 'Facility Type', category: 'Hospital Affiliation', dataType: 'string', prismaPath: 'hospitalAffiliations.facilityType' },
  { key: 'hospitalAffiliations.privilegeType', label: 'Privilege Type', category: 'Hospital Affiliation', dataType: 'enum', prismaPath: 'hospitalAffiliations.privilegeType' },
  { key: 'hospitalAffiliations.status', label: 'Affiliation Status', category: 'Hospital Affiliation', dataType: 'enum', prismaPath: 'hospitalAffiliations.status' },
  { key: 'hospitalAffiliations.appointmentDate', label: 'Appointment Date', category: 'Hospital Affiliation', dataType: 'date', prismaPath: 'hospitalAffiliations.appointmentDate' },
  { key: 'hospitalAffiliations.reappointmentDate', label: 'Reappointment Date', category: 'Hospital Affiliation', dataType: 'date', prismaPath: 'hospitalAffiliations.reappointmentDate' },
  { key: 'hospitalAffiliations.city', label: 'Affiliation City', category: 'Hospital Affiliation', dataType: 'string', prismaPath: 'hospitalAffiliations.city' },
  { key: 'hospitalAffiliations.state', label: 'Affiliation State', category: 'Hospital Affiliation', dataType: 'string', prismaPath: 'hospitalAffiliations.state' },

  // ==========================================
  // Payer Enrollment
  // ==========================================
  { key: 'enrollments.payer.name', label: 'Payer Name', category: 'Payer Enrollment', dataType: 'string', prismaPath: 'enrollments.payer.name' },
  { key: 'enrollments.status', label: 'Enrollment Status', category: 'Payer Enrollment', dataType: 'enum', prismaPath: 'enrollments.status' },
  { key: 'enrollments.providerNumber', label: 'Provider Number', category: 'Payer Enrollment', dataType: 'string', prismaPath: 'enrollments.providerNumber' },
  { key: 'enrollments.groupNumber', label: 'Group Number', category: 'Payer Enrollment', dataType: 'string', prismaPath: 'enrollments.groupNumber' },
  { key: 'enrollments.applicationDate', label: 'Application Date', category: 'Payer Enrollment', dataType: 'date', prismaPath: 'enrollments.applicationDate' },
  { key: 'enrollments.effectiveDate', label: 'Enrollment Effective Date', category: 'Payer Enrollment', dataType: 'date', prismaPath: 'enrollments.effectiveDate' },
  { key: 'enrollments.recredentialingDate', label: 'Recredentialing Date', category: 'Payer Enrollment', dataType: 'date', prismaPath: 'enrollments.recredentialingDate' },

  // ==========================================
  // Practice Location
  // ==========================================
  { key: 'practiceLocations.locationName', label: 'Location Name', category: 'Practice Location', dataType: 'string', prismaPath: 'practiceLocations.locationName' },
  { key: 'practiceLocations.locationType', label: 'Location Type', category: 'Practice Location', dataType: 'string', prismaPath: 'practiceLocations.locationType' },
  { key: 'practiceLocations.addressLine1', label: 'Location Address', category: 'Practice Location', dataType: 'string', prismaPath: 'practiceLocations.addressLine1' },
  { key: 'practiceLocations.city', label: 'Location City', category: 'Practice Location', dataType: 'string', prismaPath: 'practiceLocations.city' },
  { key: 'practiceLocations.state', label: 'Location State', category: 'Practice Location', dataType: 'string', prismaPath: 'practiceLocations.state' },
  { key: 'practiceLocations.zipCode', label: 'Location Zip Code', category: 'Practice Location', dataType: 'string', prismaPath: 'practiceLocations.zipCode' },
  { key: 'practiceLocations.phone', label: 'Location Phone', category: 'Practice Location', dataType: 'string', prismaPath: 'practiceLocations.phone' },
  { key: 'practiceLocations.npi', label: 'Location NPI', category: 'Practice Location', dataType: 'string', prismaPath: 'practiceLocations.npi' },
  { key: 'practiceLocations.taxId', label: 'Location Tax ID', category: 'Practice Location', dataType: 'string', prismaPath: 'practiceLocations.taxId' },
  { key: 'practiceLocations.isPrimary', label: 'Primary Location', category: 'Practice Location', dataType: 'boolean', prismaPath: 'practiceLocations.isPrimary' },
  { key: 'practiceLocations.acceptingNewPatients', label: 'Accepting New Patients', category: 'Practice Location', dataType: 'boolean', prismaPath: 'practiceLocations.acceptingNewPatients' },

  // ==========================================
  // Professional Reference
  // ==========================================
  { key: 'professionalReferences.name', label: 'Reference Name', category: 'Professional Reference', dataType: 'string', prismaPath: 'professionalReferences.name' },
  { key: 'professionalReferences.title', label: 'Reference Title', category: 'Professional Reference', dataType: 'string', prismaPath: 'professionalReferences.title' },
  { key: 'professionalReferences.organization', label: 'Reference Organization', category: 'Professional Reference', dataType: 'string', prismaPath: 'professionalReferences.organization' },
  { key: 'professionalReferences.email', label: 'Reference Email', category: 'Professional Reference', dataType: 'string', prismaPath: 'professionalReferences.email' },
  { key: 'professionalReferences.phone', label: 'Reference Phone', category: 'Professional Reference', dataType: 'string', prismaPath: 'professionalReferences.phone' },
  { key: 'professionalReferences.relationship', label: 'Reference Relationship', category: 'Professional Reference', dataType: 'string', prismaPath: 'professionalReferences.relationship' },

  // ==========================================
  // Disciplinary Action
  // ==========================================
  { key: 'disciplinaryActions.actionType', label: 'Action Type', category: 'Disciplinary Action', dataType: 'enum', prismaPath: 'disciplinaryActions.actionType' },
  { key: 'disciplinaryActions.description', label: 'Action Description', category: 'Disciplinary Action', dataType: 'string', prismaPath: 'disciplinaryActions.description' },
  { key: 'disciplinaryActions.dateOfAction', label: 'Date of Action', category: 'Disciplinary Action', dataType: 'date', prismaPath: 'disciplinaryActions.dateOfAction' },
  { key: 'disciplinaryActions.agency', label: 'Agency', category: 'Disciplinary Action', dataType: 'string', prismaPath: 'disciplinaryActions.agency' },
  { key: 'disciplinaryActions.isResolved', label: 'Is Resolved', category: 'Disciplinary Action', dataType: 'boolean', prismaPath: 'disciplinaryActions.isResolved' },

  // ==========================================
  // Continuing Education
  // ==========================================
  { key: 'continuingEducations.courseName', label: 'Course Name', category: 'Continuing Education', dataType: 'string', prismaPath: 'continuingEducations.courseName' },
  { key: 'continuingEducations.courseProvider', label: 'Course Provider', category: 'Continuing Education', dataType: 'string', prismaPath: 'continuingEducations.courseProvider' },
  { key: 'continuingEducations.credits', label: 'Credits', category: 'Continuing Education', dataType: 'number', prismaPath: 'continuingEducations.credits' },
  { key: 'continuingEducations.creditType', label: 'Credit Type', category: 'Continuing Education', dataType: 'string', prismaPath: 'continuingEducations.creditType' },
  { key: 'continuingEducations.completionDate', label: 'Completion Date', category: 'Continuing Education', dataType: 'date', prismaPath: 'continuingEducations.completionDate' },
];

// Map for quick lookup by key
export const ROSTER_FIELD_MAP = new Map(
  ROSTER_FIELDS.map(f => [f.key, f])
);

// Relations that need Prisma includes (one-to-many)
export const ROSTER_RELATIONS = [
  'addresses',
  'licenses',
  'boardCertifications',
  'malpracticeInsurances',
  'educations',
  'workHistories',
  'hospitalAffiliations',
  'enrollments',
  'practiceLocations',
  'professionalReferences',
  'disciplinaryActions',
  'continuingEducations',
] as const;
