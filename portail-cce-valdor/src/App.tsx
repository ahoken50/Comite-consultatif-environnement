import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';
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
const RegulationManagerPage = lazy(() => import('./pages/Regulations/RegulationManagerPage'));
const MeetingDetailPage = lazy(() => import('./pages/Meetings/MeetingDetailPage'));


const DocumentsPage = lazy(() => import('./pages/Documents/DocumentsPage'));
const MembersPage = lazy(() => import('./pages/Members/MembersPage'));
const ResolutionsPage = lazy(() => import('./pages/Resolutions/ResolutionsPage'));
const SettingsPage = lazy(() => import('./pages/Settings/SettingsPage'));
const MinutesPage = lazy(() => import('./pages/Minutes/MinutesPage'));
const CouncilTrackingPage = lazy(() => import('./pages/Governance/CouncilTrackingPage'));
const ExtractsPage = lazy(() => import('./pages/Governance/ExtractsPage'));
const AnnualReportPage = lazy(() => import('./pages/Reports/AnnualReportPage'));
const RSVPPage = lazy(() => import('./pages/RSVP/RSVPPage'));
const ApprovalPage = lazy(() => import('./pages/Approval/ApprovalPage'));
const PresentationControlPage = lazy(() => import('./pages/Presentation/PresentationControlPage'));
const ProjectionPage = lazy(() => import('./pages/Presentation/ProjectionPage'));
const ProfilePage = lazy(() => import('./pages/Auth/ProfilePage'));
const CoordinatorDashboard = lazy(() => import('./pages/Admin/CoordinatorDashboard'));
const AccessDeniedPage = lazy(() => import('./pages/Auth/AccessDeniedPage'));
const JurisprudenceSearch = lazy(() => import('./components/search/JurisprudenceSearch'));

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
          // Fetch user data from 'users' collection (Auth profile)
          const userDocRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userDocRef);
          let userData = userDoc.exists() ? userDoc.data() : null;

          // Fetch member data from 'members' collection (Business logic profile)
          // This is the source of truth for bio, phone, real name, etc.
          const memberDocRef = doc(db, 'members', user.uid);
          const memberDoc = await getDoc(memberDocRef);
          let memberData: any = memberDoc.exists() ? { id: memberDoc.id, ...memberDoc.data() } : null;
          if (memberData && memberData.embedding) delete memberData.embedding;

          // Fallback: If not found by ID, search by email (Legacy/Manually created members)
          if (!memberData && user.email) {
            try {
              const membersRef = collection(db, 'members');
              const q = query(membersRef, where("email", "==", user.email));
              const querySnapshot = await getDocs(q);
              if (!querySnapshot.empty) {
                const foundDoc = querySnapshot.docs[0];
                console.log("Member found by email lookup:", foundDoc.id);
                memberData = { id: foundDoc.id, ...foundDoc.data() };
                if (memberData && memberData.embedding) delete memberData.embedding;
              }
            } catch (e) {
              console.warn("Failed to query member by email:", e);
            }
          }

          // Sync Logic: If member profile exists, it overrides the basic auth profile
          if (memberData) {
            console.log("Syncing member data to user profile...", memberData);
            const syncedData = {
              uid: user.uid,
              email: user.email || memberData.email,
              displayName: memberData.displayName || user.displayName || 'Utilisateur',
              photoURL: memberData.photoURL || user.photoURL,
              role: memberData.role, // FORCE SYNC: Member role always takes precedence over Auth role
              isActive: memberData.isActive,
              memberId: memberData.id,
              // Preserve critical auth fields
              createdAt: userData?.createdAt || new Date().toISOString(),
              lastLoginAt: new Date().toISOString()
            };

            // Force update user role if it differs
            if (userData?.role !== memberData.role) {
              console.log(`Role mismatch detected. Updating user role from ${userData?.role} to ${memberData.role}`);
            }

            // Optimistic update: Try to save to Firestore, but proceed even if it fails (permissions)
            try {
              await setDoc(userDocRef, syncedData, { merge: true });
              console.log("Sync write successful.");
            } catch (syncError) {
              console.error("SYNC WRITE FAILED (Permissions?):", syncError);
              // We continue anyway so the user sees their correct data in the session
              // This fixes the "blocked login" issue caused by strict security rules
            }
            userData = syncedData;
          }

          // Fallback Migration (simplified): If we have a user but no member data found by ID,
          // try to find a member by email to link them in future steps.
          if (!memberData && user.email) {
            // This block previously handled "orphaned" users. 
            // With the sync logic above, we focus on the primary ID match first.
            // If needed we can re-add deep migration here.
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
                <Route path="access-denied" element={<AccessDeniedPage />} />

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
                <Route path="regulations" element={<RegulationManagerPage />} />
                <Route path="jurisprudence" element={<JurisprudenceSearch />} />
                <Route path="recommendations" element={<CouncilTrackingPage />} />
                <Route path="extracts" element={<ExtractsPage />} />
                {/* Reports and Settings moved to Protected Route above */}
                <Route path="minutes" element={<MinutesPage />} />
              </Route>

              {/* Presentation Mode - Full Screen, Protected but no MainLayout */}
              <Route path="/meetings/:id/presentation" element={
                <ProtectedRoute>
                  <PresentationControlPage />
                </ProtectedRoute>
              } />
              <Route path="/meetings/:id/projection" element={
                <ProtectedRoute>
                  <ProjectionPage />
                </ProtectedRoute>
              } />

              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </Router>
      </ErrorBoundary>
    </ToastProvider>
  );
}

export default App;
