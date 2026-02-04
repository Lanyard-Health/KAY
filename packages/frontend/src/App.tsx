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

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

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

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
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
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
