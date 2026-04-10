import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { useAuth } from './hooks/useAuth';
import { AuthProvider } from './contexts/AuthContext';
import { PendingApproval } from './components/ui/PendingApproval';

// Eager-loaded (needed immediately)
const AuthPage = lazy(() => import('./pages/AuthPage').then(m => ({ default: m.AuthPage })));
const LegalPage = lazy(() => import('./pages/LegalPage').then(m => ({ default: m.LegalPage })));

// Lazy-loaded pages (split into separate chunks)
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage').then(m => ({ default: m.AdminDashboardPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const RefillsPage = lazy(() => import('./pages/RefillsPage').then(m => ({ default: m.RefillsPage })));
const AdminRefillsPage = lazy(() => import('./pages/AdminRefillsPage').then(m => ({ default: m.AdminRefillsPage })));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage').then(m => ({ default: m.DocumentsPage })));
const MessagesPage = lazy(() => import('./pages/MessagesPage').then(m => ({ default: m.MessagesPage })));
const IntakePage = lazy(() => import('./pages/IntakePage').then(m => ({ default: m.IntakePage })));
const AppointmentsPage = lazy(() => import('./pages/AppointmentsPage').then(m => ({ default: m.AppointmentsPage })));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage').then(m => ({ default: m.UserManagementPage })));
const AdminTodoPage = lazy(() => import('./pages/AdminTodoPage').then(m => ({ default: m.AdminTodoPage })));
const AdminAppointmentsPage = lazy(() => import('./pages/AdminAppointmentsPage').then(m => ({ default: m.AdminAppointmentsPage })));
const AgentPage = lazy(() => import('./pages/AgentPage').then(m => ({ default: m.AgentPage })));
const AdminIntakeFormsPage = lazy(() => import('./pages/AdminIntakeFormsPage').then(m => ({ default: m.AdminIntakeFormsPage })));
const AdminSpecialistRequestsPage = lazy(() => import('./pages/AdminSpecialistRequestsPage').then(m => ({ default: m.AdminSpecialistRequestsPage })));
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage').then(m => ({ default: m.AdminSettingsPage })));
const AdminPendingPatientsPage = lazy(() => import('./pages/AdminPendingPatientsPage').then(m => ({ default: m.AdminPendingPatientsPage })));
const SupportChatPage = lazy(() => import('./pages/SupportChatPage').then(m => ({ default: m.SupportChatPage })));
const ContactPage = lazy(() => import('./pages/ContactPage').then(m => ({ default: m.ContactPage })));
const BillingPage = lazy(() => import('./pages/BillingPage').then(m => ({ default: m.BillingPage })));
const AdminSubscriptionPlansPage = lazy(() => import('./pages/AdminSubscriptionPlansPage').then(m => ({ default: m.AdminSubscriptionPlansPage })));

const isSandbox = import.meta.env.VITE_SANDBOX_MODE === 'true';

const PageLoader = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
  </div>
);

// Protected Route component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, userProfile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-secondary-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  // In non-sandbox mode, inactive patients see the pending screen
  // Admins always pass through (they manage the system)
  if (!isSandbox && userProfile && !userProfile.isActive && userProfile.role !== 'admin') {
    return <PendingApproval />;
  }

  return <>{children}</>;
};

// Role-based redirect component
const RoleBasedRedirect: React.FC = () => {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-secondary-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Always redirect to regular dashboard - users can switch to admin mode from there
  return <Navigate to="/dashboard" replace />;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          {/* Handle Firebase auth action URLs with our custom UI */}
          <Route path="/__/auth/action" element={<AuthPage />} />
          {/* Public legal pages */}
          <Route path="/privacy" element={<LegalPage />} />
          <Route path="/terms" element={<LegalPage />} />
          <Route path="/" element={<RoleBasedRedirect />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="admin" element={<AdminDashboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="refills" element={<RefillsPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="intake" element={<IntakePage />} />
          <Route path="appointments" element={<AppointmentsPage />} />
          <Route path="admin/users" element={<UserManagementPage />} />
          <Route path="admin/todos" element={<AdminTodoPage />} />
          <Route path="admin/refills" element={<AdminRefillsPage />} />
          <Route path="admin/appointments" element={<AdminAppointmentsPage />} />
          <Route path="admin/agent" element={<AgentPage />} />
          <Route path="admin/intake-forms" element={<AdminIntakeFormsPage />} />
          <Route path="admin/specialist-requests" element={<AdminSpecialistRequestsPage />} />
          <Route path="admin/settings" element={<AdminSettingsPage />} />
          <Route path="admin/pending-patients" element={<AdminPendingPatientsPage />} />
          <Route path="support" element={<SupportChatPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="admin/subscription-plans" element={<AdminSubscriptionPlansPage />} />
          {/* Add more protected routes here */}
        </Route>
      </Routes>
      </Suspense>
    </Router>
    </AuthProvider>
  );
}

export default App;
