export interface ClinicalProfileFormData {
  organizationTypeId: string | null;
  specialtyIds: string[];
  subSpecialtyIds: string[];
  serviceOfferingIds: string[];
  customServices: string[];
  patientAgeGroupIds: string[];
  patientGenderIdentityIds: string[];
  patientSexualOrientationIds: string[];
  specialPopulationIds: string[];
}
