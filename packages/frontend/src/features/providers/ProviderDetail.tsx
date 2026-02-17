import { useState, Fragment, useCallback, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Menu, Transition, Tab } from '@headlessui/react';
import { PencilIcon, DocumentArrowDownIcon, ChevronDownIcon, ChevronRightIcon, MapPinIcon, PlusIcon, TrashIcon, ClipboardDocumentCheckIcon, BuildingOfficeIcon, ListBulletIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
// jsPDF + autotable loaded dynamically in exportToPDF()
import { api } from '../../services/api';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import ErrorBoundary from '../../components/ErrorBoundary';
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
const DeaRegistrationModal = lazy(() => import('./DeaRegistrationModal'));
const ProviderIdentifierModal = lazy(() => import('./ProviderIdentifierModal'));
const BankingModal = lazy(() => import('./BankingModal'));
import {
  useListEducation, useDeleteEducation,
  useListWorkHistory, useDeleteWorkHistory,
  useListMalpracticeInsurance, useDeleteMalpracticeInsurance,
  useListSupervisingPhysicians, useDeleteSupervisingPhysician,
  useListMalpracticeClaims, useDeleteMalpracticeClaim,
  useListDisclosures, useDeleteDisclosure,
  useListDeaRegistrations, useDeleteDeaRegistration,
  useListProviderIdentifiers, useDeleteProviderIdentifier,
  useListBanking, useDeleteBanking,
} from '../../hooks/usePayerEnrollmentData';
import ProviderChecklist from './ProviderChecklist';
import ProviderEnrollments from './ProviderEnrollments';
import ProviderTasks from './ProviderTasks';
import DocumentUploadModal from '../../components/DocumentUploadModal';
import PdmComplianceCard from '../../components/PdmComplianceCard';
import { CaqhCard } from '../../components/CaqhCard';
import DirectoryStatusCard from '../../components/DirectoryStatusCard';
import { usePdmAlerts } from '../../hooks/usePdmStatus';

const TABS = [
  { name: 'Overview', icon: BuildingOfficeIcon },
  { name: 'Checklist', icon: ClipboardDocumentCheckIcon },
  { name: 'Enrollments', icon: BuildingOfficeIcon },
  { name: 'Tasks', icon: ListBulletIcon },
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
    <div className="card">
      <div
        className="card-header flex items-center justify-between cursor-pointer select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDownIcon className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 text-gray-400" />
          )}
          <h2 className="text-lg font-medium text-gray-900">{title}</h2>
          {count !== undefined && (
            <span className="text-sm text-gray-400">({count})</span>
          )}
        </div>
        {onAdd && (
          <button
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            className="text-sm text-primary-600 hover:text-primary-500 flex items-center"
          >
            <PlusIcon className="h-4 w-4 mr-1" />
            {addLabel}
          </button>
        )}
      </div>
      {isOpen && <div className="card-body">{children}</div>}
    </div>
  );
}

export default function ProviderDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();

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
  const [deaRegistrationModalOpen, setDeaRegistrationModalOpen] = useState(false);
  const [editingDeaRegistration, setEditingDeaRegistration] = useState<any>(null);
  const [providerIdentifierModalOpen, setProviderIdentifierModalOpen] = useState(false);
  const [editingProviderIdentifier, setEditingProviderIdentifier] = useState<any>(null);
  const [bankingModalOpen, setBankingModalOpen] = useState(false);
  const [editingBanking, setEditingBanking] = useState<any>(null);

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

  const { data: provider, isLoading, error } = useQuery({
    queryKey: ['provider', id],
    queryFn: async () => {
      const response = await api.get(`/providers/${id}`);
      return response.data.data;
    },
  });

  // Fetch Medicare enrollment status
  const { data: medicareEnrollment } = useQuery({
    queryKey: ['medicare-enrollment', provider?.npi],
    queryFn: async () => {
      const response = await api.get(`/pecos/lookup/${provider.npi}`);
      return response.data.data;
    },
    enabled: !!provider?.npi,
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });

  // PDM alerts for banner
  const { data: pdmAlerts } = usePdmAlerts(id || '');
  const overdueCount = pdmAlerts?.data?.alerts?.filter((a: any) => a.status === 'overdue').length || 0;
  const dueSoonCount = pdmAlerts?.data?.alerts?.filter((a: any) => a.status === 'due_soon').length || 0;

  // Payer enrollment data queries
  const { data: educationList } = useListEducation(id || '');
  const { data: workHistoryList } = useListWorkHistory(id || '');
  const { data: malpracticeInsuranceList } = useListMalpracticeInsurance(id || '');
  const { data: supervisingPhysiciansList } = useListSupervisingPhysicians(id || '');
  const { data: malpracticeClaimsList } = useListMalpracticeClaims(id || '');
  const { data: disclosuresList } = useListDisclosures(id || '');
  const { data: deaRegistrationsList } = useListDeaRegistrations(id || '');
  const { data: providerIdentifiersList } = useListProviderIdentifiers(id || '');
  const { data: bankingList } = useListBanking(id || '');

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

  const deleteLicenseMutation = useDeleteLicense();
  const deleteCertMutation = useDeleteCertification();

  // New delete mutations
  const deleteEducationMutation = useDeleteEducation();
  const deleteWorkHistoryMutation = useDeleteWorkHistory();
  const deleteMalpracticeInsuranceMutation = useDeleteMalpracticeInsurance();
  const deleteSupervisingPhysicianMutation = useDeleteSupervisingPhysician();
  const deleteMalpracticeClaimMutation = useDeleteMalpracticeClaim();
  const deleteDisclosureMutation = useDeleteDisclosure();
  const deleteDeaRegistrationMutation = useDeleteDeaRegistration();
  const deleteProviderIdentifierMutation = useDeleteProviderIdentifier();
  const deleteBankingMutation = useDeleteBanking();

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

  const handleEditLicense = (license: any) => {
    setEditingLicense(license);
    setLicenseModalOpen(true);
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

  const handleEditCert = (cert: any) => {
    setEditingCert(cert);
    setCertModalOpen(true);
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
            <div key={i} className="bg-white rounded-lg shadow p-4 space-y-3">
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
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-medium">Failed to load provider</p>
          <p className="text-sm mt-1">Please check your connection and try again.</p>
        </div>
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

  return (
    <div>
      {/* PDM Alert Banner */}
      {(overdueCount > 0 || dueSoonCount > 0) && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start">
            <svg
              className="h-5 w-5 text-red-600 mt-0.5 mr-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-red-800">PDM Attestation Required</h3>
              <p className="mt-1 text-sm text-red-700">
                {overdueCount > 0 && (
                  <span className="font-semibold">{overdueCount} enrollment(s) are overdue. </span>
                )}
                {dueSoonCount > 0 && (
                  <span>{dueSoonCount} enrollment(s) due soon. </span>
                )}
                Per CAA 2021, provider directory information must be attested every 90 days.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-8">
        <div className="flex items-center">
          <div className="h-16 w-16 rounded-full bg-primary-100 flex items-center justify-center">
            <span className="text-primary-600 text-2xl font-bold">
              {provider.firstName[0]}{provider.lastName[0]}
            </span>
          </div>
          <div className="ml-4">
            <h1 className="text-2xl font-bold text-gray-900">
              {provider.firstName} {provider.lastName}
              {provider.suffix && `, ${provider.suffix}`}
            </h1>
            <p className="text-sm text-gray-500">
              NPI: {provider.npi} | {provider.providerType.replace('_', ' ')}
            </p>
            {(() => {
              const primaryLocation = provider.practiceLocations?.find((l: any) => l.isPrimary) || provider.practiceLocations?.[0];
              const maskedTaxId = primaryLocation?.taxId
                ? `****${primaryLocation.taxId.slice(-4)}`
                : '\u2014';
              return (
                <p className="text-sm text-gray-500">
                  Group NPI: {primaryLocation?.groupNpi || '\u2014'} | Tax ID: {maskedTaxId}
                </p>
              );
            })()}
          </div>
        </div>
        <div className="mt-4 sm:mt-0 flex gap-3">
          <Link to={`/providers/${id}/edit`} className="btn-secondary">
            <PencilIcon className="-ml-1 mr-2 h-5 w-5" />
            Edit
          </Link>

          {/* Export Dropdown */}
          <Menu as="div" className="relative inline-block text-left">
            <Menu.Button className="btn-primary inline-flex items-center">
              <DocumentArrowDownIcon className="-ml-1 mr-2 h-5 w-5" />
              Export Data
              <ChevronDownIcon className="ml-2 -mr-1 h-4 w-4" />
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
              <Menu.Items className="absolute right-0 z-10 mt-2 w-40 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                <div className="py-1">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={exportToCSV}
                        className={clsx(
                          active ? 'bg-gray-100 text-gray-900' : 'text-gray-700',
                          'block w-full text-left px-4 py-2 text-sm'
                        )}
                      >
                        Export as CSV
                      </button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={exportToPDF}
                        className={clsx(
                          active ? 'bg-gray-100 text-gray-900' : 'text-gray-700',
                          'block w-full text-left px-4 py-2 text-sm'
                        )}
                      >
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

      {/* Tabs */}
      <Tab.Group selectedIndex={activeTab} onChange={setActiveTab}>
        <Tab.List className="flex space-x-4 border-b border-gray-200 mb-6">
          {TABS.map((tab) => (
            <Tab
              key={tab.name}
              className={({ selected }) =>
                clsx(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px focus:outline-none',
                  selected
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )
              }
            >
              <tab.icon className="h-5 w-5" />
              {tab.name}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels>
          {/* Overview Tab */}
          <Tab.Panel>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Info */}
              <div className="lg:col-span-2 space-y-6">

                {/* 1. Personal Information */}
                <CollapsibleSection title="Personal Information" defaultOpen>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Email</dt>
                      <dd className="mt-1 text-sm text-gray-900">{provider.email}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Phone</dt>
                      <dd className="mt-1 text-sm text-gray-900">{provider.phone}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Date of Birth</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {provider.dateOfBirth ? format(new Date(provider.dateOfBirth), 'MMMM d, yyyy') : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Gender</dt>
                      <dd className="mt-1 text-sm text-gray-900 capitalize">
                        {provider.gender.replace('_', ' ')}
                      </dd>
                    </div>
                  </dl>
                </CollapsibleSection>

                {/* 2. Practice Locations */}
                <CollapsibleSection
                  title="Practice Locations"
                  defaultOpen
                  count={provider.practiceLocations?.length || 0}
                  onAdd={handleAddLocation}
                  addLabel="Add Location"
                >
                  {!provider.practiceLocations || provider.practiceLocations.length === 0 ? (
                    <div className="text-center py-6">
                      <MapPinIcon className="mx-auto h-12 w-12 text-gray-400" />
                      <p className="mt-2 text-sm text-gray-500">No practice locations added yet.</p>
                      <button
                        onClick={handleAddLocation}
                        className="mt-2 text-sm text-primary-600 hover:text-primary-500"
                      >
                        Add your first location
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {provider.practiceLocations.map((location: any) => (
                        <div
                          key={location.id}
                          className="p-4 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900">{location.locationName}</p>
                                {location.isPrimary && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800">
                                    Primary
                                  </span>
                                )}
                                {!location.isActive && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                    Inactive
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-500 capitalize">{location.locationType}</p>
                              <p className="text-sm text-gray-600 mt-1">
                                {location.addressLine1}
                                {location.addressLine2 && `, ${location.addressLine2}`}
                              </p>
                              <p className="text-sm text-gray-600">
                                {location.city}, {location.state} {location.zipCode}
                              </p>
                              <p className="text-sm text-gray-500 mt-1">{location.phone}</p>
                              {location.acceptingNewPatients && (
                                <p className="text-xs text-green-600 mt-1">Accepting new patients</p>
                              )}
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button
                                onClick={() => handleEditLocation(location)}
                                className="text-primary-600 hover:text-primary-900"
                              >
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteLocation(location.id)}
                                className="text-red-600 hover:text-red-900"
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 3. Licenses */}
                <CollapsibleSection
                  title="Licenses"
                  defaultOpen
                  count={provider.licenses?.length || 0}
                  onAdd={handleAddLicense}
                  addLabel="Add License"
                >
                  {provider.licenses?.length === 0 ? (
                    <p className="text-sm text-gray-500">No licenses added yet.</p>
                  ) : (
                    <div className="space-y-4">
                      {provider.licenses?.map((license: any) => (
                        <div
                          key={license.id}
                          className="p-4 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">
                                {license.licenseType.replace('_', ' ')} - {license.state}
                              </p>
                              <p className="text-sm text-gray-500">#{license.licenseNumber}</p>
                            </div>
                            <div className="flex items-center gap-3 ml-4">
                              <div className="text-right">
                                <p className="text-sm text-gray-500">Expires</p>
                                <p className={clsx(
                                  'text-sm font-medium',
                                  new Date(license.expirationDate) < new Date() ? 'text-red-600' : 'text-gray-900'
                                )}>
                                  {format(new Date(license.expirationDate), 'MMM d, yyyy')}
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleEditLicense(license)}
                                  className="text-primary-600 hover:text-primary-900"
                                >
                                  <PencilIcon className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteLicense(license.id)}
                                  className="text-red-600 hover:text-red-900"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 4. Board Certifications */}
                <CollapsibleSection
                  title="Board Certifications"
                  defaultOpen
                  count={provider.boardCertifications?.length || 0}
                  onAdd={handleAddCert}
                  addLabel="Add Certification"
                >
                  {provider.boardCertifications?.length === 0 ? (
                    <p className="text-sm text-gray-500">No certifications added yet.</p>
                  ) : (
                    <div className="space-y-4">
                      {provider.boardCertifications?.map((cert: any) => (
                        <div
                          key={cert.id}
                          className="p-4 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{cert.boardName}</p>
                              <p className="text-sm text-gray-500">{cert.specialty}</p>
                            </div>
                            <div className="flex items-center gap-3 ml-4">
                              <div className="text-right">
                                {cert.expirationDate && (
                                  <>
                                    <p className="text-sm text-gray-500">Expires</p>
                                    <p className="text-sm font-medium text-gray-900">
                                      {format(new Date(cert.expirationDate), 'MMM d, yyyy')}
                                    </p>
                                  </>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleEditCert(cert)}
                                  className="text-primary-600 hover:text-primary-900"
                                >
                                  <PencilIcon className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteCert(cert.id)}
                                  className="text-red-600 hover:text-red-900"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 5. DEA Registrations */}
                <CollapsibleSection
                  title="DEA Registrations"
                  count={deaRegistrationsList?.length || 0}
                  onAdd={handleAddDeaRegistration}
                  addLabel="Add DEA"
                >
                  {(!deaRegistrationsList || deaRegistrationsList.length === 0) ? (
                    <p className="text-sm text-gray-500">No DEA registrations added yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {deaRegistrationsList.map((dea: any) => (
                        <div key={dea.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900">DEA #{dea.deaNumber}</p>
                                <span className={clsx(
                                  'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                                  dea.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                )}>
                                  {dea.status}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500">
                                {dea.deaState && `State: ${dea.deaState} | `}
                                Schedules: {dea.deaSchedules?.join(', ') || 'None'}
                              </p>
                              <p className="text-sm text-gray-500">
                                Expires: {dea.expirationDate ? format(new Date(dea.expirationDate), 'MMM d, yyyy') : 'N/A'}
                              </p>
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button onClick={() => handleEditDeaRegistration(dea)} className="text-primary-600 hover:text-primary-900">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDeleteDeaRegistration(dea.id)} className="text-red-600 hover:text-red-900">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 6. Education & Training */}
                <CollapsibleSection
                  title="Education & Training"
                  count={educationList?.length || 0}
                  onAdd={handleAddEducation}
                  addLabel="Add Education"
                >
                  {(!educationList || educationList.length === 0) ? (
                    <p className="text-sm text-gray-500">No education records added yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {educationList.map((edu: any) => (
                        <div key={edu.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{edu.institutionName}</p>
                              <p className="text-sm text-gray-500">
                                {edu.degree?.toUpperCase()} in {edu.fieldOfStudy}
                                {edu.educationType && ` (${edu.educationType.replace('_', ' ')})`}
                              </p>
                              <p className="text-sm text-gray-400">
                                {edu.startDate ? format(new Date(edu.startDate), 'MMM yyyy') : ''}
                                {' \u2013 '}
                                {edu.endDate ? format(new Date(edu.endDate), 'MMM yyyy') : 'Present'}
                              </p>
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button onClick={() => handleEditEducation(edu)} className="text-primary-600 hover:text-primary-900">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDeleteEducation(edu.id)} className="text-red-600 hover:text-red-900">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 7. Work History */}
                <CollapsibleSection
                  title="Work History"
                  count={workHistoryList?.length || 0}
                  onAdd={handleAddWorkHistory}
                  addLabel="Add Work History"
                >
                  {(!workHistoryList || workHistoryList.length === 0) ? (
                    <p className="text-sm text-gray-500">No work history added yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {workHistoryList.map((wh: any) => (
                        <div key={wh.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900">{wh.organizationName}</p>
                                {wh.isCurrent && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                    Current
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-500">{wh.position}</p>
                              <p className="text-sm text-gray-400">
                                {wh.startDate ? format(new Date(wh.startDate), 'MMM yyyy') : ''}
                                {' \u2013 '}
                                {wh.isCurrent ? 'Present' : (wh.endDate ? format(new Date(wh.endDate), 'MMM yyyy') : '')}
                              </p>
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button onClick={() => handleEditWorkHistory(wh)} className="text-primary-600 hover:text-primary-900">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDeleteWorkHistory(wh.id)} className="text-red-600 hover:text-red-900">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 8. Supervising Physicians */}
                <CollapsibleSection
                  title="Supervising Physicians"
                  count={supervisingPhysiciansList?.length || 0}
                  onAdd={handleAddSupervisingPhysician}
                  addLabel="Add Supervisor"
                >
                  {(!supervisingPhysiciansList || supervisingPhysiciansList.length === 0) ? (
                    <p className="text-sm text-gray-500">No supervising physicians added yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {supervisingPhysiciansList.map((sp: any) => (
                        <div key={sp.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900">
                                  {sp.supervisorFirstName} {sp.supervisorLastName}
                                </p>
                                {sp.isPrimary && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800">
                                    Primary
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-500">
                                {sp.supervisionType.replace('_', ' ')} supervision
                                {sp.supervisorNpi && ` | NPI: ${sp.supervisorNpi}`}
                              </p>
                              <p className="text-sm text-gray-400">
                                From {sp.agreementStartDate ? format(new Date(sp.agreementStartDate), 'MMM d, yyyy') : 'N/A'}
                                {sp.agreementEndDate && ` to ${format(new Date(sp.agreementEndDate), 'MMM d, yyyy')}`}
                              </p>
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button onClick={() => handleEditSupervisingPhysician(sp)} className="text-primary-600 hover:text-primary-900">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDeleteSupervisingPhysician(sp.id)} className="text-red-600 hover:text-red-900">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 9. Malpractice Insurance */}
                <CollapsibleSection
                  title="Malpractice Insurance"
                  count={malpracticeInsuranceList?.length || 0}
                  onAdd={handleAddMalpracticeInsurance}
                  addLabel="Add Insurance"
                >
                  {(!malpracticeInsuranceList || malpracticeInsuranceList.length === 0) ? (
                    <p className="text-sm text-gray-500">No malpractice insurance records added yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {malpracticeInsuranceList.map((ins: any) => (
                        <div key={ins.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{ins.carrierName}</p>
                              <p className="text-sm text-gray-500">
                                Policy #{ins.policyNumber} | {ins.coverageType?.replace('_', ' ')}
                              </p>
                              <p className="text-sm text-gray-400">
                                {ins.effectiveDate ? format(new Date(ins.effectiveDate), 'MMM d, yyyy') : ''}
                                {' \u2013 '}
                                {ins.expirationDate ? format(new Date(ins.expirationDate), 'MMM d, yyyy') : ''}
                              </p>
                              {ins.hasTailCoverage && (
                                <p className="text-xs text-blue-600 mt-1">Has tail coverage</p>
                              )}
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button onClick={() => handleEditMalpracticeInsurance(ins)} className="text-primary-600 hover:text-primary-900">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDeleteMalpracticeInsurance(ins.id)} className="text-red-600 hover:text-red-900">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 10. Malpractice Claims History */}
                <CollapsibleSection
                  title="Malpractice Claims History"
                  count={malpracticeClaimsList?.length || 0}
                  onAdd={handleAddMalpracticeClaim}
                  addLabel="Add Claim"
                >
                  {(!malpracticeClaimsList || malpracticeClaimsList.length === 0) ? (
                    <p className="text-sm text-gray-500">No malpractice claims recorded.</p>
                  ) : (
                    <div className="space-y-3">
                      {malpracticeClaimsList.map((mc: any) => (
                        <div key={mc.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900">
                                  Incident: {mc.dateOfIncident ? format(new Date(mc.dateOfIncident), 'MMM d, yyyy') : 'N/A'}
                                </p>
                                <span className={clsx(
                                  'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                                  mc.claimStatus === 'DISMISSED' || mc.claimStatus === 'JUDGMENT_FOR_PROVIDER'
                                    ? 'bg-green-100 text-green-800'
                                    : mc.claimStatus === 'OPEN'
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : 'bg-gray-100 text-gray-600'
                                )}>
                                  {mc.claimStatus?.replace(/_/g, ' ')}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500 line-clamp-2">{mc.description}</p>
                              {(mc.settlementAmount || mc.judgmentAmount) && (
                                <p className="text-sm text-gray-400 mt-1">
                                  {mc.settlementAmount ? `Settlement: $${mc.settlementAmount.toLocaleString()}` : ''}
                                  {mc.judgmentAmount ? `Judgment: $${mc.judgmentAmount.toLocaleString()}` : ''}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button onClick={() => handleEditMalpracticeClaim(mc)} className="text-primary-600 hover:text-primary-900">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDeleteMalpracticeClaim(mc.id)} className="text-red-600 hover:text-red-900">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 11. Disclosure Questions */}
                <CollapsibleSection
                  title="Disclosure Questions"
                  count={disclosuresList?.length || 0}
                  onAdd={handleAddDisclosure}
                  addLabel="Add Disclosure"
                >
                  {(!disclosuresList || disclosuresList.length === 0) ? (
                    <p className="text-sm text-gray-500">No disclosures recorded.</p>
                  ) : (
                    <div className="space-y-3">
                      {disclosuresList.map((d: any) => (
                        <div key={d.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900">
                                  {d.category?.replace(/_/g, ' ')}
                                </p>
                                <span className={clsx(
                                  'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                                  d.answer ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                                )}>
                                  {d.answer ? 'Yes' : 'No'}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500 line-clamp-2">{d.questionText}</p>
                              {d.answer && d.explanation && (
                                <p className="text-sm text-gray-400 mt-1 line-clamp-1">
                                  Explanation: {d.explanation}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button onClick={() => handleEditDisclosure(d)} className="text-primary-600 hover:text-primary-900">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDeleteDisclosure(d.id)} className="text-red-600 hover:text-red-900">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 12. Provider Identifiers */}
                <CollapsibleSection
                  title="Provider Identifiers"
                  count={providerIdentifiersList?.length || 0}
                  onAdd={handleAddProviderIdentifier}
                  addLabel="Add Identifier"
                >
                  {(!providerIdentifiersList || providerIdentifiersList.length === 0) ? (
                    <p className="text-sm text-gray-500">No identifiers added yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {providerIdentifiersList.map((pi: any) => (
                        <div key={pi.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">
                                {pi.identifierType?.replace(/_/g, ' ')}
                              </p>
                              <p className="text-sm text-gray-500">
                                {pi.identifierValue}
                                {pi.issuingEntity && ` | ${pi.issuingEntity}`}
                                {pi.state && ` | ${pi.state}`}
                              </p>
                              {pi.expirationDate && (
                                <p className="text-sm text-gray-400">
                                  Expires: {format(new Date(pi.expirationDate), 'MMM d, yyyy')}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button onClick={() => handleEditProviderIdentifier(pi)} className="text-primary-600 hover:text-primary-900">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDeleteProviderIdentifier(pi.id)} className="text-red-600 hover:text-red-900">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 13. Banking / EFT */}
                <CollapsibleSection
                  title="Banking / EFT"
                  count={bankingList?.length || 0}
                  onAdd={handleAddBanking}
                  addLabel="Add Banking"
                >
                  {(!bankingList || bankingList.length === 0) ? (
                    <p className="text-sm text-gray-500">No banking records added yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {bankingList.map((b: any) => (
                        <div key={b.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900">{b.bankName}</p>
                                {b.isPrimary && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800">
                                    Primary
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-500">
                                {b.bankAccountType} | Acct: {b.accountNumberEncrypted}
                              </p>
                              <p className="text-sm text-gray-500">
                                Holder: {b.accountHolderName}
                              </p>
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button onClick={() => handleEditBanking(b)} className="text-primary-600 hover:text-primary-900">
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDeleteBanking(b.id)} className="text-red-600 hover:text-red-900">
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleSection>

                {/* 14. Additional Demographics */}
                <CollapsibleSection title="Additional Demographics">
                  <DemographicsForm providerId={id!} />
                </CollapsibleSection>

              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Status Card */}
                <div className="card card-body">
                  <h3 className="text-sm font-medium text-gray-500 mb-3">Status</h3>
                  <span
                    className={clsx(
                      'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium capitalize',
                      provider.status === 'active' && 'bg-green-100 text-green-800',
                      provider.status === 'inactive' && 'bg-gray-100 text-gray-800',
                      provider.status === 'pending' && 'bg-yellow-100 text-yellow-800'
                    )}
                  >
                    {provider.status}
                  </span>
                </div>

                {/* Practice Assignment */}
                <div className="card card-body">
                  <h3 className="text-sm font-medium text-gray-500 mb-3">Practice</h3>
                  {provider.practice ? (
                    <div>
                      <Link
                        to={`/practices/${provider.practice.id}`}
                        className="text-sm font-medium text-primary-600 hover:text-primary-500"
                      >
                        {provider.practice.name}
                      </Link>
                      <span
                        className={clsx(
                          'ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                          provider.practice.status === 'ACTIVE'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        )}
                      >
                        {provider.practice.status}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Unassigned</p>
                  )}
                </div>

                {/* CAQH ProView */}
                <CaqhCard providerId={id!} />

                {/* Medicare Enrollment */}
                <div className="card card-body">
                  <h3 className="text-sm font-medium text-gray-500 mb-3">Medicare Enrollment</h3>
                  {medicareEnrollment?.found ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                          Enrolled
                        </span>
                        {medicareEnrollment.pacId && (
                          <span className="text-xs text-gray-400">PAC: {medicareEnrollment.pacId}</span>
                        )}
                      </div>
                      {medicareEnrollment.enrollments && medicareEnrollment.enrollments.length > 0 && (
                        <div className="text-xs text-gray-600 space-y-1 mb-2">
                          {medicareEnrollment.enrollments.slice(0, 3).map((enrollment: any, idx: number) => (
                            <p key={idx} className="truncate" title={enrollment.providerTypeDesc}>
                              &bull; {enrollment.state}: {enrollment.providerTypeDesc.replace('PRACTITIONER - ', '')}
                            </p>
                          ))}
                          {medicareEnrollment.enrollments.length > 3 && (
                            <p className="text-gray-400">+{medicareEnrollment.enrollments.length - 3} more</p>
                          )}
                        </div>
                      )}
                      {medicareEnrollment.orderingPrivileges && (
                        <div className="text-xs text-gray-500 space-y-0.5">
                          {medicareEnrollment.orderingPrivileges.dme && <p>&#10003; DME</p>}
                          {medicareEnrollment.orderingPrivileges.hha && <p>&#10003; Home Health</p>}
                          {medicareEnrollment.orderingPrivileges.hospice && <p>&#10003; Hospice</p>}
                        </div>
                      )}
                      {medicareEnrollment.verifiedAt && (
                        <p className="text-xs text-gray-400 mt-2">
                          Verified: {format(new Date(medicareEnrollment.verifiedAt), 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                  ) : medicareEnrollment && !medicareEnrollment.found ? (
                    <div>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        Not Enrolled
                      </span>
                      <p className="text-xs text-gray-500 mt-2">
                        Provider not found in Medicare enrollment database
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Loading...</p>
                  )}
                </div>

                {/* PDM Compliance */}
                <PdmComplianceCard providerId={id!} />

                {/* Directory Verification */}
                <DirectoryStatusCard providerId={id!} />

                {/* Documents */}
                <div className="card card-body">
                  <h3 className="text-sm font-medium text-gray-500 mb-3">Documents</h3>
                  <p className="text-2xl font-bold text-gray-900">
                    {provider.documents?.length || 0}
                  </p>
                  <p className="text-sm text-gray-500">documents uploaded</p>
                  <div className="mt-2 flex gap-3">
                    <Link to="/documents" className="text-sm text-primary-600 hover:text-primary-500">
                      View All
                    </Link>
                    <button
                      onClick={() => {
                        setUploadDocumentType('');
                        setUploadModalOpen(true);
                      }}
                      className="text-sm text-primary-600 hover:text-primary-500"
                    >
                      Upload
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Tab.Panel>

          {/* Checklist Tab */}
          <Tab.Panel>
            {activeTab === 1 && (
              <ProviderChecklist
                providerId={id!}
                onUploadDocument={handleUploadDocument}
              />
            )}
          </Tab.Panel>

          {/* Enrollments Tab */}
          <Tab.Panel>
            {activeTab === 2 && <ProviderEnrollments providerId={id!} />}
          </Tab.Panel>

          {/* Tasks Tab */}
          <Tab.Panel>
            {activeTab === 3 && <ProviderTasks providerId={id!} />}
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

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
    </div>
  );
}
