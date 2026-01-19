import React, { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useMeetingSubscription } from '../../hooks/useMeetingSubscription';
import {
    Box,
    Typography,
    Button,
    Paper,
    Tabs,
    Tab,
    Divider,
    Chip,
    Grid,
    Alert
} from '@mui/material';
import { CalendarToday, LocationOn, CloudUpload, Send, PlayArrow } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import { updateMeeting } from '../../features/meetings/meetingsSlice';
import { fetchDocumentsByEntity, deleteDocument, updateDocument, uploadDocument } from '../../features/documents/documentsSlice';
import AgendaBuilder from '../../components/meetings/AgendaBuilder';
import MinutesEditor from '../../components/meetings/MinutesEditor';
import AttendanceManager from '../../components/meetings/AttendanceManager';
import MeetingForm from '../../components/meetings/MeetingForm';
import DocumentList from '../../components/documents/DocumentList';
import DocumentUpload from '../../components/documents/DocumentUpload';
import ProjectExtractor from '../../components/meetings/ProjectExtractor';
import BulkUploadModal from '../../components/documents/BulkUploadModal';
import type { AgendaItem } from '../../types/meeting.types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useToast } from '../../hooks/useToast';
import ConvocationDialog from '../../components/meetings/ConvocationDialog';
import ConvocationDashboard from '../../components/meetings/ConvocationDashboard';
import MeetingApprovalCard from '../../components/meetings/MeetingApprovalCard';
import ApprovalRequestsPanel from '../../components/meetings/ApprovalRequestsPanel';
import MeetingChecklist from '../../components/meetings/MeetingChecklist';
import { fetchMembers } from '../../features/members/membersSlice';
import Breadcrumbs from '../../components/common/Breadcrumbs';
import { AccessControl } from '../../components/auth/AccessControl';
import { hasAnyConvocation } from '../../services/convocationService';

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`meeting-tabpanel-${index}`}
            aria-labelledby={`meeting-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ p: 3 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

const MeetingDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    useMeetingSubscription(id);

    const dispatch = useDispatch<AppDispatch>();
    const { showInfo, showSuccess, showError } = useToast();
    const meeting = useSelector((state: RootState) =>
        state.meetings.items.find(m => m.id === id)
    );
    const { items: documents } = useSelector((state: RootState) => state.documents);
    const { user } = useSelector((state: RootState) => state.auth);
    const { items: members } = useSelector((state: RootState) => state.members);
    const currentMember = members.find(m => m.id === (user?.id || user?.uid) || m.email === user?.email);
    const isCoordinator = user?.role === 'coordinator';

    const [tabValue, setTabValue] = useState(0);
    const [hasConvocation, setHasConvocation] = useState(false);

    const location = useLocation();

    useEffect(() => {
        if (id) {
            dispatch(fetchDocumentsByEntity({ entityId: id, entityType: 'meeting' }));
            dispatch(fetchMembers());

            // Check if convocation has been sent (Avis or Regular)
            hasAnyConvocation(id).then(hasSent => {
                setHasConvocation(hasSent);
            }).catch(err => {
                console.warn('Could not check convocation status:', err);
            });
        }
    }, [dispatch, id]);

    useEffect(() => {
        if (location.state && (location.state as any).tab !== undefined) {
            setTabValue((location.state as any).tab);
        }

        // Handle hash scrolling
        if (location.hash) {
            const hash = location.hash.substring(1);

            // Switch tabs based on hash target
            if (hash === 'minutes-content' || hash.startsWith('resolution-')) {
                setTabValue(1); // PV Tab
            } else if (hash.startsWith('item-')) {
                setTabValue(0); // Agenda Tab
            }

            // Valid IDs might contain special chars from legacy data, escape if needed or just use as is if simple
            const elementId = hash;

            // Slight delay to ensure content is rendered/tab switched
            setTimeout(() => {
                const element = document.getElementById(elementId);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Highlight effect
                    element.style.transition = 'background-color 0.5s ease';
                    const originalBg = element.style.backgroundColor;
                    element.style.backgroundColor = '#fff9c4'; // Yellow highlight
                    element.style.boxShadow = '0 0 10px rgba(255, 193, 7, 0.5)';

                    setTimeout(() => {
                        element.style.backgroundColor = originalBg;
                        element.style.boxShadow = '';
                    }, 3000);
                }
            }, 600);
        }
    }, [location.state, location.hash, meeting]);

    // Bulk Upload State and Handler
    const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);

    const handleBulkUploadComplete = async (files: File[], assignments: Record<string, string>) => {
        if (!meeting) return;

        showSuccess(`Téléversement de ${files.length} fichiers en cours...`);

        // Upload each file
        for (const file of files) {
            try {
                await dispatch(uploadDocument({
                    file,
                    linkedEntityId: meeting.id,
                    linkedEntityType: 'meeting',
                    uploadedBy: user?.id,
                    agendaItemId: assignments[file.name]
                        ? meeting.agendaItems?.find(i => i.title === assignments[file.name])?.id
                        : undefined
                })).unwrap();
            } catch (e) {
                console.error(`Failed to upload ${file.name}`, e);
                showError(`Erreur: ${file.name}`);
            }
        }
        showSuccess('Importation terminée !');
        dispatch(fetchDocumentsByEntity({ entityId: meeting.id, entityType: 'meeting' }));
    };

    const handleAgendaUpdate = (newItems: AgendaItem[]) => {
        if (id) {
            dispatch(updateMeeting({ id, updates: { agendaItems: newItems } }));
        }
    };

    const handleDocumentUnlink = (docId: string) => {
        dispatch(updateDocument({ id: docId, updates: { agendaItemId: null as any } }));
    };

    const handleDocumentDelete = (docId: string, storagePath: string) => {
        dispatch(deleteDocument({ id: docId, storagePath }));
    };

    // Patch: Convert old unstable "patched-*" IDs to new stable IDs
    useEffect(() => {
        if (meeting && meeting.agendaItems && meeting.agendaItems.length > 0) {
            // Check if any items have old "patched-*" IDs or no IDs
            const needsConversion = meeting.agendaItems.some(item =>
                !item.id || item.id.startsWith('patched-')
            );

            if (needsConversion && isCoordinator) {
                console.log('⚠️ Converting agenda item IDs to stable format...');
                const patchedItems = meeting.agendaItems.map((item, index) => ({
                    ...item,
                    // Use stable ID based on meeting ID + index (not Date.now()!)
                    id: `${meeting.id}-item-${index}`
                }));
                dispatch(updateMeeting({ id: meeting.id, updates: { agendaItems: patchedItems } }));
            }
        }
    }, [meeting, dispatch, isCoordinator]);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isConvocationDialogOpen, setIsConvocationDialogOpen] = useState(false);

    // Early return moved to after all hooks to satisfy Rules of Hooks
    if (!meeting) {
        return <Typography>Réunion non trouvée</Typography>;
    }

    const handleMeetingUpdate = (updatedData: any) => {
        if (id) {
            dispatch(updateMeeting({
                id,
                updates: {
                    ...updatedData
                }
            }));
            setIsEditModalOpen(false);
        }
    };

    const handleConvocationSuccess = (sentCount: number, type: 'avis' | 'confirmation') => {
        const message = type === 'avis'
            ? `✅ Avis de convocation envoyé à ${sentCount} membre${sentCount !== 1 ? 's' : ''}!`
            : `✅ Ordre du jour et RSVP envoyés à ${sentCount} membre${sentCount !== 1 ? 's' : ''}!`;
        showInfo(message);
        setHasConvocation(true); // Update checklist immediately
    };

    const handleConvocationError = (error: string) => {
        showInfo(`❌ Erreur: ${error}`);
    };

    const handleApproval = (role: 'president' | 'elected_official' | 'coordinator') => {
        if (!id || !currentMember) return;

        const newSignature = {
            role,
            signedBy: currentMember.id,
            signedByName: currentMember.displayName,
            signedAt: new Date().toISOString()
        };

        const currentSignatures = meeting.approvalSignatures || [];
        // Prevent duplicate signatures for same role
        if (currentSignatures.some(s => s.role === role)) return;

        const updatedSignatures = [...currentSignatures, newSignature];

        let newStatus = meeting.approvalStatus || 'draft';
        // If both roles have signed (checking new list)
        const hasPresident = updatedSignatures.some(s => s.role === 'president');
        const hasElected = updatedSignatures.some(s => s.role === 'elected_official');

        if (role === 'coordinator') {
            newStatus = 'approved';
        } else if (hasPresident && hasElected) {
            newStatus = 'approved';
        } else if (hasPresident || hasElected) {
            newStatus = 'waiting_approval';
        }

        dispatch(updateMeeting({
            id,
            updates: {
                approvalSignatures: updatedSignatures,
                approvalStatus: newStatus as any
            }
        }));
    };

    return (
        <Box>
            <Breadcrumbs
                items={[
                    { label: 'Accueil', to: '/dashboard' },
                    { label: 'Réunions', to: '/meetings' },
                    { label: meeting.title || 'Détail de la réunion' }
                ]}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <AccessControl allowedRoles={['coordinator']}>
                        {meeting.status !== 'completed' && (
                            <Button
                                variant="outlined"
                                color="secondary"
                                startIcon={<PlayArrow />}
                                onClick={() => window.open(`/meetings/${id}/presentation`, '_blank')}
                                sx={{ mr: 2 }}
                            >
                                Mode Présentation
                            </Button>
                        )}
                        <Button
                            variant="outlined"
                            color="primary"
                            startIcon={<Send />}
                            onClick={() => setIsConvocationDialogOpen(true)}
                        >
                            Convoquer
                        </Button>
                    </AccessControl>
                    <ProjectExtractor meeting={meeting} />
                    <AccessControl allowedRoles={['coordinator']}>
                        <Button
                            variant="contained"
                            onClick={() => setIsEditModalOpen(true)}
                        >
                            Modifier la réunion
                        </Button>
                    </AccessControl>
                </Box>
            </Box>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Box>
                        <Typography variant="h4" fontWeight={700} gutterBottom>
                            {meeting.title}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                            <Chip label={meeting.type === 'regular' ? 'Régulière' : meeting.type === 'special' ? 'Spéciale' : 'Urgence'} variant="outlined" />
                            <Chip label={meeting.status === 'scheduled' ? 'Planifiée' : meeting.status === 'in_progress' ? 'En cours' : meeting.status === 'completed' ? 'Terminée' : 'Annulée'} color="primary" />
                        </Box>
                        <Box sx={{ display: 'flex', gap: 3, color: 'text.secondary' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CalendarToday fontSize="small" />
                                <Typography variant="body2">
                                    {format(new Date(meeting.date), 'd MMMM yyyy à HH:mm', { locale: fr })}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <LocationOn fontSize="small" />
                                <Typography variant="body2">{meeting.location}</Typography>
                            </Box>
                        </Box>
                    </Box>
                </Box>

                <Divider sx={{ my: 2 }} />

                {/* #3.1 Meeting Preparation Checklist */}
                {meeting.status === 'scheduled' && (
                    <MeetingChecklist meeting={meeting} hasConvocation={hasConvocation} />
                )}

                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
                        <Tab label="Ordre du jour" />
                        <Tab label="Procès-verbal" />
                        <Tab label="Présences" />
                        <Tab label="Documents" />
                    </Tabs>
                </Box>

                <TabPanel value={tabValue} index={0}>
                    <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                            startIcon={<CloudUpload />}
                            variant="outlined"
                            size="small"
                            onClick={() => setIsBulkUploadOpen(true)}
                        >
                            Ajouter en lot (IA)
                        </Button>
                    </Box>
                    <AgendaBuilder
                        items={meeting.agendaItems || []}
                        onItemsChange={handleAgendaUpdate}
                        meetingId={meeting.id}
                        meeting={meeting}
                        documents={documents.filter(d => d.linkedEntityId === meeting.id)}
                        onDocumentUpload={() => dispatch(fetchDocumentsByEntity({ entityId: meeting.id, entityType: 'meeting' }))}
                        initialAgendaItemId={(location.state as any)?.agendaItemId}
                        onDocumentUnlink={handleDocumentUnlink}
                        onDocumentDelete={handleDocumentDelete}
                        readOnly={!isCoordinator}
                        canPropose={true}
                    />
                </TabPanel>

                <TabPanel value={tabValue} index={1}>
                    <MeetingApprovalCard
                        meeting={meeting}
                        currentUser={currentMember || null}
                        onApprove={handleApproval}
                    />
                    {/* Panel showing approval requests and their comments */}
                    <ApprovalRequestsPanel meetingId={meeting.id} />
                    <Divider sx={{ my: 3 }} />

                    {/* Minutes Visibility Logic */}
                    {(isCoordinator ||
                        ['president', 'elected_official'].includes(user?.role || '') ||
                        meeting.approvalStatus === 'final' ||
                        meeting.approvalStatus === 'approved' ||
                        meeting.status === 'completed') ? (
                        <MinutesEditor
                            meeting={meeting}
                            onUpdate={handleMeetingUpdate}
                            readOnly={!isCoordinator}
                        />
                    ) : (
                        <Alert severity="info" sx={{ mt: 2 }}>
                            Le procès-verbal n'est pas encore disponible pour consultation.
                        </Alert>
                    )}
                </TabPanel>

                <TabPanel value={tabValue} index={2}>
                    <AccessControl allowedRoles={['coordinator']}>
                        <ConvocationDashboard
                            meeting={meeting}
                            onUpdate={() => dispatch(updateMeeting({ id: meeting.id, updates: { ...meeting } }))}
                        />
                        <Divider sx={{ my: 4 }} />
                    </AccessControl>

                    <Typography variant="h6" gutterBottom>Présences</Typography>
                    <AttendanceManager
                        meeting={meeting}
                        onUpdate={isCoordinator ? handleMeetingUpdate : () => { }}
                        readOnly={!isCoordinator}
                    />
                </TabPanel>

                <TabPanel value={tabValue} index={3}>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 8 }}>
                            <Typography variant="h6" gutterBottom>Documents de la réunion</Typography>
                            <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
                                <Button
                                    startIcon={<CloudUpload />}
                                    variant="outlined"
                                    size="small"
                                    onClick={() => setIsBulkUploadOpen(true)}
                                >
                                    Mode en lot (IA)
                                </Button>
                            </Box>
                            <DocumentList
                                documents={documents.filter(d => d.linkedEntityId === meeting.id)}
                                onDelete={(docId, path) => dispatch(deleteDocument({ id: docId, storagePath: path }))}
                                agendaItems={meeting.agendaItems}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                            <Typography variant="h6" gutterBottom>Ajouter</Typography>
                            <DocumentUpload
                                linkedEntityId={meeting.id}
                                linkedEntityType="meeting"
                                onUploadComplete={() => dispatch(fetchDocumentsByEntity({ entityId: meeting.id, entityType: 'meeting' }))}
                            />
                        </Grid>
                    </Grid>
                </TabPanel>
            </Paper>

            {isEditModalOpen && (
                <MeetingForm
                    open={isEditModalOpen}
                    onClose={() => setIsEditModalOpen(false)}
                    onSubmit={handleMeetingUpdate}
                    initialData={meeting}
                />
            )}

            {/* Convocation Dialog */}
            {currentMember && (
                <ConvocationDialog
                    open={isConvocationDialogOpen}
                    meeting={meeting}
                    currentMember={currentMember}
                    onClose={() => setIsConvocationDialogOpen(false)}
                    onSuccess={handleConvocationSuccess}
                    onError={handleConvocationError}
                />
            )}

            {/* Bulk Upload Modal */}
            {meeting && (
                <BulkUploadModal
                    open={isBulkUploadOpen}
                    onClose={() => setIsBulkUploadOpen(false)}
                    meeting={meeting}
                    onUploadComplete={handleBulkUploadComplete}
                />
            )}
        </Box>
    );
};

export default MeetingDetailPage;
