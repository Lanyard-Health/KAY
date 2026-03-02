import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.store';
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
const DocumentList = lazy(() => import('./features/documents/DocumentList'));
const ExpirationDashboard = lazy(() => import('./features/dashboard/ExpirationDashboard'));
const EnrollmentsList = lazy(() => import('./features/enrollments/EnrollmentsList'));
const EnrollmentDetail = lazy(() => import('./features/enrollments/EnrollmentDetail'));
const RosterPage = lazy(() => import('./features/roster/RosterPage'));
const AiAgentDashboard = lazy(() => import('./features/ai-agent/AiAgentDashboard'));
const PayerIntelligencePage = lazy(() => import('./features/payer-intelligence/PayerIntelligencePage'));
const RegisterPage = lazy(() => import('./features/portal/RegisterPage'));
const PracticeSignupPage = lazy(() => import('./features/practice/PracticeSignupPage'));
const PendingProviders = lazy(() => import('./features/admin/PendingProviders'));
const PracticesList = lazy(() => import('./features/practices/PracticesList'));
const PracticeDetail = lazy(() => import('./features/practices/PracticeDetail'));
const UsersList = lazy(() => import('./features/users/UsersList'));
const UserDetail = lazy(() => import('./features/users/UserDetail'));
const PortalDashboard = lazy(() => import('./features/portal/PortalDashboard'));
const PortalProfile = lazy(() => import('./features/portal/PortalProfile'));
const PortalLicenses = lazy(() => import('./features/portal/PortalLicenses'));
const PortalLocations = lazy(() => import('./features/portal/PortalLocations'));
const PortalDocuments = lazy(() => import('./features/portal/PortalDocuments'));
const RegistrationSuccess = lazy(() => import('./features/portal/RegistrationSuccess'));
const NotificationsPage = lazy(() => import('./features/notifications/NotificationsPage'));
const OnboardingProgress = lazy(() => import('./features/admin/OnboardingProgress'));
const CommandCenter = lazy(() => import('./features/command-center/CommandCenter'));
const OpsDashboard = lazy(() => import('./features/ops/OpsDashboard'));
const OpsWorkQueue = lazy(() => import('./features/ops/OpsWorkQueue'));
const OpsWorkItemDetail = lazy(() => import('./features/ops/OpsWorkItemDetail'));
const OpsPracticesList = lazy(() => import('./features/ops/OpsPracticesList'));
const OpsPracticeDetail = lazy(() => import('./features/ops/OpsPracticeDetail'));
const OpsStaffPage = lazy(() => import('./features/ops/OpsStaffPage'));
const OpsStaffDetail = lazy(() => import('./features/ops/OpsStaffDetail'));
const OpsSlaDashboard = lazy(() => import('./features/ops/OpsSlaDashboard'));
const OpsActivityLog = lazy(() => import('./features/ops/OpsActivityLog'));
const OcrReviewQueue = lazy(() => import('./features/documents/OcrReviewQueue'));

function LoadingFallback() {
  return <RouteProgressBar />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#f9fafb' }}>
        <p style={{ color: '#4b5563', fontSize: '18px' }}>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role === 'provider') {
    return <Navigate to="/portal" replace />;
  }

  return <>{children}</>;
}

function ProviderRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#f9fafb' }}>
        <p style={{ color: '#4b5563', fontSize: '18px' }}>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'provider') {
    return <Navigate to="/" replace />;
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
        <Route path="/registration-success" element={<RegistrationSuccess />} />

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
          <Route path="command-center" element={<CommandCenter />} />
          <Route path="providers" element={<ProviderList />} />
          <Route path="providers/import" element={<ProviderImportPage />} />
          <Route path="providers/new" element={<ProviderForm />} />
          <Route path="providers/:id" element={<ProviderDetail />} />
          <Route path="providers/:id/edit" element={<ProviderForm />} />
          <Route path="documents" element={<DocumentList />} />
          <Route path="ocr-review" element={<OcrReviewQueue />} />
          <Route path="enrollments" element={<EnrollmentsList />} />
          <Route path="enrollments/:id" element={<EnrollmentDetail />} />
          <Route path="expirations" element={<ExpirationDashboard />} />
          <Route path="roster" element={<RosterPage />} />
          <Route path="ai-agent" element={<AiAgentDashboard />} />
          <Route path="payer-intelligence" element={<PayerIntelligencePage />} />
          <Route path="practices" element={<PracticesList />} />
          <Route path="practices/:practiceId" element={<PracticeDetail />} />
          <Route path="users" element={<UsersList />} />
          <Route path="users/:userId" element={<UserDetail />} />
          <Route path="pending-providers" element={<PendingProviders />} />
          <Route path="onboarding-progress" element={<OnboardingProgress />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="ops" element={<OpsDashboard />} />
          <Route path="ops/work-queue" element={<OpsWorkQueue />} />
          <Route path="ops/work-queue/:id" element={<OpsWorkItemDetail />} />
          <Route path="ops/practices" element={<OpsPracticesList />} />
          <Route path="ops/practices/:id" element={<OpsPracticeDetail />} />
          <Route path="ops/staff" element={<OpsStaffPage />} />
          <Route path="ops/staff/:id" element={<OpsStaffDetail />} />
          <Route path="ops/sla" element={<OpsSlaDashboard />} />
          <Route path="ops/activity" element={<OpsActivityLog />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
