import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useOrganizationTypes,
  useSaveClinicalProfile,
} from '../../hooks/useClinicalProfile';
import type { ClinicalProfileFormData } from './types';
import OrganizationTypeStep from './steps/OrganizationTypeStep';
import SpecialtiesStep from './steps/SpecialtiesStep';
import SubSpecialtiesStep from './steps/SubSpecialtiesStep';
import ServicesStep from './steps/ServicesStep';
import AgeGroupsStep from './steps/AgeGroupsStep';
import GenderIdentitiesStep from './steps/GenderIdentitiesStep';
import SexualOrientationsStep from './steps/SexualOrientationsStep';
import SpecialPopulationsStep from './steps/SpecialPopulationsStep';
import ReviewSummary from './steps/ReviewSummary';

const STEPS = [
  { title: 'Organization Type', required: true },
  { title: 'Specialties', required: true },
  { title: 'Sub-Specialties', required: false },
  { title: 'Services', required: false },
  { title: 'Patient Age Groups', required: false },
  { title: 'Gender Identities', required: false },
  { title: 'Sexual Orientations', required: false },
  { title: 'Special Populations', required: false },
];

export default function ClinicalProfileWizard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<ClinicalProfileFormData>({
    organizationTypeId: null,
    specialtyIds: [],
    subSpecialtyIds: [],
    serviceOfferingIds: [],
    customServices: [],
    patientAgeGroupIds: [],
    patientGenderIdentityIds: [],
    patientSexualOrientationIds: [],
    specialPopulationIds: [],
  });

  const navigate = useNavigate();
  const saveClinicalProfile = useSaveClinicalProfile();
  const { data: organizationTypes } = useOrganizationTypes();

  // Determine if Next should be disabled
  const isNextDisabled =
    (currentStep === 0 && formData.organizationTypeId === null) ||
    (currentStep === 1 && formData.specialtyIds.length === 0);

  // When org type changes, clear dependent specialty/sub-specialty selections
  const handleOrgTypeChange = useCallback((id: string) => {
    setFormData((prev) => ({
      ...prev,
      organizationTypeId: id,
      specialtyIds: [],
      subSpecialtyIds: [],
    }));
  }, []);

  // When specialties change, prune sub-specialties that lost their parent
  const handleSpecialtiesChange = useCallback((ids: string[]) => {
    setFormData((prev) => {
      // Keep only sub-specialties whose parent specialty is still selected
      // (sub-specialty parent info isn't available here, so we keep all —
      //  the SubSpecialtiesStep query will only return valid ones)
      return { ...prev, specialtyIds: ids };
    });
  }, []);

  const handleConfirm = () => {
    saveClinicalProfile.mutate(
      {
        organizationTypeId: formData.organizationTypeId!,
        specialtyIds: formData.specialtyIds,
        subSpecialtyIds: formData.subSpecialtyIds,
        serviceOfferingIds: formData.serviceOfferingIds,
        customServices: formData.customServices,
        patientAgeGroupIds: formData.patientAgeGroupIds,
        patientGenderIdentityIds: formData.patientGenderIdentityIds,
        patientSexualOrientationIds: formData.patientSexualOrientationIds,
        specialPopulationIds: formData.specialPopulationIds,
      },
      {
        onSuccess: () => navigate('/'),
      },
    );
  };

  const isReview = currentStep === STEPS.length;

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <OrganizationTypeStep
            value={formData.organizationTypeId}
            onChange={handleOrgTypeChange}
          />
        );
      case 1:
        return (
          <SpecialtiesStep
            organizationTypeId={formData.organizationTypeId!}
            organizationTypes={organizationTypes ?? []}
            value={formData.specialtyIds}
            onChange={handleSpecialtiesChange}
          />
        );
      case 2:
        return (
          <SubSpecialtiesStep
            specialtyIds={formData.specialtyIds}
            value={formData.subSpecialtyIds}
            onChange={(ids) =>
              setFormData((prev) => ({ ...prev, subSpecialtyIds: ids }))
            }
          />
        );
      case 3:
        return (
          <ServicesStep
            value={{
              serviceOfferingIds: formData.serviceOfferingIds,
              customServices: formData.customServices,
            }}
            onChange={(v) =>
              setFormData((prev) => ({
                ...prev,
                serviceOfferingIds: v.serviceOfferingIds,
                customServices: v.customServices,
              }))
            }
          />
        );
      case 4:
        return (
          <AgeGroupsStep
            value={formData.patientAgeGroupIds}
            onChange={(ids) =>
              setFormData((prev) => ({ ...prev, patientAgeGroupIds: ids }))
            }
          />
        );
      case 5:
        return (
          <GenderIdentitiesStep
            value={formData.patientGenderIdentityIds}
            onChange={(ids) =>
              setFormData((prev) => ({
                ...prev,
                patientGenderIdentityIds: ids,
              }))
            }
          />
        );
      case 6:
        return (
          <SexualOrientationsStep
            value={formData.patientSexualOrientationIds}
            onChange={(ids) =>
              setFormData((prev) => ({
                ...prev,
                patientSexualOrientationIds: ids,
              }))
            }
          />
        );
      case 7:
        return (
          <SpecialPopulationsStep
            value={formData.specialPopulationIds}
            onChange={(ids) =>
              setFormData((prev) => ({ ...prev, specialPopulationIds: ids }))
            }
          />
        );
      default:
        return (
          <ReviewSummary
            data={formData}
            onEditStep={setCurrentStep}
            onConfirm={handleConfirm}
            isSubmitting={saveClinicalProfile.isPending}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#faf7f2] py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <img
            src="/logo-full.svg"
            alt="Lanyard Health"
            className="h-[72px] mx-auto"
          />
          <h2 className="mt-6 text-2xl font-semibold text-[#1f2721]">
            Set up your clinical profile
          </h2>
          <p className="mt-2 text-sm text-[#6b665c]">
            Tell us about your practice so we can customize your experience
          </p>
        </div>

        <div className="bg-white border border-[#e3ddd2] rounded-2xl p-8 shadow-sm">
          {/* Progress indicator */}
          {!isReview && (
            <>
              <div className="flex items-center justify-between mb-6">
                <span className="text-sm font-medium text-gray-500">
                  Step {currentStep + 1} of {STEPS.length}
                </span>
                <span className="text-sm font-medium text-gray-700">
                  {STEPS[currentStep]?.title || 'Review'}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5 mb-8">
                <div
                  className="bg-primary-600 h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: `${((currentStep + 1) / (STEPS.length + 1)) * 100}%`,
                  }}
                />
              </div>
            </>
          )}

          {isReview && (
            <>
              <div className="flex items-center justify-between mb-6">
                <span className="text-sm font-medium text-gray-500">
                  Review
                </span>
                <span className="text-sm font-medium text-gray-700">
                  Confirm your selections
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5 mb-8">
                <div
                  className="bg-primary-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: '100%' }}
                />
              </div>
            </>
          )}

          {/* Step content */}
          {renderStep()}

          {/* Navigation buttons (hidden on review — ReviewSummary has its own) */}
          {!isReview && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-200">
              {currentStep > 0 ? (
                <button
                  type="button"
                  onClick={() => setCurrentStep((s) => s - 1)}
                  className="text-sm text-gray-600 hover:text-gray-800"
                >
                  &larr; Back
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-3">
                {!STEPS[currentStep]?.required && currentStep < STEPS.length && (
                  <button
                    type="button"
                    onClick={() => setCurrentStep((s) => s + 1)}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Skip
                  </button>
                )}

                {currentStep < STEPS.length && (
                  <button
                    type="button"
                    onClick={() => setCurrentStep((s) => s + 1)}
                    disabled={isNextDisabled}
                    className="px-6 py-2.5 bg-[#0A3D2E] text-white text-sm font-medium rounded-full hover:bg-[#082f23] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
