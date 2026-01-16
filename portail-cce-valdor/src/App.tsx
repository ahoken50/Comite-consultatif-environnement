import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import { useDispatch, useSelector } from 'react-redux';
import { CircularProgress, Box } from '@mui/material';
import { auth, db } from './services/firebase';
import { setUser, setLoading } from './features/auth/authSlice';
import type { RootState } from './store/rootReducer';
import MainLayout from './components/layout/MainLayout';
import ErrorBoundary from './components/common/ErrorBoundary';
import { ToastProvider } from './hooks/useToast';
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
const ResolutionsPage = lazy(() => import('./pages/Resolutions/ResolutionsPage'));
const SettingsPage = lazy(() => import('./pages/Settings/SettingsPage'));
const MinutesPage = lazy(() => import('./pages/Minutes/MinutesPage'));
const CouncilTrackingPage = lazy(() => import('./pages/Governance/CouncilTrackingPage'));
const AnnualReportPage = lazy(() => import('./pages/Reports/AnnualReportPage'));
const RSVPPage = lazy(() => import('./pages/RSVP/RSVPPage'));
const ApprovalPage = lazy(() => import('./pages/Approval/ApprovalPage'));
const ProfilePage = lazy(() => import('./pages/Auth/ProfilePage'));
const CoordinatorDashboard = lazy(() => import('./pages/Admin/CoordinatorDashboard'));
import { RoleGuard } from './components/auth/RoleGuard';

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
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          // Fetch additional user data from Firestore
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          let userData = userDoc.exists() ? userDoc.data() : null;

          // Migration Check: Look for an existing profile with this email but different ID
          if (user.email) {
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', user.email));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
              const oldProfileDoc = querySnapshot.docs.find(d => d.id !== user.uid);
              if (oldProfileDoc) {
                console.log("Found existing profile with email, migrating data...", oldProfileDoc.id);
                const oldData = oldProfileDoc.data();

                // Merge old data into new/current ID, prioritizing old data (roles, etc.)
                // but keeping critical auth fields if needed.
                const mergedData = {
                  ...oldData,
                  uid: user.uid, // Ensure ID matches Auth
                  lastLoginAt: new Date().toISOString()
                };

                // Save merged data to current UID
                await setDoc(doc(db, 'users', user.uid), mergedData);

                // Delete old "orphaned" profile to avoid duplicates
                await deleteDoc(doc(db, 'users', oldProfileDoc.id));

                // Use this data for the session
                userData = mergedData;
              }
            }
          }

          if (userData) {
            dispatch(setUser({
              id: user.uid,
              email: user.email || '',
              displayName: userData.displayName || user.displayName || '',
              role: userData.role as any,
              memberId: userData.memberId,
              isActive: userData.isActive ?? true,
              createdAt: userData.createdAt,
              lastLoginAt: new Date().toISOString()
            }));

            // Update last login if we didn't just migrate (i.e., if userDoc originally existed)
            if (userDoc.exists()) {
              setDoc(doc(db, 'users', user.uid), {
                lastLoginAt: new Date().toISOString()
              }, { merge: true });
            }

          } else {
            console.warn("User document not found in Firestore. Creating default profile for:", user.uid);

            // Self-healing: Create user profile if absolutely nothing found
            const usersRef = collection(db, 'users');
            const snapshot = await getDocs(usersRef);
            const isFirstUser = snapshot.empty;
            const role = isFirstUser ? 'coordinator' : 'member';

            const newUserData = {
              uid: user.uid,
              email: user.email || '',
              displayName: user.displayName || 'Utilisateur',
              role: role,
              isActive: true,
              createdAt: new Date().toISOString(),
              lastLoginAt: new Date().toISOString()
            };

            await setDoc(doc(db, 'users', user.uid), newUserData);

            dispatch(setUser({
              id: user.uid,
              email: newUserData.email,
              displayName: newUserData.displayName,
              role: newUserData.role as any,
              isActive: true,
              createdAt: newUserData.createdAt,
              lastLoginAt: newUserData.lastLoginAt
            }));
          }
        } catch (error) {
          console.error("Error fetching user profile:", error);
          dispatch(setUser(null));
        }
      } else {
        dispatch(setUser(null));
      }
      dispatch(setLoading(false));
    });

    return () => unsubscribe();
  }, [dispatch]);

  return (
    <ToastProvider>
      <ErrorBoundary>
        <Router>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignUpPage />} />
              {/* Public RSVP page - no auth required */}
              <Route path="/rsvp/:meetingId/:token" element={<RSVPPage />} />
              {/* Public Approval page - no auth required (Magic Link) */}
              <Route path="/approve/:meetingId/:token" element={<ApprovalPage />} />

              <Route path="/" element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="profile" element={<ProfilePage />} />

                {/* Coordinator Only Routes */}
                <Route element={<RoleGuard allowedRoles={['coordinator']} />}>
                  <Route path="admin" element={<CoordinatorDashboard />} />
                  <Route path="reports" element={<AnnualReportPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>

                <Route path="projects" element={<ProjectsPage />} />
                <Route path="projects/:id" element={<ProjectDetailPage />} />
                <Route path="meetings" element={<MeetingsPage />} />
                <Route path="meetings/:id" element={<MeetingDetailPage />} />
                <Route path="documents" element={<DocumentsPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="resolutions" element={<ResolutionsPage />} />
                <Route path="recommendations" element={<CouncilTrackingPage />} />
                {/* Reports and Settings moved to Protected Route above */}
                <Route path="minutes" element={<MinutesPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </Router>
      </ErrorBoundary>
    </ToastProvider>
  );
}

export default App;
