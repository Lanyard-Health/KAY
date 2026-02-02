import { useState, Fragment } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Menu, Transition, Tab } from '@headlessui/react';
import { PencilIcon, DocumentArrowDownIcon, ChevronDownIcon, MapPinIcon, PlusIcon, TrashIcon, ClipboardDocumentCheckIcon, BuildingOfficeIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../../services/api';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import PracticeLocationModal from './PracticeLocationModal';
import ProviderChecklist from './ProviderChecklist';
import ProviderEnrollments from './ProviderEnrollments';
import DocumentUploadModal from '../../components/DocumentUploadModal';
import PdmComplianceCard from '../../components/PdmComplianceCard';
import { CaqhCard } from '../../components/CaqhCard';
import { usePdmAlerts } from '../../hooks/usePdmStatus';

const TABS = [
  { name: 'Overview', icon: BuildingOfficeIcon },
  { name: 'Checklist', icon: ClipboardDocumentCheckIcon },
  { name: 'Enrollments', icon: BuildingOfficeIcon },
];

export default function ProviderDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<any>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadDocumentType, setUploadDocumentType] = useState<string>('');

  const handleUploadDocument = (documentType: string) => {
    setUploadDocumentType(documentType);
    setUploadModalOpen(true);
  };

  const handleUploadComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['provider', id] });
    queryClient.invalidateQueries({ queryKey: ['checklist', id] });
  };

  const { data: provider, isLoading } = useQuery({
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
  const overdueCount = pdmAlerts?.data?.alerts?.filter((a) => a.status === 'overdue').length || 0;
  const dueSoonCount = pdmAlerts?.data?.alerts?.filter((a) => a.status === 'due_soon').length || 0;

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

  const handleAddLocation = () => {
    setEditingLocation(null);
    setLocationModalOpen(true);
  };

  const handleEditLocation = (location: any) => {
    setEditingLocation(location);
    setLocationModalOpen(true);
  };

  const handleDeleteLocation = (locationId: string) => {
    if (window.confirm('Are you sure you want to delete this location?')) {
      deleteLocationMutation.mutate(locationId);
    }
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

  const exportToPDF = () => {
    if (!provider) return;

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
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
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
                {/* Personal Information */}
          <div className="card">
            <div className="card-header">
              <h2 className="text-lg font-medium text-gray-900">Personal Information</h2>
            </div>
            <div className="card-body">
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
                    {format(new Date(provider.dateOfBirth), 'MMMM d, yyyy')}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Gender</dt>
                  <dd className="mt-1 text-sm text-gray-900 capitalize">
                    {provider.gender.replace('_', ' ')}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Licenses */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Licenses</h2>
              <button className="text-sm text-primary-600 hover:text-primary-500">
                Add License
              </button>
            </div>
            <div className="card-body">
              {provider.licenses?.length === 0 ? (
                <p className="text-sm text-gray-500">No licenses added yet.</p>
              ) : (
                <div className="space-y-4">
                  {provider.licenses?.map((license: any) => (
                    <div
                      key={license.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-gray-900">
                          {license.licenseType.replace('_', ' ')} - {license.state}
                        </p>
                        <p className="text-sm text-gray-500">#{license.licenseNumber}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Expires</p>
                        <p className={clsx(
                          'text-sm font-medium',
                          new Date(license.expirationDate) < new Date() ? 'text-red-600' : 'text-gray-900'
                        )}>
                          {format(new Date(license.expirationDate), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Board Certifications */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Board Certifications</h2>
              <button className="text-sm text-primary-600 hover:text-primary-500">
                Add Certification
              </button>
            </div>
            <div className="card-body">
              {provider.boardCertifications?.length === 0 ? (
                <p className="text-sm text-gray-500">No certifications added yet.</p>
              ) : (
                <div className="space-y-4">
                  {provider.boardCertifications?.map((cert: any) => (
                    <div
                      key={cert.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{cert.boardName}</p>
                        <p className="text-sm text-gray-500">{cert.specialty}</p>
                      </div>
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Practice Locations */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Practice Locations</h2>
              <button
                onClick={handleAddLocation}
                className="text-sm text-primary-600 hover:text-primary-500 flex items-center"
              >
                <PlusIcon className="h-4 w-4 mr-1" />
                Add Location
              </button>
            </div>
            <div className="card-body">
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
            </div>
          </div>
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

          {/* CAQH ProView */}
          <CaqhCard providerId={id!} provider={provider} />

          {/* Medicare Enrollment */}
          <div className="card card-body">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Medicare Enrollment</h3>
            {medicareEnrollment?.found ? (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
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
                        • {enrollment.state}: {enrollment.providerTypeDesc.replace('PRACTITIONER - ', '')}
                      </p>
                    ))}
                    {medicareEnrollment.enrollments.length > 3 && (
                      <p className="text-gray-400">+{medicareEnrollment.enrollments.length - 3} more</p>
                    )}
                  </div>
                )}
                {medicareEnrollment.orderingPrivileges && (
                  <div className="text-xs text-gray-500 space-y-0.5">
                    {medicareEnrollment.orderingPrivileges.dme && <p>✓ DME</p>}
                    {medicareEnrollment.orderingPrivileges.hha && <p>✓ Home Health</p>}
                    {medicareEnrollment.orderingPrivileges.hospice && <p>✓ Hospice</p>}
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
            <ProviderChecklist
              providerId={id!}
              onUploadDocument={handleUploadDocument}
            />
          </Tab.Panel>

          {/* Enrollments Tab */}
          <Tab.Panel>
            <ProviderEnrollments providerId={id!} />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

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
    </div>
  );
}
