import { PencilIcon } from '@heroicons/react/24/outline';
import {
  useOrganizationTypes,
  useSpecialties,
  useSubSpecialties,
  useServices,
  useAgeGroups,
  useGenderIdentities,
  useSexualOrientations,
  useSpecialPopulations,
} from '../../../hooks/useClinicalProfile';
import type { ClinicalProfileFormData } from '../types';

interface Props {
  data: ClinicalProfileFormData;
  onEditStep: (step: number) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}

const INDIVIDUAL_TYPES = ['Individual', 'Group', 'Multi-Specialty'];

function Section({
  title,
  step,
  items,
  onEdit,
}: {
  title: string;
  step: number;
  items: string[];
  onEdit: (step: number) => void;
}) {
  return (
    <div className="py-4 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-900">{title}</h3>
        <button
          type="button"
          onClick={() => onEdit(step)}
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 transition-colors"
        >
          <PencilIcon className="h-3.5 w-3.5" />
          Edit
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">None selected</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item}
              className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-sm text-gray-700"
            >
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReviewSummary({
  data,
  onEditStep,
  onConfirm,
  isSubmitting,
}: Props) {
  const { data: orgTypes } = useOrganizationTypes();

  // Derive section from org type for specialty lookup
  const orgTypeName = orgTypes?.find((t) => t.id === data.organizationTypeId)?.name;
  const section =
    orgTypeName && INDIVIDUAL_TYPES.includes(orgTypeName)
      ? ('INDIVIDUAL' as const)
      : ('NON_INDIVIDUAL' as const);

  const { data: specialties } = useSpecialties(section);
  const { data: subSpecialties } = useSubSpecialties(data.specialtyIds);
  const { data: serviceCategories } = useServices();
  const { data: ageGroups } = useAgeGroups();
  const { data: genderIdentities } = useGenderIdentities();
  const { data: sexualOrientations } = useSexualOrientations();
  const { data: specialPopulations } = useSpecialPopulations();

  // Resolve IDs to names
  const orgTypeName_ = orgTypes?.find((t) => t.id === data.organizationTypeId)?.name;

  const specialtyNames =
    specialties
      ?.filter((s) => data.specialtyIds.includes(s.id))
      .map((s) => s.name) ?? [];

  const subSpecialtyNames =
    subSpecialties
      ?.filter((s) => data.subSpecialtyIds.includes(s.id))
      .map((s) => s.name) ?? [];

  const serviceNames: string[] = [];
  if (serviceCategories) {
    for (const cat of serviceCategories) {
      for (const svc of cat.serviceOfferings) {
        if (data.serviceOfferingIds.includes(svc.id)) {
          serviceNames.push(svc.name);
        }
      }
    }
  }
  const allServiceNames = [...serviceNames, ...data.customServices];

  const ageGroupNames =
    ageGroups
      ?.filter((g) => data.patientAgeGroupIds.includes(g.id))
      .map((g) => g.name) ?? [];

  const genderNames =
    genderIdentities
      ?.filter((g) => data.patientGenderIdentityIds.includes(g.id))
      .map((g) => g.name) ?? [];

  const orientationNames =
    sexualOrientations
      ?.filter((o) => data.patientSexualOrientationIds.includes(o.id))
      .map((o) => o.name) ?? [];

  const populationNames =
    specialPopulations
      ?.filter((p) => data.specialPopulationIds.includes(p.id))
      .map((p) => p.name) ?? [];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <Section
          title="Organization Type"
          step={0}
          items={orgTypeName_ ? [orgTypeName_] : []}
          onEdit={onEditStep}
        />
        <Section
          title="Specialties"
          step={1}
          items={specialtyNames}
          onEdit={onEditStep}
        />
        <Section
          title="Sub-Specialties"
          step={2}
          items={subSpecialtyNames}
          onEdit={onEditStep}
        />
        <Section
          title="Services"
          step={3}
          items={allServiceNames}
          onEdit={onEditStep}
        />
        <Section
          title="Patient Age Groups"
          step={4}
          items={ageGroupNames}
          onEdit={onEditStep}
        />
        <Section
          title="Gender Identities"
          step={5}
          items={genderNames}
          onEdit={onEditStep}
        />
        <Section
          title="Sexual Orientations"
          step={6}
          items={orientationNames}
          onEdit={onEditStep}
        />
        <Section
          title="Special Populations"
          step={7}
          items={populationNames}
          onEdit={onEditStep}
        />
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={isSubmitting}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting && (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {isSubmitting ? 'Saving...' : 'Confirm & Continue'}
      </button>
    </div>
  );
}
