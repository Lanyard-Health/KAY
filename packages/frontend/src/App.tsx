import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth.store';
import LoginPage from './features/auth/LoginPage';
import Layout from './components/Layout';
import Dashboard from './features/dashboard/Dashboard';
import ProviderList from './features/providers/ProviderList';
import ProviderDetail from './features/providers/ProviderDetail';
import ProviderForm from './features/providers/ProviderForm';
import DocumentList from './features/documents/DocumentList';
import ExpirationDashboard from './features/dashboard/ExpirationDashboard';
import EnrollmentsList from './features/enrollments/EnrollmentsList';
import RosterPage from './features/roster/RosterPage';
import AiAgentDashboard from './features/ai-agent/AiAgentDashboard';
import RegisterPage from './features/portal/RegisterPage';
import PendingProviders from './features/admin/PendingProviders';
import PracticesList from './features/practices/PracticesList';
import PracticeDetail from './features/practices/PracticeDetail';
import UsersList from './features/users/UsersList';
import UserDetail from './features/users/UserDetail';
import PortalLayout from './features/portal/PortalLayout';
import PortalDashboard from './features/portal/PortalDashboard';
import PortalProfile from './features/portal/PortalProfile';
import PortalLicenses from './features/portal/PortalLicenses';
import PortalLocations from './features/portal/PortalLocations';
import RegistrationSuccess from './features/portal/RegistrationSuccess';

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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
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
        <Route path="licenses" element={<PortalLicenses />} />
        <Route path="locations" element={<PortalLocations />} />
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
        <Route path="providers" element={<ProviderList />} />
        <Route path="providers/new" element={<ProviderForm />} />
        <Route path="providers/:id" element={<ProviderDetail />} />
        <Route path="providers/:id/edit" element={<ProviderForm />} />
        <Route path="documents" element={<DocumentList />} />
        <Route path="enrollments" element={<EnrollmentsList />} />
        <Route path="expirations" element={<ExpirationDashboard />} />
        <Route path="roster" element={<RosterPage />} />
        <Route path="ai-agent" element={<AiAgentDashboard />} />
        <Route path="practices" element={<PracticesList />} />
        <Route path="practices/:practiceId" element={<PracticeDetail />} />
        <Route path="users" element={<UsersList />} />
        <Route path="users/:userId" element={<UserDetail />} />
        <Route path="pending-providers" element={<PendingProviders />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
