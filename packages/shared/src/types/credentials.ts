import type { UUID, AuditInfo } from './common.js';

export type CredentialStatus = 'active' | 'expired' | 'pending' | 'revoked';

// License Types
export type LicenseType =
  | 'state_medical'
  | 'state_psychology'
  | 'state_social_work'
  | 'state_counseling'
  | 'state_marriage_family'
  | 'dea'
  | 'controlled_substance'
  | 'npi';

export interface License extends AuditInfo {
  id: UUID;
  providerId: UUID;
  licenseType: LicenseType;
  licenseNumber: string;
  state?: string;
  issueDate: Date;
  expirationDate: Date;
  status: CredentialStatus;
  verificationDate?: Date;
  verificationSource?: string;
  notes?: string;
}

export interface CreateLicenseDto {
  licenseType: LicenseType;
  licenseNumber: string;
  state?: string;
  issueDate: string;
  expirationDate: string;
  notes?: string;
}

// Board Certifications
export type BoardType =
  | 'abpn_psychiatry'       // American Board of Psychiatry and Neurology
  | 'abpn_child_adolescent'
  | 'abpn_addiction'
  | 'abpp_clinical'         // American Board of Professional Psychology
  | 'abpp_counseling'
  | 'abecsw'                // Academy of Certified Social Workers
  | 'nbcc'                  // National Board for Certified Counselors
  | 'aamft'                 // American Association for Marriage and Family Therapy
  | 'ancc_pmhnp'            // American Nurses Credentialing Center
  | 'other';

export interface BoardCertification extends AuditInfo {
  id: UUID;
  providerId: UUID;
  boardType: BoardType;
  boardName: string;
  certificationNumber?: string;
  specialty: string;
  initialCertificationDate: Date;
  expirationDate?: Date;
  status: CredentialStatus;
  isBoardEligible: boolean;
  notes?: string;
}

export interface CreateBoardCertificationDto {
  boardType: BoardType;
  boardName: string;
  certificationNumber?: string;
  specialty: string;
  initialCertificationDate: string;
  expirationDate?: string;
  isBoardEligible?: boolean;
  notes?: string;
}

// Malpractice Insurance
export interface MalpracticeInsurance extends AuditInfo {
  id: UUID;
  providerId: UUID;
  carrierName: string;
  policyNumber: string;
  coverageType: 'occurrence' | 'claims_made';
  perClaimAmount: number;
  aggregateAmount: number;
  effectiveDate: Date;
  expirationDate: Date;
  hasTailCoverage: boolean;
  status: CredentialStatus;
  notes?: string;
}

export interface CreateMalpracticeInsuranceDto {
  carrierName: string;
  policyNumber: string;
  coverageType: 'occurrence' | 'claims_made';
  perClaimAmount: number;
  aggregateAmount: number;
  effectiveDate: string;
  expirationDate: string;
  hasTailCoverage?: boolean;
  notes?: string;
}

// Education
export type DegreeType =
  | 'md' | 'do' | 'phd' | 'psyd' | 'msw' | 'ma' | 'ms'
  | 'med' | 'dnp' | 'msn' | 'bs' | 'ba' | 'other';

export interface Education extends AuditInfo {
  id: UUID;
  providerId: UUID;
  institutionName: string;
  degree: DegreeType;
  fieldOfStudy: string;
  city?: string;
  state?: string;
  country: string;
  startDate: Date;
  endDate?: Date;
  graduationDate?: Date;
  isCompleted: boolean;
  notes?: string;
}

export interface CreateEducationDto {
  institutionName: string;
  degree: DegreeType;
  fieldOfStudy: string;
  city?: string;
  state?: string;
  country: string;
  startDate: string;
  endDate?: string;
  graduationDate?: string;
  isCompleted?: boolean;
  notes?: string;
}

// Work History
export interface WorkHistory extends AuditInfo {
  id: UUID;
  providerId: UUID;
  organizationName: string;
  organizationType: string;
  position: string;
  department?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  startDate: Date;
  endDate?: Date;
  isCurrent: boolean;
  reasonForLeaving?: string;
  supervisorName?: string;
  supervisorPhone?: string;
  notes?: string;
}

export interface CreateWorkHistoryDto {
  organizationName: string;
  organizationType: string;
  position: string;
  department?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  startDate: string;
  endDate?: string;
  isCurrent?: boolean;
  reasonForLeaving?: string;
  supervisorName?: string;
  supervisorPhone?: string;
  notes?: string;
}

// Hospital Affiliations
export interface HospitalAffiliation extends AuditInfo {
  id: UUID;
  providerId: UUID;
  facilityName: string;
  facilityType: string;
  privilegeType: 'admitting' | 'courtesy' | 'consulting' | 'temporary' | 'locum_tenens';
  status: 'active' | 'pending' | 'inactive' | 'denied' | 'resigned';
  appointmentDate?: Date;
  reappointmentDate?: Date;
  city?: string;
  state?: string;
  notes?: string;
}

// Professional References
export interface ProfessionalReference extends AuditInfo {
  id: UUID;
  providerId: UUID;
  name: string;
  title: string;
  organization: string;
  relationship: string;
  email: string;
  phone: string;
  yearsKnown: number;
  canContact: boolean;
  notes?: string;
}

// Disciplinary Actions
export interface DisciplinaryAction extends AuditInfo {
  id: UUID;
  providerId: UUID;
  actionType: 'license_action' | 'hospital_action' | 'malpractice_claim' | 'legal_action' | 'other';
  description: string;
  dateOfAction: Date;
  state?: string;
  agency?: string;
  outcome?: string;
  isResolved: boolean;
  resolutionDate?: Date;
  notes?: string;
}

// Continuing Education
export interface ContinuingEducation extends AuditInfo {
  id: UUID;
  providerId: UUID;
  courseName: string;
  provider: string;
  credits: number;
  creditType: string;
  completionDate: Date;
  certificateNumber?: string;
  notes?: string;
}
