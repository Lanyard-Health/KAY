import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth.store';
import { notify } from './utils/notify';
import ErrorBoundary from './components/ErrorBoundary';
import RouteProgressBar from './components/ui/RouteProgressBar';

// Eager: needed for auth shell / initial render
import LoginPage from './features/auth/LoginPage';
import Layout from './components/Layout';
import PortalLayout from './features/portal/PortalLayout';

// Lazy: loaded on demand per-route
const Dashboard = lazy(() => import('./features/dashboard/Dashboard'));
const ProviderList = lazy(() => import('./features/providers/ProviderList'));
const ProviderDetail = lazy(() => import('./features/providers/ProviderDetail'));
const ProviderForm = lazy(() => import('./features/providers/ProviderForm'));
const ProviderImportPage = lazy(() => import('./features/providers/ProviderImportPage'));
const ArchivedProvidersView = lazy(() => import('./features/providers/ArchivedProvidersView'));
const DocumentList = lazy(() => import('./features/documents/DocumentList'));
const ExpirationDashboard = lazy(() => import('./features/dashboard/ExpirationDashboard'));
const EnrollmentsList = lazy(() => import('./features/enrollments/EnrollmentsList'));
const EnrollmentDetail = lazy(() => import('./features/enrollments/EnrollmentDetail'));
const RosterPage = lazy(() => import('./features/roster/RosterPage'));
const AiAgentDashboard = lazy(() => import('./features/ai-agent/AiAgentDashboard'));
const EnrollmentStrategyPage = lazy(() => import('./features/enrollment-strategy/EnrollmentStrategyPage'));
const RegisterPage = lazy(() => import('./features/portal/RegisterPage'));
const PracticeSignupPage = lazy(() => import('./features/practice/PracticeSignupPage'));
const AcceptInvitationPage = lazy(() => import('./features/invitations/AcceptInvitationPage'));
const UpdateCaqhCredentialsPage = lazy(() => import('./features/providers/UpdateCaqhCredentialsPage'));
const PendingProviders = lazy(() => import('./features/admin/PendingProviders'));
const PracticesList = lazy(() => import('./features/practices/PracticesList'));
const PracticeDetail = lazy(() => import('./features/practices/PracticeDetail'));
const UsersList = lazy(() => import('./features/users/UsersList'));
const UserDetail = lazy(() => import('./features/users/UserDetail'));
const AccessReviewPage = lazy(() => import('./features/access-review/AccessReviewPage'));
const AuditLogPage = lazy(() => import('./features/audit-log/AuditLogPage'));
const PortalDashboard = lazy(() => import('./features/portal/PortalDashboard'));
const PortalProfile = lazy(() => import('./features/portal/PortalProfile'));
const PortalLicenses = lazy(() => import('./features/portal/PortalLicenses'));
const PortalLocations = lazy(() => import('./features/portal/PortalLocations'));
const PortalDocuments = lazy(() => import('./features/portal/PortalDocuments'));
const PortalCaqhLogin = lazy(() => import('./features/portal/PortalCaqhLogin'));
const RegistrationSuccess = lazy(() => import('./features/portal/RegistrationSuccess'));
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage'));
const OnboardingProgress = lazy(() => import('./features/admin/OnboardingProgress'));
const PracticeOnboarding = lazy(() => import('./features/admin/PracticeOnboarding'));
const CommandCenter = lazy(() => import('./features/command-center/CommandCenter'));
const OcrReviewQueue = lazy(() => import('./features/documents/OcrReviewQueue'));
const KnowledgeBaseList = lazy(() => import('./features/admin/KnowledgeBaseList'));
const KnowledgeBaseDetail = lazy(() => import('./features/admin/KnowledgeBaseDetail'));
const KnowledgeBaseNew = lazy(() => import('./features/admin/KnowledgeBaseNew'));
const KnowledgeBaseGaps = lazy(() => import('./features/admin/KnowledgeBaseGaps'));
const PayerFormFieldsEditor = lazy(() => import('./features/admin/PayerFormFieldsEditor'));
const WorkflowTemplates = lazy(() => import('./features/admin/WorkflowTemplates'));
const WorkflowTemplateDetail = lazy(() => import('./features/admin/WorkflowTemplateDetail'));
const FollowupTemplates = lazy(() => import('./features/admin/FollowupTemplates'));
const FollowupTemplateDetail = lazy(() => import('./features/admin/FollowupTemplateDetail'));
const EmailTemplates = lazy(() => import('./features/admin/EmailTemplates'));
const EmailTemplateDetail = lazy(() => import('./features/admin/EmailTemplateDetail'));
const CustomerCommunications = lazy(() => import('./features/admin/CustomerCommunications'));
const WorkflowQueue = lazy(() => import('./features/workflow-queue/WorkflowQueue'));
const WorkflowsList = lazy(() => import('./features/admin/WorkflowsList'));
const WorkflowDetail = lazy(() => import('./features/admin/WorkflowDetail'));
const DenialsList = lazy(() => import('./features/denials/DenialsList'));
const FollowUpMonitor = lazy(() => import('./features/follow-up/FollowUpMonitor'));
const Settings = lazy(() => import('./features/settings/Settings'));
const ClinicalProfileWizard = lazy(() => import('./features/clinical-profile/ClinicalProfileWizard'));
const TasksPage = lazy(() => import('./features/tasks/TasksPage'));
// Design prototypes — mock only, not wired to auth (see file header comments)
const VerifyEmailPrototype = lazy(() => import('./features/prototypes/VerifyEmailPrototype'));
const LoginPrototype = lazy(() => import('./features/prototypes/LoginPrototype'));
const MfaEnrollmentPrototype = lazy(() => import('./features/prototypes/MfaEnrollmentPrototype'));
const MfaEnrollmentPage = lazy(() => import('./features/auth/MfaEnrollmentPage'));

function LoadingFallback() {
  return <RouteProgressBar />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#faf7f2' }}>
        <p style={{ color: '#6b665c', fontSize: '18px' }}>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role === 'provider') {
    return <RedirectWithToast to="/portal" message="That page is admin only. Sending you to your portal." />;
  }

  return <>{children}</>;
}

function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#faf7f2' }}>
        <p style={{ color: '#6b665c', fontSize: '18px' }}>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role === 'provider' || user?.role === 'practice_admin') {
    return <RedirectWithToast to="/" message="You don't have permission to view that page" />;
  }

  return <>{children}</>;
}

// Internal Lanyard team only (admin + lanyard_staff). Practice roles are redirected.
// Note: AdminOnlyRoute is NOT sufficient here — it still admits practice-side
// credentialing_staff, who must not see internal staff task assignments.
function InternalOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#faf7f2' }}>
        <p style={{ color: '#6b665c', fontSize: '18px' }}>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'admin' && user?.role !== 'lanyard_staff') {
    return <RedirectWithToast to="/" message="You don't have access to Tasks" />;
  }

  return <>{children}</>;
}

// Governance pages (Access Review, Audit Log): admin + lanyard_staff see
// everything; practice_admin sees their own practice (scoped server-side).
// provider and credentialing_staff are rejected — mirrors the backend contract.
function GovernanceRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#faf7f2' }}>
        <p style={{ color: '#6b665c', fontSize: '18px' }}>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'admin' && user?.role !== 'lanyard_staff' && user?.role !== 'practice_admin') {
    return <RedirectWithToast to="/" message="You don't have permission to view that page" />;
  }

  return <>{children}</>;
}

// Practice-admin-only pages (e.g. Bulk Import). A practice_admin manages their
// own practice's providers; staff/admin use other tools, so they're redirected.
function PracticeAdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#faf7f2' }}>
        <p style={{ color: '#6b665c', fontSize: '18px' }}>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'practice_admin') {
    return <RedirectWithToast to="/" message="Bulk import is for practice admins only" />;
  }

  return <>{children}</>;
}

// Fires a single toast before redirecting. Used by route guards so role-based
// redirects aren't silent (the user wonders why the URL bar changed).
function RedirectWithToast({ to, message }: { to: string; message: string }) {
  useEffect(() => {
    notify.error(message);
    // Intentionally only fires once when this component mounts. The redirect
    // unmounts it, so re-mounts on subsequent denied navigations re-fire correctly.
  }, []);
  return <Navigate to={to} replace />;
}

// Toasts on the 404 catch-all so the user knows why the URL changed.
function NotFoundRedirect() {
  const location = useLocation();
  useEffect(() => {
    notify.error('Page not found', { description: `No page exists at ${location.pathname}` });
  }, [location.pathname]);
  return <Navigate to="/" replace />;
}

function ProviderRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#faf7f2' }}>
        <p style={{ color: '#6b665c', fontSize: '18px' }}>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'provider') {
    return <RedirectWithToast to="/" message="The provider portal is for provider accounts only" />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/practice-signup" element={<PracticeSignupPage />} />
        <Route path="/accept-invitation/:token" element={<AcceptInvitationPage />} />
        <Route path="/update-caqh-credentials/:token" element={<UpdateCaqhCredentialsPage />} />
        <Route path="/registration-success" element={<RegistrationSuccess />} />
        <Route path="/prototypes/verify-email" element={<VerifyEmailPrototype />} />
        <Route path="/prototypes/login" element={<LoginPrototype />} />
        <Route path="/prototypes/mfa-setup" element={<MfaEnrollmentPrototype />} />

        {/* Second-factor setup. Outside the app shell on purpose: a user who
            lands here has no factor yet, and the backend refuses them the API
            calls the shell's nav and notifications would make. */}
        <Route path="/mfa-setup" element={<MfaEnrollmentPage />} />

        {/* Portal routes (provider role) */}
        <Route
          path="/portal"
          element={
            <ProviderRoute>
              <PortalLayout />
            </ProviderRoute>
          }
        >
          <Route index element={<PortalDashboard />} />
          <Route path="profile" element={<PortalProfile />} />
          <Route path="documents" element={<PortalDocuments />} />
          <Route path="licenses" element={<PortalLicenses />} />
          <Route path="locations" element={<PortalLocations />} />
          <Route path="caqh-login" element={<PortalCaqhLogin />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>

        {/* Admin routes (admin/credentialing_staff) */}
        <Route
          path="/"
          element={
            <AdminRoute>
              <Layout />
            </AdminRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="onboarding/clinical-profile" element={<ClinicalProfileWizard />} />
          <Route path="command-center" element={<AdminOnlyRoute><CommandCenter /></AdminOnlyRoute>} />
          <Route path="providers" element={<ProviderList />} />
          <Route path="providers/import" element={<PracticeAdminOnlyRoute><ProviderImportPage /></PracticeAdminOnlyRoute>} />
          <Route path="providers/archived" element={<AdminOnlyRoute><ArchivedProvidersView /></AdminOnlyRoute>} />
          <Route path="providers/new" element={<ProviderForm />} />
          <Route path="providers/:id" element={<ProviderDetail />} />
          <Route path="providers/:id/edit" element={<ProviderForm />} />
          <Route path="documents" element={<DocumentList />} />
          <Route path="tasks" element={<InternalOnlyRoute><TasksPage /></InternalOnlyRoute>} />
          <Route path="ocr-review" element={<AdminOnlyRoute><OcrReviewQueue /></AdminOnlyRoute>} />
          <Route path="enrollments" element={<EnrollmentsList />} />
          <Route path="enrollments/:id" element={<EnrollmentDetail />} />
          <Route path="workflow-queue" element={<AdminOnlyRoute><WorkflowQueue /></AdminOnlyRoute>} />
          <Route path="admin/workflows" element={<AdminOnlyRoute><WorkflowsList /></AdminOnlyRoute>} />
          <Route path="admin/workflows/:id" element={<AdminOnlyRoute><WorkflowDetail /></AdminOnlyRoute>} />
          <Route path="denials" element={<AdminOnlyRoute><DenialsList /></AdminOnlyRoute>} />
          <Route path="expirations" element={<ExpirationDashboard />} />
          <Route path="roster" element={<AdminOnlyRoute><RosterPage /></AdminOnlyRoute>} />
          <Route path="ai-agent" element={<AdminOnlyRoute><AiAgentDashboard /></AdminOnlyRoute>} />
          <Route path="enrollment-strategy" element={<AdminOnlyRoute><EnrollmentStrategyPage /></AdminOnlyRoute>} />
          <Route path="payer-intelligence" element={<Navigate to="/enrollment-strategy" replace />} />
          <Route path="practices" element={<AdminOnlyRoute><PracticesList /></AdminOnlyRoute>} />
          <Route path="practices/:practiceId" element={<AdminOnlyRoute><PracticeDetail /></AdminOnlyRoute>} />
          <Route path="users" element={<AdminOnlyRoute><UsersList /></AdminOnlyRoute>} />
          <Route path="users/:userId" element={<AdminOnlyRoute><UserDetail /></AdminOnlyRoute>} />
          <Route path="access-review" element={<GovernanceRoute><AccessReviewPage /></GovernanceRoute>} />
          <Route path="audit-log" element={<GovernanceRoute><AuditLogPage /></GovernanceRoute>} />
          <Route path="pending-providers" element={<AdminOnlyRoute><PendingProviders /></AdminOnlyRoute>} />
          <Route path="onboarding-progress" element={<AdminOnlyRoute><PracticeOnboarding /></AdminOnlyRoute>} />
          <Route path="provider-onboarding" element={<AdminOnlyRoute><OnboardingProgress /></AdminOnlyRoute>} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="admin/knowledge-base" element={<AdminOnlyRoute><KnowledgeBaseList /></AdminOnlyRoute>} />
          <Route path="admin/knowledge-base/new" element={<AdminOnlyRoute><KnowledgeBaseNew /></AdminOnlyRoute>} />
          <Route path="admin/knowledge-base/gaps" element={<AdminOnlyRoute><KnowledgeBaseGaps /></AdminOnlyRoute>} />
          <Route path="admin/knowledge-base/:id" element={<AdminOnlyRoute><KnowledgeBaseDetail /></AdminOnlyRoute>} />
          <Route path="admin/payer-forms/:formId/fields" element={<AdminOnlyRoute><PayerFormFieldsEditor /></AdminOnlyRoute>} />
          <Route path="admin/workflow-templates" element={<AdminOnlyRoute><WorkflowTemplates /></AdminOnlyRoute>} />
          <Route path="admin/workflow-templates/:id" element={<AdminOnlyRoute><WorkflowTemplateDetail /></AdminOnlyRoute>} />
          <Route path="admin/followup-templates" element={<AdminOnlyRoute><FollowupTemplates /></AdminOnlyRoute>} />
          <Route path="admin/followup-templates/:id" element={<AdminOnlyRoute><FollowupTemplateDetail /></AdminOnlyRoute>} />
          <Route path="admin/email-templates" element={<AdminOnlyRoute><EmailTemplates /></AdminOnlyRoute>} />
          <Route path="admin/email-templates/:id" element={<AdminOnlyRoute><EmailTemplateDetail /></AdminOnlyRoute>} />
          <Route path="admin/communications" element={<AdminOnlyRoute><CustomerCommunications /></AdminOnlyRoute>} />
          <Route path="follow-up" element={<AdminOnlyRoute><FollowUpMonitor /></AdminOnlyRoute>} />
          <Route path="settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<NotFoundRedirect />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
