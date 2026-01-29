import type { UUID, AuditInfo } from './common.js';

export type ProviderStatus = 'active' | 'inactive' | 'pending';
export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';
export type ProviderType = 'psychiatrist' | 'psychologist' | 'lcsw' | 'lpc' | 'lmft' | 'pmhnp' | 'other';

export interface ProviderAddress {
  id: UUID;
  providerId: UUID;
  type: 'home' | 'practice' | 'mailing' | 'billing';
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  isPrimary: boolean;
}

export interface Provider extends AuditInfo {
  id: UUID;

  // Basic Info
  npi: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  maidenName?: string;

  // Personal Info
  dateOfBirth: Date;
  gender: Gender;
  ssn?: string; // Encrypted, only last 4 shown

  // Contact
  email: string;
  phone: string;
  mobilePhone?: string;
  fax?: string;

  // Professional
  providerType: ProviderType;
  taxonomy?: string;
  specialties: string[];
  languages: string[];

  // CAQH
  caqhProviderId?: string;
  caqhStatus?: 'active' | 'inactive' | 'pending' | 'expired';
  caqhLastSync?: Date;

  // Status
  status: ProviderStatus;

  // Addresses
  addresses?: ProviderAddress[];
}

export interface CreateProviderDto {
  npi: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  dateOfBirth: string;
  gender: Gender;
  email: string;
  phone: string;
  mobilePhone?: string;
  fax?: string;
  providerType: ProviderType;
  taxonomy?: string;
  specialties?: string[];
  languages?: string[];
}

export interface UpdateProviderDto extends Partial<CreateProviderDto> {
  status?: ProviderStatus;
  caqhProviderId?: string;
}
