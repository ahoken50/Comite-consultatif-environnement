import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { useDispatch, useSelector } from 'react-redux';
import { CircularProgress, Box } from '@mui/material';
import { auth } from './services/firebase';
import { setUser, setLoading } from './features/auth/authSlice';
import type { RootState } from './store/rootReducer';
import MainLayout from './components/layout/MainLayout';
import LoginPage from './pages/Auth/LoginPage';
import SignUpPage from './pages/Auth/SignUpPage';

// Lazy load page components
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));
const ProjectsPage = lazy(() => import('./pages/Projects/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('./pages/Projects/ProjectDetailPage'));
const MeetingsPage = lazy(() => import('./pages/Meetings/MeetingsPage'));
const MeetingDetailPage = lazy(() => import('./pages/Meetings/MeetingDetailPage'));
const DocumentsPage = lazy(() => import('./pages/Documents/DocumentsPage'));
const MembersPage = lazy(() => import('./pages/Members/MembersPage'));
const SettingsPage = lazy(() => import('./pages/Settings/SettingsPage'));
const MinutesPage = lazy(() => import('./pages/Minutes/MinutesPage'));

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading } = useSelector((state: RootState) => state.auth);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
};

const LoadingFallback = () => (
  <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
    <CircularProgress />
  </Box>
);

function App() {
  const dispatch = useDispatch();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        dispatch(setUser({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        }));
      } else {
        dispatch(setUser(null));
      }
      dispatch(setLoading(false));
    });

    return () => unsubscribe();
  }, [dispatch]);

  return (
    <Router>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />

          <Route path="/" element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="meetings" element={<MeetingsPage />} />
            <Route path="meetings/:id" element={<MeetingDetailPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="minutes" element={<MinutesPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
