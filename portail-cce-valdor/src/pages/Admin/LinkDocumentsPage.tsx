import React, { useState, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    Button,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Alert,
    List,
    ListItem,
    ListItemText,
    Chip,
    LinearProgress,
    Grid
} from '@mui/material';
import { Save, CheckCircle } from '@mui/icons-material';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { AccessControl } from '../../components/auth/AccessControl';

interface Document {
    id: string;
    name: string;
    agendaItemId?: string;
    linkedEntityId?: string;
    linkedEntityType?: string;
}

interface Meeting {
    id: string;
    title: string;
    date: string;
    agendaItems?: Array<{ id: string; title: string }>;
}

const LinkDocumentsPage: React.FC = () => {
    const [documents, setDocuments] = useState<Document[]>([]);
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [success, setSuccess] = useState(false);
    const [selections, setSelections] = useState<Record<string, { meetingId: string; agendaItemId: string }>>({});

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            // Load meetings
            const meetingsSnapshot = await getDocs(collection(db, 'meetings'));
            const meetingsData = meetingsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Meeting[];
            setMeetings(meetingsData);

            // Load documents linked to meetings
            const docsSnapshot = await getDocs(collection(db, 'documents'));
            const docsData = docsSnapshot.docs
                .map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Document[];
            const filteredDocs = docsData.filter(d => d.linkedEntityType === 'meeting');

            setDocuments(filteredDocs);

            // Pre-fill selections for documents that already have agendaItemId
            const initialSelections: Record<string, { meetingId: string; agendaItemId: string }> = {};
            filteredDocs.forEach(doc => {
                if (doc.agendaItemId && doc.linkedEntityId) {
                    initialSelections[doc.id] = {
                        meetingId: doc.linkedEntityId,
                        agendaItemId: doc.agendaItemId
                    };
                }
            });
            setSelections(initialSelections);
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleMeetingChange = (docId: string, meetingId: string) => {
        setSelections(prev => ({
            ...prev,
            [docId]: { meetingId, agendaItemId: '' }
        }));
    };

    const handleAgendaItemChange = (docId: string, agendaItemId: string) => {
        setSelections(prev => ({
            ...prev,
            [docId]: { ...prev[docId], agendaItemId }
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        setSuccess(false);
        try {
            const updates = Object.entries(selections).filter(([_, sel]) => sel.agendaItemId);

            for (const [docId, selection] of updates) {
                const docRef = doc(db, 'documents', docId);
                await updateDoc(docRef, {
                    linkedEntityId: selection.meetingId,
                    agendaItemId: selection.agendaItemId
                });
            }

            setSuccess(true);
            await loadData(); // Reload to show updated state
        } catch (error) {
            console.error('Error saving:', error);
            alert('Erreur lors de la sauvegarde');
        } finally {
            setSaving(false);
        }
    };

    const getSelectedMeeting = (docId: string): Meeting | undefined => {
        const meetingId = selections[docId]?.meetingId;
        return meetings.find(m => m.id === meetingId);
    };

    const documentsToLink = documents.filter(d => !d.agendaItemId || d.agendaItemId.startsWith('patched-') || !isNaN(Number(d.agendaItemId)));
    const linkedDocuments = documents.filter(d => d.agendaItemId && !d.agendaItemId.startsWith('patched-') && isNaN(Number(d.agendaItemId)));

    const formatMeetingDate = (dateValue: any): string => {
        if (!dateValue) return 'Date inconnue';
        try {
            // Handle Firestore Timestamp (instance or object)
            if (dateValue?.toDate && typeof dateValue.toDate === 'function') {
                return dateValue.toDate().toLocaleDateString('fr-CA');
            }
            if (dateValue?.seconds) {
                return new Date(dateValue.seconds * 1000).toLocaleDateString('fr-CA');
            }
            // Handle string or Date
            const date = new Date(dateValue);
            if (!isNaN(date.getTime())) {
                return date.toLocaleDateString('fr-CA');
            }
            return 'Date inconnue';
        } catch {
            return 'Date inconnue';
        }
    };

    if (loading) {
        return (
            <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
                <LinearProgress sx={{ width: '100%' }} />
            </Box>
        );
    }

    return (
        <AccessControl allowedRoles={['coordinator']}>
            <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h4" gutterBottom>
                        Lier les documents aux sujets de l'ODJ
                    </Typography>

                    <Alert severity="info" sx={{ mb: 3 }}>
                        <Typography variant="body2">
                            Cette page vous permet de lier manuellement les documents aux sujets de l'ordre du jour.
                            Une fois liés avec les nouveaux IDs stables, les liens perdureront définitivement.
                        </Typography>
                    </Alert>

                    {success && (
                        <Alert severity="success" icon={<CheckCircle />} sx={{ mb: 3 }}>
                            ✅ Liens sauvegardés avec succès ! Les documents sont maintenant liés aux sujets.
                        </Alert>
                    )}

                    <Box sx={{ mb: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            📎 Documents déjà liés : {linkedDocuments.length}
                        </Typography>
                        <Typography variant="h6" color="warning.main">
                            ⚠️ Documents à lier : {documentsToLink.length}
                        </Typography>
                    </Box>

                    {documentsToLink.length > 0 && (
                        <>
                            <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>
                                Documents à lier
                            </Typography>
                            <List>
                                {documentsToLink.map((document) => (
                                    <ListItem key={document.id} sx={{ display: 'block', mb: 2, p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                                        <Box sx={{ mb: 2 }}>
                                            <ListItemText
                                                primary={
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Typography variant="subtitle1" fontWeight="bold">{document.name}</Typography>
                                                        {document.agendaItemId && (
                                                            <Chip label={`Ancien ID: ${document.agendaItemId}`} size="small" color="warning" />
                                                        )}
                                                    </Box>
                                                }
                                            />
                                        </Box>
                                        <Grid container spacing={2}>
                                            <Grid size={{ xs: 12, md: 5 }}>
                                                <FormControl fullWidth size="small">
                                                    <InputLabel>Assemblée</InputLabel>
                                                    <Select
                                                        value={selections[document.id]?.meetingId || document.linkedEntityId || ''}
                                                        onChange={(e) => handleMeetingChange(document.id, e.target.value)}
                                                        label="Assemblée"
                                                        renderValue={(selected) => {
                                                            const m = meetings.find(m => m.id === selected);
                                                            return m ? `${formatMeetingDate(m.date)} - ${m.title}` : selected;
                                                        }}
                                                    >
                                                        {meetings.map(meeting => (
                                                            <MenuItem key={meeting.id} value={meeting.id}>
                                                                {formatMeetingDate(meeting.date)} - {meeting.title}
                                                            </MenuItem>
                                                        ))}
                                                    </Select>
                                                </FormControl>
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 7 }}>
                                                <FormControl fullWidth size="small" disabled={!selections[document.id]?.meetingId}>
                                                    <InputLabel>Sujet à l'ODJ</InputLabel>
                                                    <Select
                                                        value={selections[document.id]?.agendaItemId || ''}
                                                        onChange={(e) => handleAgendaItemChange(document.id, e.target.value)}
                                                        label="Sujet à l'ODJ"
                                                    >
                                                        {getSelectedMeeting(document.id)?.agendaItems?.map((item, index) => (
                                                            <MenuItem key={item.id} value={item.id}>
                                                                Point {index + 1}: {item.title}
                                                            </MenuItem>
                                                        )) || []}
                                                    </Select>
                                                </FormControl>
                                            </Grid>
                                        </Grid>
                                    </ListItem>
                                ))}
                            </List>

                            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                                <Button
                                    variant="contained"
                                    size="large"
                                    startIcon={saving ? <LinearProgress /> : <Save />}
                                    onClick={handleSave}
                                    disabled={saving}
                                >
                                    {saving ? 'Sauvegarde...' : 'Sauvegarder les liens'}
                                </Button>
                            </Box>
                        </>
                    )}

                    {documentsToLink.length === 0 && (
                        <Alert severity="success" icon={<CheckCircle />}>
                            🎉 Tous les documents sont déjà liés correctement !
                        </Alert>
                    )}
                </Paper>
            </Box>
        </AccessControl>
    );
};

export default LinkDocumentsPage;
