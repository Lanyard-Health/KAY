import { useState, Fragment, useCallback, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import PageTransition from '../../components/ui/PageTransition';
import ErrorState from '../../components/ui/ErrorState';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Menu, Transition, Tab } from '@headlessui/react';
import { PencilIcon, DocumentArrowDownIcon, ChevronDownIcon, ChevronRightIcon, MapPinIcon, PlusIcon, TrashIcon, ArchiveBoxXMarkIcon, ClipboardDocumentCheckIcon, BuildingOfficeIcon, UserCircleIcon, AcademicCapIcon, BriefcaseIcon, DocumentTextIcon, UsersIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { useDeleteProvider } from '../../hooks/useProviderSoftDelete';
import DeleteProviderModal from './DeleteProviderModal';
import { format } from 'date-fns';
// jsPDF + autotable loaded dynamically in exportToPDF()
import { api } from '../../services/api';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import ErrorBoundary from '../../components/ErrorBoundary';
import RefreshIndicator from '../../components/RefreshIndicator';
import { useDeleteLicense, useDeleteCertification } from '../../hooks/useCredentials';
import DemographicsForm from './DemographicsForm';

// Lazy-loaded modals — only fetched when opened
const PracticeLocationModal = lazy(() => import('./PracticeLocationModal'));
const LicenseModal = lazy(() => import('./LicenseModal'));
const CertificationModal = lazy(() => import('./CertificationModal'));
const EducationModal = lazy(() => import('./EducationModal'));
const WorkHistoryModal = lazy(() => import('./WorkHistoryModal'));
const MalpracticeInsuranceModal = lazy(() => import('./MalpracticeInsuranceModal'));
const SupervisingPhysicianModal = lazy(() => import('./SupervisingPhysicianModal'));
const MalpracticeClaimModal = lazy(() => import('./MalpracticeClaimModal'));
const DisclosureModal = lazy(() => import('./DisclosureModal'));
const HospitalAffiliationModal = lazy(() => import('./HospitalAffiliationModal'));
const WorkHistoryGapModal = lazy(() => import('./WorkHistoryGapModal'));
const DeaRegistrationModal = lazy(() => import('./DeaRegistrationModal'));
const ProviderIdentifierModal = lazy(() => import('./ProviderIdentifierModal'));
const BankingModal = lazy(() => import('./BankingModal'));
const CdsRegistrationModal = lazy(() => import('./CdsRegistrationModal'));
const LifeSupportCertModal = lazy(() => import('./LifeSupportCertModal'));
import {
  useListEducation, useDeleteEducation,
  useListWorkHistory, useDeleteWorkHistory,
  useListWorkHistoryGaps, useDeleteWorkHistoryGap,
  useListMalpracticeInsurance, useDeleteMalpracticeInsurance,
  useListSupervisingPhysicians, useDeleteSupervisingPhysician,
  useListMalpracticeClaims, useDeleteMalpracticeClaim,
  useListDisclosures, useDeleteDisclosure,
  useListDeaRegistrations, useDeleteDeaRegistration,
  useListProviderIdentifiers, useDeleteProviderIdentifier,
  useListBanking, useDeleteBanking,
  useListHospitalAffiliations, useDeleteHospitalAffiliation,
  useListProfessionalReferences,
  useListCoveringColleagues,
  useListCdsRegistrations, useDeleteCdsRegistration,
  useListProviderCertifications, useDeleteProviderCertification,
  revealDeaRegistration, revealCdsRegistration, revealProviderSsn,
} from '../../hooks/usePayerEnrollmentData';
import RevealableSecret from '../../components/RevealableSecret';
import ProviderChecklist from './ProviderChecklist';
import ProviderEnrollments from './ProviderEnrollments';
import ProviderTasks from './ProviderTasks';
import DocumentUploadModal from '../../components/DocumentUploadModal';
import { CaqhCard } from '../../components/CaqhCard';
import PayerSubmissionDetailsSection from './PayerSubmissionDetailsSection';
import { CaqhImportPanel } from '../../components/CaqhImportPanel';
import AiSidebar from '../../components/AiSidebar';
import SupervisionTracker from './SupervisionTracker';
import MultiStateLicenseGrid from './MultiStateLicenseGrid';
import TaxonomyAssistant from './TaxonomyAssistant';
import HealthScoreGauge from '../../components/ui/HealthScoreGauge';
import SourceBadge from '../../components/ui/SourceBadge';
import CaqhEditWarningModal from '../../components/ui/CaqhEditWarningModal';
import { ShieldCheckIcon, MapIcon } from '@heroicons/react/24/outline';

const TABS = [
  { name: 'Profile', icon: UserCircleIcon },
  { name: 'Credentials', icon: ShieldCheckIcon },
  { name: 'Enrollments', icon: BuildingOfficeIcon },
  { name: 'Activity', icon: ClipboardDocumentCheckIcon },
];

function CollapsibleSection({
  title,
  defaultOpen = false,
  count,
  onAdd,
  addLabel = 'Add',
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  onAdd?: () => void;
  addLabel?: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60">
      <div
        className="px-5 py-4 border-b border-gray-100 flex items-center justify-between cursor-pointer select-none"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
      >
        <div className="flex items-center gap-2">
          <ChevronRightIcon className={clsx('h-4 w-4 text-gray-400 transition-transform duration-200', isOpen && 'rotate-90')} />
          <h2 className="text-lg font-medium text-gray-900">{title}</h2>
          {count !== undefined && (
            <span className="text-sm text-gray-400">({count})</span>
          )}
        </div>
        {onAdd && (
          <button
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            className="inline-flex items-center text-sm text-primary-600 hover:text-primary-700 rounded-lg hover:bg-primary-50 px-2.5 py-1.5 transition-colors"
          >
            <PlusIcon className="h-4 w-4 mr-1" />
            {addLabel}
          </button>
        )}
      </div>
      <div className={clsx(
        'overflow-hidden transition-all duration-200 ease-out',
        isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
      )}>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

export default function ProviderDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canSoftDelete = user?.role === 'admin' || user?.role === 'lanyard_staff' || user?.role === 'practice_admin';
  // Mirrors the PUT /providers/:id allow-list (lanyard_staff inherits credentialing_staff)
  const canEditStatus = user?.role === 'admin' || user?.role === 'lanyard_staff' || user?.role === 'credentialing_staff' || user?.role === 'practice_admin';
  const deleteProvider = useDeleteProvider();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Existing modal state
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<any>(null);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [editingLicense, setEditingLicense] = useState<any>(null);
  const [certModalOpen, setCertModalOpen] = useState(false);
  const [editingCert, setEditingCert] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadDocumentType, setUploadDocumentType] = useState<string>('');

  // New modal state
  const [educationModalOpen, setEducationModalOpen] = useState(false);
  const [editingEducation, setEditingEducation] = useState<any>(null);
  const [workHistoryModalOpen, setWorkHistoryModalOpen] = useState(false);
  const [editingWorkHistory, setEditingWorkHistory] = useState<any>(null);
  const [malpracticeInsuranceModalOpen, setMalpracticeInsuranceModalOpen] = useState(false);
  const [editingMalpracticeInsurance, setEditingMalpracticeInsurance] = useState<any>(null);
  const [supervisingPhysicianModalOpen, setSupervisingPhysicianModalOpen] = useState(false);
  const [editingSupervisingPhysician, setEditingSupervisingPhysician] = useState<any>(null);
  const [malpracticeClaimModalOpen, setMalpracticeClaimModalOpen] = useState(false);
  const [editingMalpracticeClaim, setEditingMalpracticeClaim] = useState<any>(null);
  const [disclosureModalOpen, setDisclosureModalOpen] = useState(false);
  const [editingDisclosure, setEditingDisclosure] = useState<any>(null);
  const [hospitalAffiliationModalOpen, setHospitalAffiliationModalOpen] = useState(false);
  const [editingHospitalAffiliation, setEditingHospitalAffiliation] = useState<any>(null);
  const [workHistoryGapModalOpen, setWorkHistoryGapModalOpen] = useState(false);
  const [editingWorkHistoryGap, setEditingWorkHistoryGap] = useState<any>(null);
  const [deaRegistrationModalOpen, setDeaRegistrationModalOpen] = useState(false);
  const [editingDeaRegistration, setEditingDeaRegistration] = useState<any>(null);
  const [cdsRegistrationModalOpen, setCdsRegistrationModalOpen] = useState(false);
  const [editingCdsRegistration, setEditingCdsRegistration] = useState<any>(null);
  const [lifeSupportCertModalOpen, setLifeSupportCertModalOpen] = useState(false);
  const [editingLifeSupportCert, setEditingLifeSupportCert] = useState<any>(null);

  // CAQH edit-warning modal (Phase 2f)
  const [caqhWarning, setCaqhWarning] = useState<{ recordType: string; proceed: () => void } | null>(null);
  const [providerIdentifierModalOpen, setProviderIdentifierModalOpen] = useState(false);
  const [editingProviderIdentifier, setEditingProviderIdentifier] = useState<any>(null);
  const [bankingModalOpen, setBankingModalOpen] = useState(false);
  const [editingBanking, setEditingBanking] = useState<any>(null);

  // CAQH pull state
  const [caqhInputId, setCaqhInputId] = useState('');
  const [caqhInputNpi, setCaqhInputNpi] = useState('');
  const [caqhInputsInitialized, setCaqhInputsInitialized] = useState(false);

  // Confirm dialog state (replaces window.confirm)
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const showConfirm = useCallback((title: string, message: string, onConfirm: () => void) => {
    setConfirmState({ isOpen: true, title, message, onConfirm });
  }, []);

  const closeConfirm = useCallback(() => {
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleUploadDocument = (documentType: string) => {
    setUploadDocumentType(documentType);
    setUploadModalOpen(true);
  };

  const handleUploadComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['provider', id] });
    queryClient.invalidateQueries({ queryKey: ['checklist', id] });
  };

  const { data: provider, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['provider', id],
    queryFn: async () => {
      const response = await api.get(`/providers/${id}`);
      return response.data.data;
    },
  });

  // Pre-fill CAQH inputs once provider loads
  if (provider && !caqhInputsInitialized) {
    setCaqhInputId(provider.caqhProviderId || '');
    setCaqhInputNpi(provider.npi || '');
    setCaqhInputsInitialized(true);
  }

  // Payer enrollment data queries
  const { data: educationList } = useListEducation(id || '');
  const { data: workHistoryList } = useListWorkHistory(id || '');
  const { data: workHistoryGapsList } = useListWorkHistoryGaps(id || '');
  const { data: malpracticeInsuranceList } = useListMalpracticeInsurance(id || '');
  const { data: supervisingPhysiciansList } = useListSupervisingPhysicians(id || '');
  const { data: malpracticeClaimsList } = useListMalpracticeClaims(id || '');
  const { data: disclosuresList } = useListDisclosures(id || '');
  const { data: deaRegistrationsList } = useListDeaRegistrations(id || '');
  const { data: providerIdentifiersList } = useListProviderIdentifiers(id || '');
  const { data: bankingList } = useListBanking(id || '');
  const { data: hospitalAffiliationsList } = useListHospitalAffiliations(id || '');
  const { data: professionalReferencesList } = useListProfessionalReferences(id || '');
  const { data: coveringColleaguesList } = useListCoveringColleagues(id || '');
  const { data: cdsRegistrationsList } = useListCdsRegistrations(id || '');
  const { data: lifeSupportCertsList } = useListProviderCertifications(id || '');


  // Existing delete mutations
  const deleteLocationMutation = useMutation({
    mutationFn: async (locationId: string) => {
      return api.delete(`/practice-locations/${locationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider', id] });
      toast.success('Location deleted');
    },
    onError: () => {
      toast.error('Failed to delete location');
    },
  });

  // Inline status change from the header badge — same PUT the edit form uses
  const statusMutation = useMutation({
    mutationFn: async (status: 'active' | 'pending' | 'inactive') => {
      return api.put(`/providers/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provider', id] });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast.success('Status updated');
    },
    onError: () => {
      toast.error('Failed to update status');
    },
  });

  const deleteLicenseMutation = useDeleteLicense();
  const deleteCertMutation = useDeleteCertification();

  // New delete mutations
  const deleteEducationMutation = useDeleteEducation();
  const deleteWorkHistoryMutation = useDeleteWorkHistory();
  const deleteWorkHistoryGapMutation = useDeleteWorkHistoryGap();
  const deleteHospitalAffiliationMutation = useDeleteHospitalAffiliation();
  const deleteMalpracticeInsuranceMutation = useDeleteMalpracticeInsurance();
  const deleteSupervisingPhysicianMutation = useDeleteSupervisingPhysician();
  const deleteMalpracticeClaimMutation = useDeleteMalpracticeClaim();
  const deleteDisclosureMutation = useDeleteDisclosure();
  const deleteDeaRegistrationMutation = useDeleteDeaRegistration();
  const deleteCdsRegistrationMutation = useDeleteCdsRegistration();
  const deleteLifeSupportCertMutation = useDeleteProviderCertification();
  const deleteProviderIdentifierMutation = useDeleteProviderIdentifier();
  const deleteBankingMutation = useDeleteBanking();

  // CAQH pull mutation
  const caqhPullMutation = useMutation({
    mutationFn: async (body: { caqhProviderId?: string; npi?: string }) => {
      const response = await api.post(`/providers/${id}/caqh-pull`, body);
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['provider', id] });
      const s = data.summary;
      const parts: string[] = [];
      const pushIf = (count: number, singular: string, plural?: string) => {
        if (count <= 0) return;
        const word = count === 1 ? singular : (plural ?? `${singular}s`);
        parts.push(`${count} ${word}`);
      };
      pushIf(s.licenses.created + s.licenses.updated, 'license');
      pushIf(s.certifications.created + s.certifications.updated, 'certification');
      pushIf(s.education.created + s.education.updated, 'education record');
      pushIf(s.malpractice.created + s.malpractice.updated, 'malpractice policy', 'malpractice policies');
      // Phase 2 — v9 full coverage
      pushIf((s.disclosures?.created ?? 0) + (s.disclosures?.updated ?? 0), 'disclosure');
      pushIf((s.malpracticeClaims?.created ?? 0) + (s.malpracticeClaims?.updated ?? 0), 'malpractice claim');
      pushIf((s.hospitalAffiliations?.created ?? 0) + (s.hospitalAffiliations?.updated ?? 0), 'hospital affiliation');
      pushIf((s.workHistory?.created ?? 0) + (s.workHistory?.updated ?? 0), 'work history record');
      pushIf((s.workHistoryGaps?.created ?? 0) + (s.workHistoryGaps?.updated ?? 0), 'work history gap');
      pushIf((s.practiceSupervisors?.created ?? 0) + (s.practiceSupervisors?.updated ?? 0), 'supervisor');
      toast.success(parts.length > 0 ? `Imported ${parts.join(', ')}` : 'CAQH sync complete — no new data to import');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.error || 'CAQH pull failed';
      toast.error(msg);
    },
  });

  // Location handlers
  const handleAddLocation = () => {
    setEditingLocation(null);
    setLocationModalOpen(true);
  };

  const handleEditLocation = (location: any) => {
    setEditingLocation(location);
    setLocationModalOpen(true);
  };

  const handleDeleteLocation = (locationId: string) => {
    showConfirm('Delete Location', 'Are you sure you want to delete this practice location?', () => {
      deleteLocationMutation.mutate(locationId);
      closeConfirm();
    });
  };

  // License handlers
  const handleAddLicense = () => {
    setEditingLicense(null);
    setLicenseModalOpen(true);
  };

  const openLicenseEditor = (license: any) => {
    setEditingLicense(license);
    setLicenseModalOpen(true);
  };

  const handleEditLicense = (license: any) => {
    if (license?.source === 'caqh_sync') {
      setCaqhWarning({
        recordType: 'license',
        proceed: () => { setCaqhWarning(null); openLicenseEditor(license); },
      });
      return;
    }
    openLicenseEditor(license);
  };

  const handleDeleteLicense = (licenseId: string) => {
    showConfirm('Delete License', 'Are you sure you want to delete this license?', () => {
      deleteLicenseMutation.mutate({ licenseId, providerId: id! });
      closeConfirm();
    });
  };

  // Certification handlers
  const handleAddCert = () => {
    setEditingCert(null);
    setCertModalOpen(true);
  };

  const openCertEditor = (cert: any) => {
    setEditingCert(cert);
    setCertModalOpen(true);
  };

  const handleEditCert = (cert: any) => {
    if (cert?.source === 'caqh_sync') {
      setCaqhWarning({
        recordType: 'certification',
        proceed: () => { setCaqhWarning(null); openCertEditor(cert); },
      });
      return;
    }
    openCertEditor(cert);
  };

  const handleDeleteCert = (certId: string) => {
    showConfirm('Delete Certification', 'Are you sure you want to delete this certification?', () => {
      deleteCertMutation.mutate({ certificationId: certId, providerId: id! });
      closeConfirm();
    });
  };

  // Education handlers
  const handleAddEducation = () => { setEditingEducation(null); setEducationModalOpen(true); };
  const handleEditEducation = (edu: any) => { setEditingEducation(edu); setEducationModalOpen(true); };
  const handleDeleteEducation = (eduId: string) => {
    showConfirm('Delete Education', 'Are you sure you want to delete this education record?', () => {
      deleteEducationMutation.mutate({ id: eduId, providerId: id! });
      closeConfirm();
    });
  };

  // Work history handlers
  const handleAddWorkHistory = () => { setEditingWorkHistory(null); setWorkHistoryModalOpen(true); };
  const handleEditWorkHistory = (wh: any) => { setEditingWorkHistory(wh); setWorkHistoryModalOpen(true); };
  const handleDeleteWorkHistory = (whId: string) => {
    showConfirm('Delete Work History', 'Are you sure you want to delete this work history record?', () => {
      deleteWorkHistoryMutation.mutate({ id: whId, providerId: id! });
      closeConfirm();
    });
  };
  const handleDeleteWorkHistoryGap = (gapId: string) => {
    showConfirm('Delete Employment Gap', 'Are you sure you want to delete this employment gap record?', () => {
      deleteWorkHistoryGapMutation.mutate({ id: gapId, providerId: id! });
      closeConfirm();
    });
  };
  const handleAddWorkHistoryGap = () => { setEditingWorkHistoryGap(null); setWorkHistoryGapModalOpen(true); };
  const handleEditWorkHistoryGap = (g: any) => { setEditingWorkHistoryGap(g); setWorkHistoryGapModalOpen(true); };
  const handleAddHospitalAffiliation = () => { setEditingHospitalAffiliation(null); setHospitalAffiliationModalOpen(true); };
  const handleEditHospitalAffiliation = (ha: any) => { setEditingHospitalAffiliation(ha); setHospitalAffiliationModalOpen(true); };
  const handleDeleteHospitalAffiliation = (haId: string) => {
    showConfirm('Delete Hospital Affiliation', 'Are you sure you want to delete this hospital affiliation record?', () => {
      deleteHospitalAffiliationMutation.mutate({ id: haId, providerId: id! });
      closeConfirm();
    });
  };

  // Malpractice insurance handlers
  const handleAddMalpracticeInsurance = () => { setEditingMalpracticeInsurance(null); setMalpracticeInsuranceModalOpen(true); };
  const handleEditMalpracticeInsurance = (ins: any) => { setEditingMalpracticeInsurance(ins); setMalpracticeInsuranceModalOpen(true); };
  const handleDeleteMalpracticeInsurance = (insId: string) => {
    showConfirm('Delete Malpractice Insurance', 'Are you sure you want to delete this malpractice insurance record?', () => {
      deleteMalpracticeInsuranceMutation.mutate({ id: insId, providerId: id! });
      closeConfirm();
    });
  };

  // Supervising physician handlers
  const handleAddSupervisingPhysician = () => { setEditingSupervisingPhysician(null); setSupervisingPhysicianModalOpen(true); };
  const handleEditSupervisingPhysician = (sp: any) => { setEditingSupervisingPhysician(sp); setSupervisingPhysicianModalOpen(true); };
  const handleDeleteSupervisingPhysician = (spId: string) => {
    showConfirm('Delete Supervising Physician', 'Are you sure you want to delete this supervising physician record?', () => {
      deleteSupervisingPhysicianMutation.mutate({ id: spId, providerId: id! });
      closeConfirm();
    });
  };

  // Malpractice claim handlers
  const handleAddMalpracticeClaim = () => { setEditingMalpracticeClaim(null); setMalpracticeClaimModalOpen(true); };
  const handleEditMalpracticeClaim = (mc: any) => { setEditingMalpracticeClaim(mc); setMalpracticeClaimModalOpen(true); };
  const handleDeleteMalpracticeClaim = (mcId: string) => {
    showConfirm('Delete Malpractice Claim', 'Are you sure you want to delete this malpractice claim record?', () => {
      deleteMalpracticeClaimMutation.mutate({ id: mcId, providerId: id! });
      closeConfirm();
    });
  };

  // Disclosure handlers
  const handleAddDisclosure = () => { setEditingDisclosure(null); setDisclosureModalOpen(true); };
  const handleEditDisclosure = (d: any) => { setEditingDisclosure(d); setDisclosureModalOpen(true); };
  const handleDeleteDisclosure = (dId: string) => {
    showConfirm('Delete Disclosure', 'Are you sure you want to delete this disclosure?', () => {
      deleteDisclosureMutation.mutate({ id: dId, providerId: id! });
      closeConfirm();
    });
  };

  // DEA registration handlers
  const handleAddDeaRegistration = () => { setEditingDeaRegistration(null); setDeaRegistrationModalOpen(true); };
  const handleEditDeaRegistration = (dea: any) => { setEditingDeaRegistration(dea); setDeaRegistrationModalOpen(true); };
  const handleDeleteDeaRegistration = (deaId: string) => {
    showConfirm('Delete DEA Registration', 'Are you sure you want to delete this DEA registration?', () => {
      deleteDeaRegistrationMutation.mutate({ id: deaId, providerId: id! });
      closeConfirm();
    });
  };

  // CDS registration handlers
  const handleAddCdsRegistration = () => { setEditingCdsRegistration(null); setCdsRegistrationModalOpen(true); };
  const handleEditCdsRegistration = (cds: any) => { setEditingCdsRegistration(cds); setCdsRegistrationModalOpen(true); };
  const handleDeleteCdsRegistration = (cdsId: string) => {
    showConfirm('Delete CDS Registration', 'Are you sure you want to delete this CDS registration?', () => {
      deleteCdsRegistrationMutation.mutate({ id: cdsId, providerId: id! });
      closeConfirm();
    });
  };

  // Life-Support certification handlers
  const handleAddLifeSupportCert = () => { setEditingLifeSupportCert(null); setLifeSupportCertModalOpen(true); };
  const handleEditLifeSupportCert = (c: any) => { setEditingLifeSupportCert(c); setLifeSupportCertModalOpen(true); };
  const handleDeleteLifeSupportCert = (cId: string) => {
    showConfirm('Delete Certification', 'Are you sure you want to delete this certification?', () => {
      deleteLifeSupportCertMutation.mutate({ id: cId, providerId: id! });
      closeConfirm();
    });
  };

  // Provider identifier handlers
  const handleAddProviderIdentifier = () => { setEditingProviderIdentifier(null); setProviderIdentifierModalOpen(true); };
  const handleEditProviderIdentifier = (pi: any) => { setEditingProviderIdentifier(pi); setProviderIdentifierModalOpen(true); };
  const handleDeleteProviderIdentifier = (piId: string) => {
    showConfirm('Delete Identifier', 'Are you sure you want to delete this provider identifier?', () => {
      deleteProviderIdentifierMutation.mutate({ id: piId, providerId: id! });
      closeConfirm();
    });
  };

  // Banking handlers
  const handleAddBanking = () => { setEditingBanking(null); setBankingModalOpen(true); };
  const handleEditBanking = (b: any) => { setEditingBanking(b); setBankingModalOpen(true); };
  const handleDeleteBanking = (bId: string) => {
    showConfirm('Delete Banking Info', 'Are you sure you want to delete this banking record?', () => {
      deleteBankingMutation.mutate({ id: bId, providerId: id! });
      closeConfirm();
    });
  };

  const exportToCSV = () => {
    if (!provider) return;

    const rows = [
      ['Provider Information'],
      ['Field', 'Value'],
      ['NPI', provider.npi],
      ['First Name', provider.firstName],
      ['Last Name', provider.lastName],
      ['Middle Name', provider.middleName || ''],
      ['Suffix', provider.suffix || ''],
      ['Email', provider.email],
      ['Phone', provider.phone],
      ['Mobile Phone', provider.mobilePhone || ''],
      ['Date of Birth', format(new Date(provider.dateOfBirth), 'yyyy-MM-dd')],
      ['Gender', provider.gender],
      ['Provider Type', provider.providerType],
      ['Status', provider.status],
      ['Taxonomy', provider.taxonomy || ''],
      ['CAQH Provider ID', provider.caqhProviderId || ''],
      ['CAQH Status', provider.caqhStatus || ''],
      [],
      ['Licenses'],
      ['Type', 'State', 'License Number', 'Issue Date', 'Expiration Date', 'Status'],
    ];

    provider.licenses?.forEach((license: any) => {
      rows.push([
        license.licenseType,
        license.state,
        license.licenseNumber,
        license.issueDate ? format(new Date(license.issueDate), 'yyyy-MM-dd') : '',
        license.expirationDate ? format(new Date(license.expirationDate), 'yyyy-MM-dd') : '',
        license.status,
      ]);
    });

    rows.push([]);
    rows.push(['Board Certifications']);
    rows.push(['Board Name', 'Specialty', 'Certification Number', 'Initial Date', 'Expiration Date', 'Status']);

    provider.boardCertifications?.forEach((cert: any) => {
      rows.push([
        cert.boardName,
        cert.specialty,
        cert.certificationNumber || '',
        cert.initialDate ? format(new Date(cert.initialDate), 'yyyy-MM-dd') : '',
        cert.expirationDate ? format(new Date(cert.expirationDate), 'yyyy-MM-dd') : '',
        cert.status,
      ]);
    });

    const csvContent = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `provider_${provider.npi}_${format(new Date(), 'yyyyMMdd')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success('CSV exported successfully');
  };

  const exportToPDF = async () => {
    if (!provider) return;

    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
    doc.setFontSize(20);
    doc.setTextColor(37, 99, 235);
    doc.text('Provider Credential Report', pageWidth / 2, 20, { align: 'center' });

    // Provider name
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text(`${provider.firstName} ${provider.lastName}${provider.suffix ? `, ${provider.suffix}` : ''}`, pageWidth / 2, 30, { align: 'center' });

    // Generated date
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${format(new Date(), 'MMMM d, yyyy')}`, pageWidth / 2, 38, { align: 'center' });

    let yPos = 50;

    // Personal Information
    doc.setFontSize(14);
    doc.setTextColor(37, 99, 235);
    doc.text('Personal Information', 14, yPos);
    yPos += 5;

    autoTable(doc, {
      startY: yPos,
      head: [['Field', 'Value']],
      body: [
        ['NPI', provider.npi],
        ['Email', provider.email],
        ['Phone', provider.phone],
        ['Mobile Phone', provider.mobilePhone || 'N/A'],
        ['Date of Birth', format(new Date(provider.dateOfBirth), 'MMMM d, yyyy')],
        ['Gender', provider.gender.replace('_', ' ')],
        ['Provider Type', provider.providerType.replace('_', ' ')],
        ['Status', provider.status],
        ['Taxonomy', provider.taxonomy || 'N/A'],
      ],
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235] },
      margin: { left: 14, right: 14 },
    });

    yPos = (doc as any).lastAutoTable.finalY + 15;

    // Licenses
    if (provider.licenses?.length > 0) {
      doc.setFontSize(14);
      doc.setTextColor(37, 99, 235);
      doc.text('Licenses', 14, yPos);
      yPos += 5;

      autoTable(doc, {
        startY: yPos,
        head: [['Type', 'State', 'License #', 'Expiration', 'Status']],
        body: provider.licenses.map((license: any) => [
          license.licenseType.replace('_', ' '),
          license.state,
          license.licenseNumber,
          license.expirationDate ? format(new Date(license.expirationDate), 'MMM d, yyyy') : 'N/A',
          license.status,
        ]),
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235] },
        margin: { left: 14, right: 14 },
      });

      yPos = (doc as any).lastAutoTable.finalY + 15;
    }

    // Board Certifications
    if (provider.boardCertifications?.length > 0) {
      if (yPos > 240) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(14);
      doc.setTextColor(37, 99, 235);
      doc.text('Board Certifications', 14, yPos);
      yPos += 5;

      autoTable(doc, {
        startY: yPos,
        head: [['Board', 'Specialty', 'Expiration', 'Status']],
        body: provider.boardCertifications.map((cert: any) => [
          cert.boardName,
          cert.specialty,
          cert.expirationDate ? format(new Date(cert.expirationDate), 'MMM d, yyyy') : 'N/A',
          cert.status,
        ]),
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235] },
        margin: { left: 14, right: 14 },
      });
    }

    // CAQH Information
    if (provider.caqhProviderId) {
      yPos = (doc as any).lastAutoTable.finalY + 15;

      if (yPos > 250) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(14);
      doc.setTextColor(37, 99, 235);
      doc.text('CAQH ProView', 14, yPos);
      yPos += 5;

      autoTable(doc, {
        startY: yPos,
        head: [['Field', 'Value']],
        body: [
          ['CAQH Provider ID', provider.caqhProviderId],
          ['CAQH Status', provider.caqhStatus || 'Unknown'],
          ['Last Synced', provider.caqhLastSync ? format(new Date(provider.caqhLastSync), 'MMM d, yyyy') : 'Never'],
        ],
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235] },
        margin: { left: 14, right: 14 },
      });
    }

    // Footer
    const pageCount = doc.internal.pages.length - 1;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${i} of ${pageCount} | Confidential - Healthcare Credentialing Data`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    doc.save(`provider_${provider.npi}_${format(new Date(), 'yyyyMMdd')}.pdf`);
    toast.success('PDF exported successfully');
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Header skeleton */}
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-gray-200" />
          <div className="space-y-2">
            <div className="h-5 w-48 bg-gray-200 rounded" />
            <div className="h-4 w-32 bg-gray-200 rounded" />
          </div>
        </div>
        {/* Tab bar skeleton */}
        <div className="flex gap-4 border-b border-gray-200 pb-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-4 w-20 bg-gray-200 rounded" />
          ))}
        </div>
        {/* Card grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-4 space-y-3">
              <div className="h-4 w-24 bg-gray-200 rounded" />
              <div className="h-4 w-full bg-gray-200 rounded" />
              <div className="h-4 w-3/4 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorState
          title="Couldn't load provider"
          message="Check your connection and try again."
          onRetry={() => refetch()}
        />
        <Link to="/providers" className="text-primary-600 hover:underline inline-block">
          Back to providers
        </Link>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Provider not found</p>
        <Link to="/providers" className="text-primary-600 hover:underline mt-2 inline-block">
          Back to providers
        </Link>
      </div>
    );
  }

  // Compute credential completeness score (0-100)
  const completenessScore = (() => {
    let score = 0;
    if (provider.licenses?.length > 0) score += 20;
    if (provider.boardCertifications?.length > 0) score += 15;
    if ((educationList?.length || 0) > 0) score += 12;
    if ((workHistoryList?.length || 0) > 0) score += 8;
    if ((malpracticeInsuranceList?.length || 0) > 0) score += 15;
    if ((deaRegistrationsList?.length || 0) > 0) score += 10;
    if (provider.practiceLocations?.length > 0) score += 10;
    if (provider.documents?.length > 0) score += 5;
    if (provider.taxonomy) score += 5;
    return score;
  })();

  const primaryLocation = provider.practiceLocations?.find((l: any) => l.isPrimary) || provider.practiceLocations?.[0];
  const maskedTaxId = primaryLocation?.taxId ? `****${primaryLocation.taxId.slice(-4)}` : null;

  return (
    <PageTransition>
    <div>
      {/* Hero Header */}
      <div className="card overflow-hidden mb-6">
        <div className="h-20 bg-gradient-to-r from-primary-800 via-primary-600 to-emerald-500" />
        <div className="px-6 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between -mt-8">
            <div className="flex items-start gap-4">
              <div className="h-16 w-16 rounded-2xl bg-white shadow-lg border-2 border-white flex items-center justify-center ring-1 ring-gray-200/60 shrink-0">
                <span className="text-primary-600 text-xl font-bold tracking-tight">
                  {provider.firstName[0]}{provider.lastName[0]}
                </span>
              </div>
              <div className="pt-9">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                    {provider.firstName} {provider.lastName}
                    {provider.suffix && `, ${provider.suffix}`}
                  </h1>
                  <RefreshIndicator isFetching={isFetching && !isLoading} />
                  {canEditStatus ? (
                    <Menu as="div" className="relative">
                      <Menu.Button
                        disabled={statusMutation.isPending}
                        title="Change status"
                        className={clsx(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold disabled:opacity-60',
                          provider.status === 'active' && 'bg-green-100 text-green-700 hover:bg-green-200',
                          provider.status === 'inactive' && 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                          provider.status === 'pending' && 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                        )}
                      >
                        {provider.status}
                        <ChevronDownIcon className="h-3 w-3" />
                      </Menu.Button>
                      <Transition
                        as={Fragment}
                        enter="transition ease-out duration-100"
                        enterFrom="transform opacity-0 scale-95"
                        enterTo="transform opacity-100 scale-100"
                        leave="transition ease-in duration-75"
                        leaveFrom="transform opacity-100 scale-100"
                        leaveTo="transform opacity-0 scale-95"
                      >
                        <Menu.Items className="absolute left-0 z-10 mt-2 w-32 origin-top-left rounded-xl bg-white shadow-lg ring-1 ring-black/5 focus:outline-none">
                          <div className="py-1">
                            {(['active', 'pending', 'inactive'] as const).map((s) => (
                              <Menu.Item key={s}>
                                {({ active }) => (
                                  <button
                                    onClick={() => { if (s !== provider.status) statusMutation.mutate(s); }}
                                    className={clsx(
                                      active ? 'bg-gray-50' : '',
                                      s === provider.status ? 'font-semibold text-primary-700' : 'text-gray-700',
                                      'block w-full text-left px-4 py-2 text-sm capitalize'
                                    )}
                                  >
                                    {s}
                                  </button>
                                )}
                              </Menu.Item>
                            ))}
                          </div>
                        </Menu.Items>
                      </Transition>
                    </Menu>
                  ) : (
                    <span className={clsx(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
                      provider.status === 'active' && 'bg-green-100 text-green-700',
                      provider.status === 'inactive' && 'bg-gray-100 text-gray-600',
                      provider.status === 'pending' && 'bg-amber-100 text-amber-700'
                    )}>
                      {provider.status}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  NPI: {provider.npi} &middot; {provider.providerType.replace('_', ' ')}
                  {provider.taxonomy && ` \u00B7 ${provider.taxonomy}`}
                  {primaryLocation?.groupNpi && ` \u00B7 Group: ${primaryLocation.groupNpi}`}
                  {maskedTaxId && ` \u00B7 Tax ID: ${maskedTaxId}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 sm:mt-10">
              <Link to={`/providers/${id}/edit`} className="btn-secondary text-sm">
                <PencilIcon className="-ml-0.5 mr-1.5 h-4 w-4" />
                Edit
              </Link>
              {canSoftDelete && (
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(true)}
                  disabled={deleteProvider.isPending}
                  className="btn-secondary text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                  title="Delete provider (archive — retained for records, restorable)"
                >
                  <ArchiveBoxXMarkIcon className="-ml-0.5 mr-1.5 h-4 w-4" />
                  Delete
                </button>
              )}
              <Menu as="div" className="relative">
                <Menu.Button className="btn-primary text-sm inline-flex items-center">
                  <DocumentArrowDownIcon className="-ml-0.5 mr-1.5 h-4 w-4" />
                  Export
                  <ChevronDownIcon className="ml-1.5 -mr-0.5 h-3.5 w-3.5" />
                </Menu.Button>
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Menu.Items className="absolute right-0 z-10 mt-2 w-40 origin-top-right rounded-xl bg-white shadow-lg ring-1 ring-black/5 focus:outline-none">
                    <div className="py-1">
                      <Menu.Item>
                        {({ active }) => (
                          <button onClick={exportToCSV} className={clsx(active ? 'bg-gray-50' : '', 'block w-full text-left px-4 py-2 text-sm text-gray-700')}>
                            Export as CSV
                          </button>
                        )}
                      </Menu.Item>
                      <Menu.Item>
                        {({ active }) => (
                          <button onClick={exportToPDF} className={clsx(active ? 'bg-gray-50' : '', 'block w-full text-left px-4 py-2 text-sm text-gray-700')}>
                            Export as PDF
                          </button>
                        )}
                      </Menu.Item>
                    </div>
                  </Menu.Items>
                </Transition>
              </Menu>
            </div>
          </div>

          {/* Stats Row with Completeness Gauge */}
          <div className="mt-5 pt-5 border-t border-gray-100 flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-3">
              <HealthScoreGauge score={completenessScore} size={52} strokeWidth={5} label="Complete" />
              <div>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Credential Health</p>
                <p className="text-lg font-bold text-gray-900 -mt-0.5">{completenessScore}%</p>
              </div>
            </div>
            {[
              { label: 'Licenses', value: provider.licenses?.length || 0 },
              { label: 'Certifications', value: provider.boardCertifications?.length || 0 },
              { label: 'Enrollments', value: provider.enrollments?.length || 0 },
              { label: 'Documents', value: provider.documents?.length || 0 },
            ].map((stat) => (
              <Fragment key={stat.label}>
                <div className="h-8 w-px bg-gray-200 hidden sm:block" />
                <div>
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{stat.label}</p>
                  <p className="text-lg font-bold text-gray-900 -mt-0.5">{stat.value}</p>
                </div>
              </Fragment>
            ))}
          </div>

          {/* Next Step Banner */}
          {completenessScore < 100 && (() => {
            const missingItems: { label: string; action: () => void }[] = [];
            if (!provider.licenses?.length) missingItems.push({ label: 'a license', action: handleAddLicense });
            if (!provider.boardCertifications?.length) missingItems.push({ label: 'board certification', action: handleAddCert });
            if (!(malpracticeInsuranceList?.length)) missingItems.push({ label: 'malpractice insurance', action: handleAddMalpracticeInsurance });
            if (!(educationList?.length)) missingItems.push({ label: 'education', action: handleAddEducation });
            if (!(deaRegistrationsList?.length)) missingItems.push({ label: 'DEA registration', action: handleAddDeaRegistration });
            if (!provider.practiceLocations?.length) missingItems.push({ label: 'a practice location', action: handleAddLocation });
            if (!provider.documents?.length) missingItems.push({ label: 'documents', action: () => { setUploadDocumentType(''); setUploadModalOpen(true); } });
            if (!provider.taxonomy) missingItems.push({ label: 'taxonomy code', action: () => setActiveTab(0) });
            if (missingItems.length === 0) return null;
            const targetScore = Math.min(100, completenessScore + (missingItems.length >= 2 ? 30 : 15));
            return (
              <div className="mt-4 border-l-4 border-primary-400 bg-primary-50/50 rounded-lg p-3 animate-fade-in">
                <p className="text-sm text-primary-800">
                  Complete your profile — add{' '}
                  <button onClick={missingItems[0].action} className="font-medium underline underline-offset-2 hover:text-primary-600">{missingItems[0].label}</button>
                  {missingItems.length > 1 && (
                    <>
                      {' '}and{' '}
                      <button onClick={missingItems[1].action} className="font-medium underline underline-offset-2 hover:text-primary-600">{missingItems[1].label}</button>
                    </>
                  )}
                  {' '}to reach {targetScore}%
                </p>
              </div>
            );
          })()}
        </div>
      </div>

      {/* CAQH Pull Section */}
      <div className="card mb-6 animate-fade-in">
        <div className="card-header">
          <h2 className="text-base font-semibold text-gray-900">Import from CAQH</h2>
          {provider.caqhLastSync && (
            <span className="text-xs text-gray-400">Last synced: {format(new Date(provider.caqhLastSync), 'MMM d, yyyy h:mm a')}</span>
          )}
        </div>
        <div className="card-body space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="caqhId" className="block text-sm font-medium text-gray-700 mb-1">CAQH Provider ID</label>
              <input
                id="caqhId"
                type="text"
                className="input"
                placeholder="e.g. 12345678"
                value={caqhInputId}
                onChange={(e) => setCaqhInputId(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="caqhNpi" className="block text-sm font-medium text-gray-700 mb-1">NPI Number</label>
              <input
                id="caqhNpi"
                type="text"
                className="input"
                placeholder="e.g. 1234567890"
                value={caqhInputNpi}
                onChange={(e) => setCaqhInputNpi(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={caqhPullMutation.isPending || (!caqhInputId.trim() && !caqhInputNpi.trim())}
              onClick={() => {
                caqhPullMutation.mutate({
                  ...(caqhInputId.trim() && { caqhProviderId: caqhInputId.trim() }),
                  ...(caqhInputNpi.trim() && { npi: caqhInputNpi.trim() }),
                });
              }}
            >
              {caqhPullMutation.isPending ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-0.5 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Importing…
                </span>
              ) : 'Import from CAQH'}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            CAQH data fills empty fields and creates new credential records. Manually entered data is preserved.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tab.Group selectedIndex={activeTab} onChange={setActiveTab}>
        <Tab.List className="flex space-x-1 bg-gray-100/80 rounded-xl p-1 mb-6">
          {TABS.map((tab) => (
            <Tab
              key={tab.name}
              className={({ selected }) =>
                clsx(
                  'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all focus:outline-none',
                  selected
                    ? 'bg-white text-primary-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                )
              }
            >
              <tab.icon className="h-4 w-4" />
              {tab.name}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels>
          {/* ===== PROFILE TAB ===== */}
          <Tab.Panel>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
              <div className="lg:col-span-2 space-y-6">

                {/* Personal Information — card grid instead of accordion */}
                <div className="card animate-fade-in">
                  <div className="card-header">
                    <h2 className="text-base font-semibold text-gray-900">Personal Information</h2>
                  </div>
                  <div className="card-body">
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                      {[
                        { label: 'Email', value: provider.email },
                        { label: 'Phone', value: provider.phone },
                        { label: 'Mobile', value: provider.mobilePhone || '\u2014' },
                        { label: 'Date of Birth', value: provider.dateOfBirth ? format(new Date(provider.dateOfBirth), 'MMMM d, yyyy') : '\u2014' },
                        { label: 'Gender', value: provider.gender?.replace('_', ' ') },
                        { label: 'Provider Type', value: provider.providerType?.replace('_', ' ') },
                      ].map((field) => (
                        <div key={field.label}>
                          <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider">{field.label}</dt>
                          <dd className="mt-1 text-sm text-gray-900 capitalize">{field.value}</dd>
                        </div>
                      ))}
                      {/* SSN — hidden by default; revealing it is logged (SOC 2). */}
                      {provider.hasSsn && (
                        <div>
                          <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider">SSN</dt>
                          <dd className="mt-1 text-sm text-gray-900">
                            <RevealableSecret masked="•••-••-••••" reveal={() => revealProviderSsn(provider.id)} label="SSN" />
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                </div>

                {/* CAQH Data — populated from CAQH sync (read-only) */}
                {(provider.primaryPracticeState || provider.otherPracticeState ||
                  provider.hospitalBasedFlag !== null || provider.fellowshipTrainingFlag !== null ||
                  provider.ecfmgFlag !== null || provider.activeMilitaryFlag !== null ||
                  provider.workHistoryGapFlag !== null || provider.secondarySpecialtyFlag !== null ||
                  provider.hospitalPrivilegeFlag !== null) && (
                  <div className="card animate-fade-in">
                    <div className="card-header flex items-center justify-between">
                      <h2 className="text-base font-semibold text-gray-900">CAQH Data</h2>
                      <span className="text-xs text-gray-400">Read-only · auto-synced</span>
                    </div>
                    <div className="card-body">
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                        {[
                          { label: 'Primary Practice State', value: provider.primaryPracticeState || '\u2014' },
                          { label: 'Other Practice States', value: provider.otherPracticeState || '\u2014' },
                          { label: 'Hospital-Based', value: provider.hospitalBasedFlag == null ? '\u2014' : provider.hospitalBasedFlag ? 'Yes' : 'No' },
                          { label: 'Hospital Privileges', value: provider.hospitalPrivilegeFlag == null ? '\u2014' : provider.hospitalPrivilegeFlag ? 'Yes' : 'No' },
                          { label: 'Fellowship Training', value: provider.fellowshipTrainingFlag == null ? '\u2014' : provider.fellowshipTrainingFlag ? 'Yes' : 'No' },
                          { label: 'Secondary Specialty', value: provider.secondarySpecialtyFlag == null ? '\u2014' : provider.secondarySpecialtyFlag ? 'Yes' : 'No' },
                          { label: 'Active Military', value: provider.activeMilitaryFlag == null ? '\u2014' : provider.activeMilitaryFlag ? 'Yes' : 'No' },
                          { label: 'Work History Gap', value: provider.workHistoryGapFlag == null ? '\u2014' : provider.workHistoryGapFlag ? 'Yes' : 'No' },
                          { label: 'ECFMG', value: provider.ecfmgFlag == null ? '\u2014' : provider.ecfmgFlag ? `Yes${provider.ecfmgNumber ? ` · ${provider.ecfmgNumber}` : ''}` : 'No' },
                        ].map((field) => (
                          <div key={field.label}>
                            <dt className="text-xs font-medium text-gray-400 uppercase tracking-wider">{field.label}</dt>
                            <dd className="mt-1 text-sm text-gray-900">{field.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>
                )}

                {/* Addresses — populated from CAQH sync (read-only) */}
                {provider.addresses && provider.addresses.length > 0 && (
                  <div className="card animate-fade-in">
                    <div className="card-header flex items-center justify-between">
                      <h2 className="text-base font-semibold text-gray-900">Addresses</h2>
                      <span className="text-xs text-gray-400">{provider.addresses.length} on file</span>
                    </div>
                    <div className="card-body">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {provider.addresses.map((addr: any) => (
                          <div key={addr.id} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-semibold text-primary-700 uppercase tracking-wider">{addr.type}</span>
                              {addr.isPrimary && <span className="badge-primary text-[10px]">Primary</span>}
                            </div>
                            <p className="text-sm text-gray-900">{addr.addressLine1}</p>
                            {addr.addressLine2 && <p className="text-sm text-gray-900">{addr.addressLine2}</p>}
                            <p className="text-sm text-gray-600">{addr.city}, {addr.state} {addr.zipCode}</p>
                            {addr.country && addr.country !== 'US' && (
                              <p className="text-xs text-gray-500">{addr.country}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Practice Locations */}
                <CollapsibleSection
                  title="Practice Locations"
                  defaultOpen
                  count={provider.practiceLocations?.length || 0}
                  onAdd={handleAddLocation}
                  addLabel="Add Location"
                >
                  {!provider.practiceLocations || provider.practiceLocations.length === 0 ? (
                    <div className="text-center py-6">
                      <MapPinIcon className="mx-auto h-10 w-10 text-gray-300" />
                      <p className="mt-2 text-sm text-gray-500">No practice locations added yet.</p>
                      <button onClick={handleAddLocation} className="mt-2 text-sm text-primary-600 hover:text-primary-500">
                        Add your first location
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {provider.practiceLocations.map((location: any) => (
                        <div key={location.id} className="group relative p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-primary-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900 truncate">{location.locationName}</p>
                                {location.isPrimary && (
                                  <span className="badge-primary text-[10px]">Primary</span>
                                )}
                                {!location.isActive && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">Inactive</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 capitalize mt-0.5">{location.locationType}</p>
                              <p className="text-sm text-gray-600 mt-1">
                                {location.addressLine1}{location.addressLine2 && `, ${location.addressLine2}`}
                              </p>
                              <p className="text-sm text-gray-600">{location.city}, {location.state} {location.zipCode}</p>
                              {location.phone && <p className="text-xs text-gray-400 mt-1">{location.phone}</p>}
                              {location.acceptingNewPatients && (
                                <p className="text-[10px] text-green-600 font-medium mt-1">Accepting new patients</p>
                              )}
                            </div>
                            <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleEditLocation(location)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit location">
                                <PencilIcon className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => handleDeleteLocation(location.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete location">
                                <TrashIcon className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Education & Training */}
                <CollapsibleSection
                  title="Education & Training"
                  count={educationList?.length || 0}
                  onAdd={handleAddEducation}
                  addLabel="Add"
                >
                  {(!educationList || educationList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <AcademicCapIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No education records yet</p>
                      <p className="text-xs text-gray-400 mt-0.5">Add your first education record to get started</p>
                      <button onClick={handleAddEducation} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add education
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {educationList.map((edu: any) => (
                        <div key={edu.id} className="group flex items-start justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div className="flex gap-3">
                            <div className="mt-0.5 h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                              <AcademicCapIcon className="h-4 w-4 text-blue-600" />
                            </div>
                            <div>
                              <p className="font-medium text-sm text-gray-900">{edu.institutionName}</p>
                              <p className="text-xs text-gray-500">
                                {edu.degree?.toUpperCase()} in {edu.fieldOfStudy}
                                {edu.educationType && ` (${edu.educationType.replace('_', ' ')})`}
                              </p>
                              <p className="text-xs text-gray-400">
                                {edu.startDate ? format(new Date(edu.startDate), 'MMM yyyy') : ''}
                                {' \u2013 '}
                                {edu.endDate ? format(new Date(edu.endDate), 'MMM yyyy') : 'Present'}
                              </p>
                              {(edu.city || edu.state) && (
                                <p className="text-xs text-gray-400">
                                  {[edu.city, edu.state].filter(Boolean).join(', ')}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditEducation(edu)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit education">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteEducation(edu.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete education">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Work History */}
                <CollapsibleSection
                  title="Work History"
                  count={workHistoryList?.length || 0}
                  onAdd={handleAddWorkHistory}
                  addLabel="Add"
                >
                  {(!workHistoryList || workHistoryList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <BriefcaseIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No work history yet</p>
                      <p className="text-xs text-gray-400 mt-0.5">Add your first work history record to get started</p>
                      <button onClick={handleAddWorkHistory} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add work history
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {workHistoryList.map((wh: any) => {
                        const addressLine = [wh.addressLine1, wh.city, wh.state, wh.zipCode].filter(Boolean).join(', ');
                        const orgLine = [wh.organizationType, wh.department].filter(Boolean).join(' \u00b7 ');
                        return (
                        <div key={wh.id} className="group flex items-start justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div className="flex gap-3 flex-1 min-w-0">
                            <div className="mt-0.5 h-8 w-8 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                              <BriefcaseIcon className="h-4 w-4 text-purple-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm text-gray-900">{wh.organizationName}</p>
                                {wh.isCurrent && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">Current</span>
                                )}
                                {wh.workHistoryType && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                                    {wh.workHistoryType}
                                  </span>
                                )}
                                {wh.source && <SourceBadge source={wh.source} />}
                              </div>
                              <p className="text-xs text-gray-600">{wh.position}</p>
                              {orgLine && <p className="text-xs text-gray-500">{orgLine}</p>}
                              {addressLine && <p className="text-xs text-gray-400">{addressLine}</p>}
                              <p className="text-xs text-gray-400">
                                {wh.startDate ? format(new Date(wh.startDate), 'MMM yyyy') : ''}
                                {' \u2013 '}
                                {wh.isCurrent ? 'Present' : (wh.endDate ? format(new Date(wh.endDate), 'MMM yyyy') : '')}
                              </p>
                              {(wh.supervisorName || wh.supervisorPhone) && (
                                <p className="text-xs text-gray-400">
                                  Supervisor: {[wh.supervisorName, wh.supervisorPhone].filter(Boolean).join(' \u00b7 ')}
                                </p>
                              )}
                              {wh.phone && (
                                <p className="text-xs text-gray-400">Phone: {wh.phone}</p>
                              )}
                              {wh.statusDescription && (
                                <p className="text-xs text-gray-400">Status: {wh.statusDescription}</p>
                              )}
                              {wh.reasonForLeaving && (
                                <p className="text-xs text-gray-400">Reason for leaving: {wh.reasonForLeaving}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditWorkHistory(wh)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit work history">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteWorkHistory(wh.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete work history">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Employment Gaps (CAQH TimeGap) */}
                <CollapsibleSection
                  title="Employment Gaps"
                  count={workHistoryGapsList?.length || 0}
                  onAdd={handleAddWorkHistoryGap}
                  addLabel="Add"
                >
                  {(!workHistoryGapsList || workHistoryGapsList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <BriefcaseIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No employment gaps recorded</p>
                      <p className="text-xs text-gray-400 mt-0.5">Add manually or pull from CAQH</p>
                      <button onClick={handleAddWorkHistoryGap} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add gap
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {workHistoryGapsList.map((g: any) => (
                        <div key={g.id} className="group flex items-start justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm text-gray-900">
                                {format(new Date(g.startDate), 'MMM yyyy')} – {format(new Date(g.endDate), 'MMM yyyy')}
                              </p>
                              {g.gapDescription && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                                  {g.gapDescription}
                                </span>
                              )}
                              {g.source && <SourceBadge source={g.source} />}
                            </div>
                            {g.gapExplanation && (
                              <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{g.gapExplanation}</p>
                            )}
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditWorkHistoryGap(g)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit employment gap">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteWorkHistoryGap(g.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete employment gap">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Provider Identifiers */}
                <CollapsibleSection
                  title="Provider Identifiers"
                  count={providerIdentifiersList?.length || 0}
                  onAdd={handleAddProviderIdentifier}
                  addLabel="Add"
                >
                  {(!providerIdentifiersList || providerIdentifiersList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <DocumentTextIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No identifiers yet</p>
                      <p className="text-xs text-gray-400 mt-0.5">Add your first provider identifier to get started</p>
                      <button onClick={handleAddProviderIdentifier} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add identifier
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {providerIdentifiersList.map((pi: any) => (
                        <div key={pi.id} className="group flex items-start justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div>
                            <p className="font-medium text-sm text-gray-900">
                              {pi.identifierType === 'OTHER' && pi.notes ? pi.notes : pi.identifierType?.replace(/_/g, ' ')}
                            </p>
                            <p className="text-xs text-gray-500">
                              {pi.identifierValue}
                              {pi.issuingEntity && ` \u00B7 ${pi.issuingEntity}`}
                              {pi.state && ` \u00B7 ${pi.state}`}
                            </p>
                            {pi.expirationDate && (
                              <p className="text-xs text-gray-400">Expires: {format(new Date(pi.expirationDate), 'MMM d, yyyy')}</p>
                            )}
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditProviderIdentifier(pi)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit identifier">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteProviderIdentifier(pi.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete identifier">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Banking / EFT */}
                <CollapsibleSection
                  title="Banking / EFT"
                  count={bankingList?.length || 0}
                  onAdd={handleAddBanking}
                  addLabel="Add"
                >
                  {(!bankingList || bankingList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <BuildingOfficeIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No banking records yet</p>
                      <p className="text-xs text-gray-400 mt-0.5">Add your first banking record to get started</p>
                      <button onClick={handleAddBanking} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add banking info
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {bankingList.map((b: any) => (
                        <div key={b.id} className="group flex items-start justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm text-gray-900">{b.bankName}</p>
                              {b.isPrimary && <span className="badge-primary text-[10px]">Primary</span>}
                            </div>
                            <p className="text-xs text-gray-500">{b.bankAccountType} \u00B7 Acct: {b.accountNumberEncrypted}</p>
                            <p className="text-xs text-gray-400">Holder: {b.accountHolderName}</p>
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditBanking(b)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit banking info">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteBanking(b.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete banking info">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Hospital Affiliations */}
                <CollapsibleSection
                  title="Hospital Affiliations"
                  count={hospitalAffiliationsList?.length || 0}
                  onAdd={handleAddHospitalAffiliation}
                  addLabel="Add"
                >
                  {(!hospitalAffiliationsList || hospitalAffiliationsList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <BuildingOfficeIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No hospital affiliations on record</p>
                      <p className="text-xs text-gray-400 mt-0.5">Add manually or pull from CAQH</p>
                      <button onClick={handleAddHospitalAffiliation} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add affiliation
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {[...hospitalAffiliationsList].sort((a: any, b: any) => {
                        const aPrimary = a.privilegeType === 'admitting' || a.privilegeType === 'full' ? 1 : 0;
                        const bPrimary = b.privilegeType === 'admitting' || b.privilegeType === 'full' ? 1 : 0;
                        if (aPrimary !== bPrimary) return bPrimary - aPrimary;
                        const aDate = a.appointmentDate ? new Date(a.appointmentDate).getTime() : 0;
                        const bDate = b.appointmentDate ? new Date(b.appointmentDate).getTime() : 0;
                        return bDate - aDate;
                      }).map((ha: any) => (
                        <div key={ha.id} className="group flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div className="mt-0.5 h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                            <BuildingOfficeIcon className="h-4 w-4 text-blue-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm text-gray-900">{ha.facilityName}</p>
                              {ha.status && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">
                                  {String(ha.status).replace(/_/g, ' ')}
                                </span>
                              )}
                              {ha.privilegeType && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                                  {String(ha.privilegeType).replace(/_/g, ' ')}
                                </span>
                              )}
                              {ha.hasTemporaryPrivileges === true && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">Temporary</span>
                              )}
                              {ha.hasUnrestrictedPrivileges === true && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">Unrestricted</span>
                              )}
                              {ha.source && <SourceBadge source={ha.source} />}
                            </div>
                            {(ha.privilegeDescription || ha.department) && (
                              <p className="text-xs text-gray-600 mt-0.5">
                                {[ha.privilegeDescription, ha.department].filter(Boolean).join(' · ')}
                              </p>
                            )}
                            {(ha.appointmentDate || ha.startDate || ha.reappointmentDate || ha.endDate) && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                {(ha.appointmentDate || ha.startDate) && `${format(new Date(ha.appointmentDate || ha.startDate), 'MMM yyyy')}`}
                                {' – '}
                                {ha.endDate ? format(new Date(ha.endDate), 'MMM yyyy') : 'Present'}
                                {ha.admissionPercent !== null && ha.admissionPercent !== undefined && ` · ${ha.admissionPercent}% admissions`}
                              </p>
                            )}
                            {(ha.city || ha.state) && (
                              <p className="text-xs text-gray-400">
                                {[ha.city, ha.state].filter(Boolean).join(', ')}
                                {ha.caqhAhaId && ` · AHA #${ha.caqhAhaId}`}
                              </p>
                            )}
                            {(ha.whoAdmitsForYou || ha.admittingProviderFirstName) && (
                              <p className="text-xs text-gray-500 mt-0.5">
                                Admitter: {[ha.admittingProviderFirstName, ha.admittingProviderLastName].filter(Boolean).join(' ') || ha.whoAdmitsForYou}
                                {ha.admittingContactPhone && ` · ${ha.admittingContactPhone}`}
                              </p>
                            )}
                            {ha.reasonForDiscontinuance && (
                              <p className="text-xs text-gray-400">End reason: {ha.reasonForDiscontinuance}</p>
                            )}
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditHospitalAffiliation(ha)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit hospital affiliation">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteHospitalAffiliation(ha.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete hospital affiliation">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Professional References (read-only) */}
                <CollapsibleSection
                  title="Professional References"
                  count={professionalReferencesList?.length || 0}
                >
                  {(!professionalReferencesList || professionalReferencesList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <UsersIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No professional references on record</p>
                      <p className="text-xs text-gray-400 mt-0.5">Pull from CAQH to populate this section</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {professionalReferencesList.map((ref: any) => (
                        <div key={ref.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div className="mt-0.5 h-8 w-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                            <UsersIcon className="h-4 w-4 text-amber-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-gray-900">{ref.name}</p>
                            {(ref.relationship || ref.title) && (
                              <p className="text-xs text-gray-500">
                                {[ref.title, ref.relationship].filter(Boolean).join(' · ')}
                              </p>
                            )}
                            {(ref.email || ref.phone) && (
                              <p className="text-xs text-gray-400">
                                {[ref.email, ref.phone].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Covering Colleagues (read-only) */}
                <CollapsibleSection
                  title="Covering Colleagues"
                  count={coveringColleaguesList?.length || 0}
                >
                  {(!coveringColleaguesList || coveringColleaguesList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <UsersIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No covering colleagues on record</p>
                      <p className="text-xs text-gray-400 mt-0.5">Pull from CAQH to populate this section</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {coveringColleaguesList.map((cc: any) => (
                        <div key={cc.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div className="mt-0.5 h-8 w-8 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
                            <UsersIcon className="h-4 w-4 text-purple-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm text-gray-900">{cc.name}</p>
                              {cc.isCurrent && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
                                  Current
                                </span>
                              )}
                            </div>
                            {(cc.relationship || cc.specialty) && (
                              <p className="text-xs text-gray-500">
                                {[cc.specialty, cc.relationship].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Additional Demographics */}
                <CollapsibleSection title="Additional Demographics">
                  <DemographicsForm providerId={id!} />
                </CollapsibleSection>

                {/* Payer Submission Details (Aetna etc.) */}
                <CollapsibleSection title="Payer Submission Details">
                  <PayerSubmissionDetailsSection providerId={id!} />
                </CollapsibleSection>

                {/* Malpractice Claims */}
                <CollapsibleSection
                  title="Malpractice Claims"
                  count={malpracticeClaimsList?.length || 0}
                  onAdd={handleAddMalpracticeClaim}
                  addLabel="Add"
                >
                  {(!malpracticeClaimsList || malpracticeClaimsList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <DocumentTextIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No malpractice claims</p>
                      <p className="text-xs text-gray-400 mt-0.5">Claims will appear here when recorded</p>
                      <button onClick={handleAddMalpracticeClaim} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add claim
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {malpracticeClaimsList.map((mc: any) => (
                        <div key={mc.id} className="group flex items-start justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm text-gray-900">
                                Incident: {mc.dateOfIncident ? format(new Date(mc.dateOfIncident), 'MMM d, yyyy') : 'N/A'}
                              </p>
                              <span className={clsx(
                                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                                mc.claimStatus === 'DISMISSED' || mc.claimStatus === 'JUDGMENT_FOR_PROVIDER'
                                  ? 'bg-green-100 text-green-800'
                                  : mc.claimStatus === 'OPEN' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'
                              )}>{mc.claimStatus?.replace(/_/g, ' ')}</span>
                              {mc.isLeadDefendant === true && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700">
                                  Lead defendant
                                </span>
                              )}
                              {mc.npdbReported === true && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700" title="Reported to National Practitioner Data Bank">
                                  NPDB
                                </span>
                              )}
                              {mc.patientDied === true && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
                                  Patient died
                                </span>
                              )}
                              {mc.source && <SourceBadge source={mc.source} />}
                            </div>
                            <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{mc.description}</p>
                            {mc.allegationDescription && mc.allegationDescription !== mc.description && (
                              <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">Allegation: {mc.allegationDescription}</p>
                            )}
                            {mc.patientInjuryDescription && (
                              <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">Injury: {mc.patientInjuryDescription}</p>
                            )}
                            {(mc.settlementAmount || mc.judgmentAmount || mc.settlementAmountPaid) && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                {mc.settlementAmount ? `Settlement: $${Number(mc.settlementAmount).toLocaleString()}` : ''}
                                {mc.settlementAmountPaid ? ` (paid $${Number(mc.settlementAmountPaid).toLocaleString()})` : ''}
                                {mc.judgmentAmount ? ` · Judgment: $${Number(mc.judgmentAmount).toLocaleString()}` : ''}
                              </p>
                            )}
                            {(mc.resolutionMethod || mc.dateResolved) && (
                              <p className="text-xs text-gray-400">
                                {mc.resolutionMethod && `Resolution: ${mc.resolutionMethod}`}
                                {mc.resolutionMethod && mc.dateResolved && ' · '}
                                {mc.dateResolved && `Resolved ${format(new Date(mc.dateResolved), 'MMM d, yyyy')}`}
                              </p>
                            )}
                            {(mc.insuranceCarrier || mc.policyNumber) && (
                              <p className="text-xs text-gray-400">
                                {[mc.insuranceCarrier, mc.policyNumber].filter(Boolean).join(' · ')}
                              </p>
                            )}
                            {(mc.numberOtherCodefendants ?? 0) > 0 && (
                              <p className="text-xs text-gray-400">{mc.numberOtherCodefendants} other co-defendant{mc.numberOtherCodefendants === 1 ? '' : 's'}</p>
                            )}
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditMalpracticeClaim(mc)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit claim">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteMalpracticeClaim(mc.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete claim">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Disclosure Questions */}
                <CollapsibleSection
                  title="Disclosure Questions"
                  count={disclosuresList?.length || 0}
                  onAdd={handleAddDisclosure}
                  addLabel="Add"
                >
                  {(!disclosuresList || disclosuresList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <ClipboardDocumentCheckIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No disclosures recorded</p>
                      <p className="text-xs text-gray-400 mt-0.5">Disclosure questions will appear here when answered</p>
                      <button onClick={handleAddDisclosure} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add disclosure
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {disclosuresList.map((d: any) => (
                        <div key={d.id} className="group flex items-start justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm text-gray-900">{d.category?.replace(/_/g, ' ')}</p>
                              <span className={clsx(
                                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                                d.answer ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                              )}>{d.answer ? 'Yes' : 'No'}</span>
                              {d.caqhQuestionId && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500" title="CAQH disclosure question ID">
                                  Q{d.caqhQuestionId}
                                </span>
                              )}
                              {d.source && <SourceBadge source={d.source} />}
                            </div>
                            <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{d.questionText}</p>
                            {d.answer && d.explanation && (
                              <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">Explanation: {d.explanation}</p>
                            )}
                            {d.dateOfOccurrence && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                Occurred: {format(new Date(d.dateOfOccurrence), 'MMM d, yyyy')}
                                {d.state && ' · '}
                                {d.state}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditDisclosure(d)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit disclosure">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteDisclosure(d.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete disclosure">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>
              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                {/* Practice Assignment */}
                <div className="card card-body border-l-4 border-l-primary-400">
                  <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Practice</h3>
                  {provider.practice ? (
                    <div>
                      <Link to={`/practices/${provider.practice.id}`} className="text-sm font-medium text-primary-600 hover:text-primary-500">
                        {provider.practice.name}
                      </Link>
                      <span className={clsx(
                        'ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        provider.practice.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                      )}>
                        {provider.practice.status}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Unassigned</p>
                  )}
                </div>

                <CaqhCard providerId={id!} />

                <CaqhImportPanel providerId={id!} />

                <TaxonomyAssistant
                  providerId={id!}
                  providerType={provider.providerType}
                  currentTaxonomy={provider.taxonomy}
                  onUpdate={async (code: string) => {
                    try {
                      await api.patch(`/providers/${id}`, { taxonomy: code });
                      queryClient.invalidateQueries({ queryKey: ['provider', id] });
                      toast.success('Taxonomy code updated');
                    } catch {
                      toast.error('Failed to update taxonomy');
                    }
                  }}
                />

                {/* Documents */}
                <div className="card px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Documents</h3>
                      <span className="text-sm font-bold text-gray-900">{provider.documents?.length || 0}</span>
                    </div>
                    <div className="flex gap-3">
                      <Link to="/documents" className="text-xs text-primary-600 hover:text-primary-500">View</Link>
                      <button onClick={() => { setUploadDocumentType(''); setUploadModalOpen(true); }} className="text-xs text-primary-600 hover:text-primary-500">Upload</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Tab.Panel>

          {/* ===== CREDENTIALS TAB ===== */}
          <Tab.Panel>
            {activeTab === 1 && (
              <div className="space-y-6 animate-fade-in">
                {/* Credential Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Licenses', count: provider.licenses?.length || 0, color: 'bg-emerald-50 text-emerald-700', icon: MapIcon },
                    { label: 'Board Certs', count: provider.boardCertifications?.length || 0, color: 'bg-blue-50 text-blue-700', icon: ShieldCheckIcon },
                    { label: 'DEA', count: deaRegistrationsList?.length || 0, color: 'bg-purple-50 text-purple-700', icon: DocumentTextIcon },
                    { label: 'Insurance', count: malpracticeInsuranceList?.length || 0, color: 'bg-amber-50 text-amber-700', icon: ShieldCheckIcon },
                  ].map((item, idx) => (
                    <div key={item.label} className="card card-body flex items-center gap-3 animate-scale-in" style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'backwards' }}>
                      <div className={clsx('h-10 w-10 rounded-xl flex items-center justify-center', item.color)}>
                        <item.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-gray-900">{item.count}</p>
                        <p className="text-xs text-gray-500">{item.label}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Licenses — Card Grid */}
                <div className="card">
                  <div className="card-header flex items-center justify-between">
                    <h2 className="text-base font-semibold text-gray-900">Licenses</h2>
                    <button onClick={handleAddLicense} className="text-sm text-primary-600 hover:text-primary-500 flex items-center">
                      <PlusIcon className="h-4 w-4 mr-1" />Add
                    </button>
                  </div>
                  <div className="card-body">
                    {provider.licenses?.length === 0 ? (
                      <div className="text-center py-8">
                        <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                          <MapIcon className="h-5 w-5 text-gray-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-500">No licenses yet</p>
                        <p className="text-xs text-gray-400 mt-0.5">Add your first license to get started</p>
                        <button onClick={handleAddLicense} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                          <PlusIcon className="h-3.5 w-3.5" /> Add license
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {provider.licenses?.map((license: any) => {
                          const expDate = new Date(license.expirationDate);
                          const now = new Date();
                          const daysUntilExpiry = Math.floor((expDate.getTime() - now.getTime()) / 86400000);
                          const isExpired = daysUntilExpiry < 0;
                          const isExpiringSoon = !isExpired && daysUntilExpiry <= 90;
                          return (
                            <div key={license.id} className={clsx(
                              'group relative p-4 rounded-xl border transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 border-l-4',
                              isExpired ? 'bg-red-50/50 border-red-200 border-l-red-400' : isExpiringSoon ? 'bg-gray-50 border-gray-100 border-l-amber-400 hover:border-primary-200' : 'bg-gray-50 border-gray-100 border-l-green-400 hover:border-primary-200'
                            )}>
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-sm text-gray-900">
                                      {license.licenseType.replace('_', ' ')}
                                    </p>
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200/80 text-gray-600">
                                      {license.state}
                                    </span>
                                    {license.isPrimary && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
                                        Primary
                                      </span>
                                    )}
                                    <SourceBadge source={license.source} />
                                  </div>
                                  <p className="text-xs text-gray-500 mt-0.5">#{license.licenseNumber}</p>
                                  <p className={clsx('text-xs mt-1', isExpired ? 'text-red-600 font-medium' : 'text-gray-400')}>
                                    {isExpired ? 'Expired' : 'Expires'}: {format(new Date(license.expirationDate), 'MMM d, yyyy')}
                                  </p>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => handleEditLicense(license)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit license">
                                    <PencilIcon className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => handleDeleteLicense(license.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete license">
                                    <TrashIcon className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Multi-State License Grid */}
                <MultiStateLicenseGrid
                  providerId={id!}
                  licenses={provider.licenses || []}
                  providerType={provider.providerType}
                  onAddLicense={() => { setEditingLicense(null); setLicenseModalOpen(true); }}
                />

                {/* Board Certifications — Card Grid */}
                <div className="card">
                  <div className="card-header flex items-center justify-between">
                    <h2 className="text-base font-semibold text-gray-900">Board Certifications</h2>
                    <button onClick={handleAddCert} className="text-sm text-primary-600 hover:text-primary-500 flex items-center">
                      <PlusIcon className="h-4 w-4 mr-1" />Add
                    </button>
                  </div>
                  <div className="card-body">
                    {provider.boardCertifications?.length === 0 ? (
                      <div className="text-center py-8">
                        <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                          <ShieldCheckIcon className="h-5 w-5 text-gray-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-500">No certifications yet</p>
                        <p className="text-xs text-gray-400 mt-0.5">Add your first board certification to get started</p>
                        <button onClick={handleAddCert} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                          <PlusIcon className="h-3.5 w-3.5" /> Add certification
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {provider.boardCertifications?.map((cert: any) => {
                          const certExpDate = cert.expirationDate ? new Date(cert.expirationDate) : null;
                          const certDaysUntil = certExpDate ? Math.floor((certExpDate.getTime() - Date.now()) / 86400000) : null;
                          const certExpired = certDaysUntil !== null && certDaysUntil < 0;
                          const certExpiringSoon = certDaysUntil !== null && !certExpired && certDaysUntil <= 90;
                          return (
                          <div key={cert.id} className={clsx(
                            'group relative p-4 bg-gray-50 rounded-xl border hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 border-l-4',
                            certExpired ? 'border-red-200 border-l-red-400 bg-red-50/50' : certExpiringSoon ? 'border-gray-100 border-l-amber-400 hover:border-primary-200' : 'border-gray-100 border-l-green-400 hover:border-primary-200'
                          )}>
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium text-sm text-gray-900">{cert.boardName}</p>
                                  <SourceBadge source={cert.source} />
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">{cert.specialty}</p>
                                {cert.expirationDate && (
                                  <p className="text-xs text-gray-400 mt-1">
                                    Expires: {format(new Date(cert.expirationDate), 'MMM d, yyyy')}
                                  </p>
                                )}
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleEditCert(cert)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit certification">
                                  <PencilIcon className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => handleDeleteCert(cert.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete certification">
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* DEA Registrations */}
                <CollapsibleSection
                  title="DEA Registrations"
                  defaultOpen
                  count={deaRegistrationsList?.length || 0}
                  onAdd={handleAddDeaRegistration}
                  addLabel="Add"
                >
                  {(!deaRegistrationsList || deaRegistrationsList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <DocumentTextIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No DEA registrations yet</p>
                      <p className="text-xs text-gray-400 mt-0.5">Add your first DEA registration to get started</p>
                      <button onClick={handleAddDeaRegistration} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add DEA registration
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {deaRegistrationsList.map((dea: any) => {
                        const deaExpDate = dea.expirationDate ? new Date(dea.expirationDate) : null;
                        const deaDaysUntil = deaExpDate ? Math.floor((deaExpDate.getTime() - Date.now()) / 86400000) : null;
                        const deaExpired = deaDaysUntil !== null && deaDaysUntil < 0;
                        const deaExpiringSoon = deaDaysUntil !== null && !deaExpired && deaDaysUntil <= 90;
                        return (
                        <div key={dea.id} className={clsx(
                          'group relative p-4 bg-gray-50 rounded-xl border hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 border-l-4',
                          deaExpired ? 'border-red-200 border-l-red-400 bg-red-50/50' : deaExpiringSoon ? 'border-gray-100 border-l-amber-400 hover:border-primary-200' : 'border-gray-100 border-l-green-400 hover:border-primary-200'
                        )}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm text-gray-900 inline-flex items-center gap-1">DEA #<RevealableSecret masked={dea.deaNumber} reveal={() => revealDeaRegistration(dea.id)} label="DEA number" /></p>
                                <span className={clsx(
                                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                                  dea.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                )}>{dea.status}</span>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {dea.deaState && `${dea.deaState} \u00B7 `}Schedules: {dea.deaSchedules?.join(', ') || 'None'}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                Expires: {dea.expirationDate ? format(new Date(dea.expirationDate), 'MMM d, yyyy') : 'N/A'}
                              </p>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleEditDeaRegistration(dea)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit DEA">
                                <PencilIcon className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => handleDeleteDeaRegistration(dea.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete DEA">
                                <TrashIcon className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </CollapsibleSection>

                {/* CDS Registrations (state-issued, separate from federal DEA) */}
                <CollapsibleSection
                  title="CDS Registrations"
                  count={cdsRegistrationsList?.length || 0}
                  onAdd={handleAddCdsRegistration}
                  addLabel="Add"
                >
                  {(!cdsRegistrationsList || cdsRegistrationsList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <DocumentTextIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No CDS registrations yet</p>
                      <p className="text-xs text-gray-400 mt-0.5">State-issued controlled-substance registration, separate from federal DEA</p>
                      <button onClick={handleAddCdsRegistration} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add CDS registration
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {cdsRegistrationsList.map((cds: any) => {
                        const cdsExpDate = cds.expirationDate ? new Date(cds.expirationDate) : null;
                        const cdsDaysUntil = cdsExpDate ? Math.floor((cdsExpDate.getTime() - Date.now()) / 86400000) : null;
                        const cdsExpired = cdsDaysUntil !== null && cdsDaysUntil < 0;
                        const cdsExpiringSoon = cdsDaysUntil !== null && !cdsExpired && cdsDaysUntil <= 90;
                        return (
                        <div key={cds.id} className={clsx(
                          'group relative p-4 bg-gray-50 rounded-xl border hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 border-l-4',
                          cdsExpired ? 'border-red-200 border-l-red-400 bg-red-50/50' : cdsExpiringSoon ? 'border-gray-100 border-l-amber-400 hover:border-primary-200' : 'border-gray-100 border-l-green-400 hover:border-primary-200'
                        )}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm text-gray-900 inline-flex items-center gap-1">CDS #<RevealableSecret masked={cds.cdsNumber} reveal={() => revealCdsRegistration(cds.id)} label="CDS number" /></p>
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200/80 text-gray-600">
                                  {cds.state}
                                </span>
                                <span className={clsx(
                                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                                  cds.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                )}>{cds.status}</span>
                              </div>
                              <p className="text-xs text-gray-400 mt-1">
                                Expires: {cds.expirationDate ? format(new Date(cds.expirationDate), 'MMM d, yyyy') : 'N/A'}
                              </p>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleEditCdsRegistration(cds)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit CDS">
                                <PencilIcon className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => handleDeleteCdsRegistration(cds.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete CDS">
                                <TrashIcon className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Life-Support Certifications (BLS, ACLS, CPR, PALS, other) */}
                <div className="card">
                  <div className="card-header flex items-center justify-between">
                    <h2 className="text-base font-semibold text-gray-900">Life-Support Certifications</h2>
                    <button onClick={handleAddLifeSupportCert} className="text-sm text-primary-600 hover:text-primary-500 flex items-center">
                      <PlusIcon className="h-4 w-4 mr-1" />Add
                    </button>
                  </div>
                  <div className="card-body">
                    {(!lifeSupportCertsList || lifeSupportCertsList.length === 0) ? (
                      <div className="text-center py-8">
                        <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                          <ShieldCheckIcon className="h-5 w-5 text-gray-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-500">No life-support certifications yet</p>
                        <p className="text-xs text-gray-400 mt-0.5">BLS, ACLS, CPR, PALS, or other</p>
                        <button onClick={handleAddLifeSupportCert} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                          <PlusIcon className="h-3.5 w-3.5" /> Add certification
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {lifeSupportCertsList.map((cert: any) => {
                          const certExpDate = cert.expirationDate ? new Date(cert.expirationDate) : null;
                          const certDaysUntil = certExpDate ? Math.floor((certExpDate.getTime() - Date.now()) / 86400000) : null;
                          const certExpired = certDaysUntil !== null && certDaysUntil < 0;
                          const certExpiringSoon = certDaysUntil !== null && !certExpired && certDaysUntil <= 90;
                          return (
                            <div key={cert.id} className={clsx(
                              'group relative p-4 rounded-xl border transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 border-l-4',
                              certExpired ? 'bg-red-50/50 border-red-200 border-l-red-400' : certExpiringSoon ? 'bg-gray-50 border-gray-100 border-l-amber-400 hover:border-primary-200' : 'bg-gray-50 border-gray-100 border-l-green-400 hover:border-primary-200'
                            )}>
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-sm text-gray-900 uppercase">
                                      {cert.certType}
                                    </p>
                                    <span className={clsx(
                                      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                                      cert.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                    )}>{cert.status}</span>
                                    {cert.source && <SourceBadge source={cert.source} />}
                                  </div>
                                  <p className="text-xs text-gray-500 mt-0.5">{cert.certDescription}</p>
                                  {cert.issuingAuthority && (
                                    <p className="text-xs text-gray-400 mt-0.5">{cert.issuingAuthority}</p>
                                  )}
                                  <p className={clsx('text-xs mt-1', certExpired ? 'text-red-600 font-medium' : 'text-gray-400')}>
                                    {cert.expirationDate
                                      ? `${certExpired ? 'Expired' : 'Expires'}: ${format(new Date(cert.expirationDate), 'MMM d, yyyy')}`
                                      : 'No expiration'}
                                  </p>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => handleEditLifeSupportCert(cert)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit certification">
                                    <PencilIcon className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => handleDeleteLifeSupportCert(cert.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete certification">
                                    <TrashIcon className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Malpractice Insurance */}
                <CollapsibleSection
                  title="Malpractice Insurance"
                  defaultOpen
                  count={malpracticeInsuranceList?.length || 0}
                  onAdd={handleAddMalpracticeInsurance}
                  addLabel="Add"
                >
                  {(!malpracticeInsuranceList || malpracticeInsuranceList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <ShieldCheckIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No malpractice insurance yet</p>
                      <p className="text-xs text-gray-400 mt-0.5">Add your first malpractice insurance to get started</p>
                      <button onClick={handleAddMalpracticeInsurance} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add insurance
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {malpracticeInsuranceList.map((ins: any) => (
                        <div key={ins.id} className="group flex items-start justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div>
                            <p className="font-medium text-sm text-gray-900">{ins.carrierName}</p>
                            <p className="text-xs text-gray-500">
                              Policy #{ins.policyNumber} \u00B7 {ins.coverageType?.replace('_', ' ')}
                            </p>
                            <p className="text-xs text-gray-400">
                              {ins.effectiveDate ? format(new Date(ins.effectiveDate), 'MMM d, yyyy') : ''}
                              {' \u2013 '}
                              {ins.expirationDate ? format(new Date(ins.expirationDate), 'MMM d, yyyy') : ''}
                            </p>
                            {ins.hasTailCoverage && <p className="text-[10px] text-blue-600 font-medium mt-0.5">Has tail coverage</p>}
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditMalpracticeInsurance(ins)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit insurance">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteMalpracticeInsurance(ins.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete insurance">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Supervising Physicians */}
                <CollapsibleSection
                  title="Supervising Physicians"
                  defaultOpen
                  count={supervisingPhysiciansList?.length || 0}
                  onAdd={handleAddSupervisingPhysician}
                  addLabel="Add"
                >
                  {(!supervisingPhysiciansList || supervisingPhysiciansList.length === 0) ? (
                    <div className="text-center py-8">
                      <div className="mx-auto h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                        <UserCircleIcon className="h-5 w-5 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">No supervising physicians yet</p>
                      <p className="text-xs text-gray-400 mt-0.5">Add your first supervising physician to get started</p>
                      <button onClick={handleAddSupervisingPhysician} className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-500 inline-flex items-center gap-1">
                        <PlusIcon className="h-3.5 w-3.5" /> Add supervisor
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {supervisingPhysiciansList.map((sp: any) => (
                        <div key={sp.id} className="group flex items-start justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm text-gray-900">{sp.supervisorFirstName} {sp.supervisorLastName}</p>
                              {sp.isPrimary && <span className="badge-primary text-[10px]">Primary</span>}
                              {sp.source && <SourceBadge source={sp.source} />}
                            </div>
                            <p className="text-xs text-gray-500">
                              {sp.supervisionType.replace('_', ' ')} supervision
                              {sp.supervisorNpi && ` \u00B7 NPI: ${sp.supervisorNpi}`}
                              {sp.caqhSupervisorId && ` \u00B7 CAQH #${sp.caqhSupervisorId}`}
                            </p>
                            {(sp.practiceLocation?.locationName || sp.department) && (
                              <p className="text-xs text-gray-500">
                                {[sp.practiceLocation?.locationName, sp.department].filter(Boolean).join(' \u00B7 ')}
                              </p>
                            )}
                            <p className="text-xs text-gray-400">
                              From {sp.agreementStartDate ? format(new Date(sp.agreementStartDate), 'MMM d, yyyy') : 'N/A'}
                              {sp.agreementEndDate && ` to ${format(new Date(sp.agreementEndDate), 'MMM d, yyyy')}`}
                            </p>
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEditSupervisingPhysician(sp)} className="p-1 rounded-md hover:bg-gray-200 text-gray-400 hover:text-primary-600" aria-label="Edit supervisor">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteSupervisingPhysician(sp.id)} className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Delete supervisor">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* Supervision Tracker */}
                <SupervisionTracker
                  providerId={id!}
                  providerType={provider.providerType}
                  supervisingPhysicians={supervisingPhysiciansList || []}
                  onAdd={() => { setEditingSupervisingPhysician(null); setSupervisingPhysicianModalOpen(true); }}
                />

              </div>
            )}
          </Tab.Panel>

          {/* ===== ENROLLMENTS TAB ===== */}
          <Tab.Panel>
            {activeTab === 2 && <ProviderEnrollments providerId={id!} />}
          </Tab.Panel>

          {/* ===== ACTIVITY TAB (Checklist + Tasks) ===== */}
          <Tab.Panel>
            {activeTab === 3 && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-base font-semibold text-gray-900 mb-4">Credentialing Checklist</h2>
                  <ProviderChecklist providerId={id!} onUploadDocument={handleUploadDocument} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900 mb-4">Tasks</h2>
                  <ProviderTasks providerId={id!} />
                </div>
              </div>
            )}
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

      {/* AI Sidebar */}
      <AiSidebar entityType="provider" entityId={id!} />

      {/* Lazy-loaded modals */}
      <ErrorBoundary>
      <Suspense fallback={null}>
      {/* Practice Location Modal */}
      <PracticeLocationModal
        isOpen={locationModalOpen}
        onClose={() => {
          setLocationModalOpen(false);
          setEditingLocation(null);
        }}
        providerId={id!}
        location={editingLocation}
      />

      {/* CAQH Edit Warning Modal (Phase 2f) */}
      <CaqhEditWarningModal
        isOpen={caqhWarning !== null}
        onClose={() => setCaqhWarning(null)}
        onEditAnyway={() => caqhWarning?.proceed()}
        recordType={caqhWarning?.recordType}
      />

      {/* License Modal */}
      <LicenseModal
        isOpen={licenseModalOpen}
        onClose={() => {
          setLicenseModalOpen(false);
          setEditingLicense(null);
        }}
        providerId={id!}
        license={editingLicense}
      />

      {/* Certification Modal */}
      <CertificationModal
        isOpen={certModalOpen}
        onClose={() => {
          setCertModalOpen(false);
          setEditingCert(null);
        }}
        providerId={id!}
        certification={editingCert}
      />

      {/* Education Modal */}
      <EducationModal
        isOpen={educationModalOpen}
        onClose={() => {
          setEducationModalOpen(false);
          setEditingEducation(null);
        }}
        providerId={id!}
        education={editingEducation}
      />

      {/* Work History Modal */}
      <WorkHistoryModal
        isOpen={workHistoryModalOpen}
        onClose={() => {
          setWorkHistoryModalOpen(false);
          setEditingWorkHistory(null);
        }}
        providerId={id!}
        workHistory={editingWorkHistory}
      />

      {/* Malpractice Insurance Modal */}
      <MalpracticeInsuranceModal
        isOpen={malpracticeInsuranceModalOpen}
        onClose={() => {
          setMalpracticeInsuranceModalOpen(false);
          setEditingMalpracticeInsurance(null);
        }}
        providerId={id!}
        insurance={editingMalpracticeInsurance}
        practiceLocations={provider.practiceLocations || []}
      />

      {/* Supervising Physician Modal */}
      <SupervisingPhysicianModal
        isOpen={supervisingPhysicianModalOpen}
        onClose={() => {
          setSupervisingPhysicianModalOpen(false);
          setEditingSupervisingPhysician(null);
        }}
        providerId={id!}
        physician={editingSupervisingPhysician}
      />

      {/* Malpractice Claim Modal */}
      <MalpracticeClaimModal
        isOpen={malpracticeClaimModalOpen}
        onClose={() => {
          setMalpracticeClaimModalOpen(false);
          setEditingMalpracticeClaim(null);
        }}
        providerId={id!}
        claim={editingMalpracticeClaim}
      />

      {/* Disclosure Modal */}
      <DisclosureModal
        isOpen={disclosureModalOpen}
        onClose={() => {
          setDisclosureModalOpen(false);
          setEditingDisclosure(null);
        }}
        providerId={id!}
        disclosure={editingDisclosure}
      />

      {/* Hospital Affiliation Modal */}
      <HospitalAffiliationModal
        isOpen={hospitalAffiliationModalOpen}
        onClose={() => {
          setHospitalAffiliationModalOpen(false);
          setEditingHospitalAffiliation(null);
        }}
        providerId={id!}
        affiliation={editingHospitalAffiliation}
      />

      {/* Work History Gap Modal */}
      <WorkHistoryGapModal
        isOpen={workHistoryGapModalOpen}
        onClose={() => {
          setWorkHistoryGapModalOpen(false);
          setEditingWorkHistoryGap(null);
        }}
        providerId={id!}
        gap={editingWorkHistoryGap}
      />

      {/* DEA Registration Modal */}
      <DeaRegistrationModal
        isOpen={deaRegistrationModalOpen}
        onClose={() => {
          setDeaRegistrationModalOpen(false);
          setEditingDeaRegistration(null);
        }}
        providerId={id!}
        registration={editingDeaRegistration}
      />

      {/* CDS Registration Modal */}
      <CdsRegistrationModal
        isOpen={cdsRegistrationModalOpen}
        onClose={() => {
          setCdsRegistrationModalOpen(false);
          setEditingCdsRegistration(null);
        }}
        providerId={id!}
        registration={editingCdsRegistration}
      />

      {/* Life-Support Cert Modal */}
      <LifeSupportCertModal
        isOpen={lifeSupportCertModalOpen}
        onClose={() => {
          setLifeSupportCertModalOpen(false);
          setEditingLifeSupportCert(null);
        }}
        providerId={id!}
        certification={editingLifeSupportCert}
      />

      {/* Provider Identifier Modal */}
      <ProviderIdentifierModal
        isOpen={providerIdentifierModalOpen}
        onClose={() => {
          setProviderIdentifierModalOpen(false);
          setEditingProviderIdentifier(null);
        }}
        providerId={id!}
        identifier={editingProviderIdentifier}
      />

      {/* Banking Modal */}
      <BankingModal
        isOpen={bankingModalOpen}
        onClose={() => {
          setBankingModalOpen(false);
          setEditingBanking(null);
        }}
        providerId={id!}
        banking={editingBanking}
      />

      </Suspense>
      </ErrorBoundary>

      {/* Document Upload Modal */}
      <DocumentUploadModal
        isOpen={uploadModalOpen}
        onClose={() => {
          setUploadModalOpen(false);
          setUploadDocumentType('');
        }}
        providerId={id!}
        providerName={provider ? `${provider.firstName} ${provider.lastName}` : undefined}
        defaultDocumentType={uploadDocumentType}
        onUploadComplete={handleUploadComplete}
      />

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={confirmState.isOpen}
        onClose={closeConfirm}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel="Delete"
        variant="danger"
      />
      {deleteModalOpen && provider && (
        <DeleteProviderModal
          providerName={`${provider.firstName} ${provider.lastName}`}
          isSubmitting={deleteProvider.isPending}
          onCancel={() => setDeleteModalOpen(false)}
          onConfirm={(reason) => {
            deleteProvider.mutate(
              { providerId: provider.id, deletionReason: reason },
              {
                onSuccess: () => {
                  setDeleteModalOpen(false);
                  // After delete the detail page no longer matches an active provider —
                  // bounce back to the list. Undo from the toast will re-fetch and re-show.
                  navigate('/providers');
                },
                onError: () => setDeleteModalOpen(false),
              }
            );
          }}
        />
      )}
    </div>
    </PageTransition>
  );
}
