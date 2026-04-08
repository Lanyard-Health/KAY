import { useState, useEffect, useCallback } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/auth.store';
import {
  usePracticeClinicalProfile,
  useSaveClinicalProfile,
  useOrganizationTypes,
} from '../../hooks/useClinicalProfile';
import type { ClinicalProfileFormData } from '../clinical-profile/types';
import OrganizationTypeStep from '../clinical-profile/steps/OrganizationTypeStep';
import SpecialtiesStep from '../clinical-profile/steps/SpecialtiesStep';
import SubSpecialtiesStep from '../clinical-profile/steps/SubSpecialtiesStep';
import ServicesStep from '../clinical-profile/steps/ServicesStep';
import AgeGroupsStep from '../clinical-profile/steps/AgeGroupsStep';
import GenderIdentitiesStep from '../clinical-profile/steps/GenderIdentitiesStep';
import SexualOrientationsStep from '../clinical-profile/steps/SexualOrientationsStep';
import SpecialPopulationsStep from '../clinical-profile/steps/SpecialPopulationsStep';

const INITIAL_FORM_DATA: ClinicalProfileFormData = {
  organizationTypeId: null,
  specialtyIds: [],
  subSpecialtyIds: [],
  serviceOfferingIds: [],
  customServices: [],
  patientAgeGroupIds: [],
  patientGenderIdentityIds: [],
  patientSexualOrientationIds: [],
  specialPopulationIds: [],
};

interface Section {
  key: string;
  title: string;
  description: string;
}

const SECTIONS: Section[] = [
  { key: 'organizationType', title: 'Organization Type', description: 'How your practice is structured' },
  { key: 'specialties', title: 'Specialties', description: 'Clinical specialties your practice offers' },
  { key: 'subSpecialties', title: 'Sub-Specialties', description: 'Focused areas within your specialties' },
  { key: 'services', title: 'Services', description: 'Specific services and treatments offered' },
  { key: 'ageGroups', title: 'Patient Age Groups', description: 'Age demographics you serve' },
  { key: 'genderIdentities', title: 'Gender Identities', description: 'Gender identities your practice welcomes' },
  { key: 'sexualOrientations', title: 'Sexual Orientations', description: 'Sexual orientations your practice affirms' },
  { key: 'specialPopulations', title: 'Special Populations', description: 'Specialized populations you serve' },
];

export default function ClinicalProfileTab() {
  const user = useAuthStore((s) => s.user);
  const practiceId = user?.practices?.[0]?.practiceId;
  const { data: profile, isLoading } = usePracticeClinicalProfile(practiceId);
  const { data: organizationTypes } = useOrganizationTypes();
  const saveMutation = useSaveClinicalProfile();

  const [formData, setFormData] = useState<ClinicalProfileFormData>(INITIAL_FORM_DATA);
  const [isDirty, setIsDirty] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['organizationType']));

  // Initialize form from loaded profile
  useEffect(() => {
    if (profile) {
      setFormData({
        organizationTypeId: profile.organizationTypeId,
        specialtyIds: profile.practiceSpecialties?.map((ps: any) => ps.specialty.id) ?? [],
        subSpecialtyIds: profile.practiceSubSpecialties?.map((ps: any) => ps.subSpecialty.id) ?? [],
        serviceOfferingIds: profile.practiceServices?.map((ps: any) => ps.serviceOffering.id) ?? [],
        customServices: [],
        patientAgeGroupIds: profile.practiceAgeGroups?.map((pa: any) => pa.patientAgeGroup.id) ?? [],
        patientGenderIdentityIds: profile.practiceGenderIdentities?.map((pg: any) => pg.patientGenderIdentity.id) ?? [],
        patientSexualOrientationIds: profile.practiceSexualOrientations?.map((ps: any) => ps.patientSexualOrientation.id) ?? [],
        specialPopulationIds: profile.practiceSpecialPopulations?.map((ps: any) => ps.specialPopulation.id) ?? [],
      });
      setIsDirty(false);
    }
  }, [profile]);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleOrgTypeChange = useCallback((id: string) => {
    setFormData((prev) => ({
      ...prev,
      organizationTypeId: id,
      // Clear dependent selections when org type changes
      specialtyIds: [],
      subSpecialtyIds: [],
    }));
    setIsDirty(true);
  }, []);

  const handleSpecialtiesChange = useCallback((ids: string[]) => {
    setFormData((prev) => {
      // Filter out sub-specialties whose parent specialty was removed
      const removedSpecialtyIds = prev.specialtyIds.filter((id) => !ids.includes(id));
      const filteredSubSpecialtyIds = removedSpecialtyIds.length > 0
        ? prev.subSpecialtyIds // We can't filter without sub-specialty data here; SubSpecialtiesStep handles its own filtering
        : prev.subSpecialtyIds;
      return {
        ...prev,
        specialtyIds: ids,
        subSpecialtyIds: filteredSubSpecialtyIds,
      };
    });
    setIsDirty(true);
  }, []);

  const handleSubSpecialtiesChange = useCallback((ids: string[]) => {
    setFormData((prev) => ({ ...prev, subSpecialtyIds: ids }));
    setIsDirty(true);
  }, []);

  const handleServicesChange = useCallback((v: { serviceOfferingIds: string[]; customServices: string[] }) => {
    setFormData((prev) => ({
      ...prev,
      serviceOfferingIds: v.serviceOfferingIds,
      customServices: v.customServices,
    }));
    setIsDirty(true);
  }, []);

  const handleAgeGroupsChange = useCallback((ids: string[]) => {
    setFormData((prev) => ({ ...prev, patientAgeGroupIds: ids }));
    setIsDirty(true);
  }, []);

  const handleGenderIdentitiesChange = useCallback((ids: string[]) => {
    setFormData((prev) => ({ ...prev, patientGenderIdentityIds: ids }));
    setIsDirty(true);
  }, []);

  const handleSexualOrientationsChange = useCallback((ids: string[]) => {
    setFormData((prev) => ({ ...prev, patientSexualOrientationIds: ids }));
    setIsDirty(true);
  }, []);

  const handleSpecialPopulationsChange = useCallback((ids: string[]) => {
    setFormData((prev) => ({ ...prev, specialPopulationIds: ids }));
    setIsDirty(true);
  }, []);

  const handleSave = () => {
    if (!formData.organizationTypeId) return;
    saveMutation.mutate(
      {
        organizationTypeId: formData.organizationTypeId,
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
        onSuccess: () => setIsDirty(false),
      },
    );
  };

  const handleDiscard = () => {
    if (profile) {
      setFormData({
        organizationTypeId: profile.organizationTypeId,
        specialtyIds: profile.practiceSpecialties?.map((ps: any) => ps.specialty.id) ?? [],
        subSpecialtyIds: profile.practiceSubSpecialties?.map((ps: any) => ps.subSpecialty.id) ?? [],
        serviceOfferingIds: profile.practiceServices?.map((ps: any) => ps.serviceOffering.id) ?? [],
        customServices: [],
        patientAgeGroupIds: profile.practiceAgeGroups?.map((pa: any) => pa.patientAgeGroup.id) ?? [],
        patientGenderIdentityIds: profile.practiceGenderIdentities?.map((pg: any) => pg.patientGenderIdentity.id) ?? [],
        patientSexualOrientationIds: profile.practiceSexualOrientations?.map((ps: any) => ps.patientSexualOrientation.id) ?? [],
        specialPopulationIds: profile.practiceSpecialPopulations?.map((ps: any) => ps.specialPopulation.id) ?? [],
      });
      setIsDirty(false);
    }
  };

  const renderSectionContent = (sectionKey: string) => {
    switch (sectionKey) {
      case 'organizationType':
        return (
          <OrganizationTypeStep
            value={formData.organizationTypeId}
            onChange={handleOrgTypeChange}
          />
        );
      case 'specialties':
        return formData.organizationTypeId ? (
          <SpecialtiesStep
            organizationTypeId={formData.organizationTypeId}
            organizationTypes={organizationTypes ?? []}
            value={formData.specialtyIds}
            onChange={handleSpecialtiesChange}
          />
        ) : (
          <p className="text-sm text-gray-500">Select an organization type first.</p>
        );
      case 'subSpecialties':
        return formData.specialtyIds.length > 0 ? (
          <SubSpecialtiesStep
            specialtyIds={formData.specialtyIds}
            value={formData.subSpecialtyIds}
            onChange={handleSubSpecialtiesChange}
          />
        ) : (
          <p className="text-sm text-gray-500">Select at least one specialty first.</p>
        );
      case 'services':
        return (
          <ServicesStep
            value={{ serviceOfferingIds: formData.serviceOfferingIds, customServices: formData.customServices }}
            onChange={handleServicesChange}
          />
        );
      case 'ageGroups':
        return (
          <AgeGroupsStep
            value={formData.patientAgeGroupIds}
            onChange={handleAgeGroupsChange}
          />
        );
      case 'genderIdentities':
        return (
          <GenderIdentitiesStep
            value={formData.patientGenderIdentityIds}
            onChange={handleGenderIdentitiesChange}
          />
        );
      case 'sexualOrientations':
        return (
          <SexualOrientationsStep
            value={formData.patientSexualOrientationIds}
            onChange={handleSexualOrientationsChange}
          />
        );
      case 'specialPopulations':
        return (
          <SpecialPopulationsStep
            value={formData.specialPopulationIds}
            onChange={handleSpecialPopulationsChange}
          />
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 max-w-2xl">
        <div className="h-10 bg-gray-200 rounded w-2/3" />
        <div className="h-10 bg-gray-200 rounded w-1/2" />
        <div className="h-10 bg-gray-200 rounded w-3/4" />
      </div>
    );
  }

  if (!profile && !isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-500">
          No clinical profile set up yet. Complete the clinical profile wizard to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      {SECTIONS.map((section) => {
        const isOpen = openSections.has(section.key);
        return (
          <div
            key={section.key}
            className="bg-white rounded-xl border border-gray-200 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
            >
              <div>
                <h3 className="text-sm font-medium text-gray-900">{section.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
              </div>
              {isOpen ? (
                <ChevronDownIcon className="h-5 w-5 text-gray-400 shrink-0" />
              ) : (
                <ChevronRightIcon className="h-5 w-5 text-gray-400 shrink-0" />
              )}
            </button>
            {isOpen && (
              <div className="px-6 pb-6 pt-2">
                {renderSectionContent(section.key)}
              </div>
            )}
          </div>
        );
      })}

      {isDirty && (
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || !formData.organizationTypeId || formData.specialtyIds.length === 0}
            className={clsx(
              'btn-primary text-sm',
              (saveMutation.isPending || !formData.organizationTypeId || formData.specialtyIds.length === 0) &&
                'opacity-50 cursor-not-allowed',
            )}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={handleDiscard}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
