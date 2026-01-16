import React, { useState } from 'react';
import {
    Box,
    Paper,
    Typography,
    Button,
    Alert,
    LinearProgress,
    List,
    ListItem,
    ListItemText,
    Divider
} from '@mui/material';
import { PlayArrow, CheckCircle } from '@mui/icons-material';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { AccessControl } from '../../components/auth/AccessControl';

interface MigrationLog {
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
}

const MigrateAgendaIdsPage: React.FC = () => {
    const [isRunning, setIsRunning] = useState(false);
    const [isDone, setIsDone] = useState(false);
    const [logs, setLogs] = useState<MigrationLog[]>([]);

    const addLog = (type: MigrationLog['type'], message: string) => {
        setLogs(prev => [...prev, { type, message }]);
    };

    const runMigration = async () => {
        setIsRunning(true);
        setIsDone(false);
        setLogs([]);

        try {
            addLog('info', '🚀 Démarrage de la migration...');

            // Step 1: Fetch all meetings
            addLog('info', '📋 Récupération des assemblées...');
            const meetingsSnapshot = await getDocs(collection(db, 'meetings'));
            const meetings = meetingsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Array<{ id: string; agendaItems?: any[] }>;
            addLog('success', `✅ ${meetings.length} assemblées trouvées`);

            // Step 2: Build ID mapping
            addLog('info', '🔄 Création du mapping des IDs...');
            const idMapping = new Map<string, { newId: string; meetingId: string; title: string }>();

            for (const meeting of meetings) {
                if (!meeting.agendaItems || meeting.agendaItems.length === 0) continue;

                meeting.agendaItems.forEach((item: any, index: number) => {
                    const oldId = item.id;
                    const newId = `${meeting.id}-item-${index}`;

                    if (oldId && oldId.startsWith('patched-')) {
                        idMapping.set(oldId, {
                            newId,
                            meetingId: meeting.id,
                            title: item.title
                        });
                    }
                });
            }
            addLog('success', `✅ ${idMapping.size} mappings créés`);

            // Step 3: Fetch all documents
            addLog('info', '📄 Récupération des documents...');
            const documentsSnapshot = await getDocs(collection(db, 'documents'));
            const allDocuments = documentsSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Array<{ id: string; agendaItemId?: string; name?: string; linkedEntityType?: string }>;

            // Filter only meeting documents
            const documents = allDocuments.filter(d => d.linkedEntityType === 'meeting');
            addLog('success', `✅ ${documents.length} documents d'assemblées trouvés (${allDocuments.length} total)`);

            // Log all agendaItemIds for debugging
            const docsWithAgendaId = documents.filter(d => d.agendaItemId);
            if (docsWithAgendaId.length > 0) {
                addLog('info', `📎 ${docsWithAgendaId.length} documents ont un agendaItemId:`);
                docsWithAgendaId.forEach(d => {
                    addLog('info', `   - "${d.name}": ${d.agendaItemId}`);
                });
            } else {
                addLog('warning', '⚠️ Aucun document ne possède d\'agendaItemId');
            }

            // Step 4: Find documents to update
            addLog('info', '🔍 Identification des documents à mettre à jour...');
            const documentsToUpdate: Array<{ docId: string; oldId: string; newId: string; name: string }> = [];

            for (const document of documents) {
                if (document.agendaItemId && idMapping.has(document.agendaItemId)) {
                    const mapping = idMapping.get(document.agendaItemId)!;
                    documentsToUpdate.push({
                        docId: document.id,
                        oldId: document.agendaItemId,
                        newId: mapping.newId,
                        name: document.name || 'Sans nom'
                    });
                }
            }
            addLog('success', `✅ ${documentsToUpdate.length} documents à mettre à jour`);

            if (documentsToUpdate.length === 0) {
                addLog('warning', '⚠️ Aucun document à mettre à jour');
                setIsDone(true);
                setIsRunning(false);
                return;
            }

            // Step 5: Update documents in batches
            addLog('info', '💾 Mise à jour des documents...');
            const batchSize = 500;
            let updatedCount = 0;

            for (let i = 0; i < documentsToUpdate.length; i += batchSize) {
                const batch = writeBatch(db);
                const batchDocs = documentsToUpdate.slice(i, i + batchSize);

                for (const { docId, newId } of batchDocs) {
                    const docRef = doc(db, 'documents', docId);
                    batch.update(docRef, { agendaItemId: newId });
                }

                await batch.commit();
                updatedCount += batchDocs.length;
                addLog('info', `  ✅ ${updatedCount} / ${documentsToUpdate.length} documents mis à jour`);
            }

            addLog('success', '🎉 Migration terminée avec succès !');
            addLog('info', `   - ${updatedCount} documents mis à jour`);
            addLog('info', '   - Les associations document-sujet ont été restaurées');

            setIsDone(true);
        } catch (error) {
            console.error('Migration error:', error);
            addLog('error', `❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <AccessControl allowedRoles={['coordinator']}>
            <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h4" gutterBottom>
                        Migration des IDs de sujets à l'ODJ
                    </Typography>

                    <Alert severity="info" sx={{ mb: 3 }}>
                        <Typography variant="body2" gutterBottom>
                            <strong>Objectif :</strong> Mettre à jour les liens entre les documents et les sujets de l'ordre du jour.
                        </Typography>
                        <Typography variant="body2">
                            <strong>Problème résolu :</strong> Les IDs des sujets changeaient à chaque chargement, cassant les associations avec les documents.
                            Cette migration met à jour tous les documents pour utiliser les nouveaux IDs stables.
                        </Typography>
                    </Alert>

                    {!isDone && !isRunning && (
                        <Button
                            variant="contained"
                            size="large"
                            startIcon={<PlayArrow />}
                            onClick={runMigration}
                            color="primary"
                        >
                            Lancer la migration
                        </Button>
                    )}

                    {isRunning && (
                        <>
                            <LinearProgress sx={{ my: 2 }} />
                            <Typography variant="body2" color="text.secondary">
                                Migration en cours...
                            </Typography>
                        </>
                    )}

                    {logs.length > 0 && (
                        <>
                            <Divider sx={{ my: 3 }} />
                            <Typography variant="h6" gutterBottom>
                                Journal d'exécution
                            </Typography>
                            <Paper variant="outlined" sx={{ maxHeight: 400, overflow: 'auto', p: 2, bgcolor: '#f5f5f5' }}>
                                <List dense>
                                    {logs.map((log, index) => (
                                        <ListItem key={index} sx={{ py: 0.5 }}>
                                            <ListItemText
                                                primary={log.message}
                                                primaryTypographyProps={{
                                                    variant: 'body2',
                                                    sx: {
                                                        fontFamily: 'monospace',
                                                        color: log.type === 'error' ? 'error.main' :
                                                            log.type === 'success' ? 'success.main' :
                                                                log.type === 'warning' ? 'warning.main' : 'text.primary'
                                                    }
                                                }}
                                            />
                                        </ListItem>
                                    ))}
                                </List>
                            </Paper>
                        </>
                    )}

                    {isDone && (
                        <Alert severity="success" icon={<CheckCircle />} sx={{ mt: 3 }}>
                            <Typography variant="body1">
                                <strong>Migration terminée !</strong>
                            </Typography>
                            <Typography variant="body2">
                                Rafraîchissez la page d'une assemblée pour voir les pièces jointes affichées sous les sujets de l'ODJ.
                            </Typography>
                        </Alert>
                    )}
                </Paper>
            </Box>
        </AccessControl>
    );
};

export default MigrateAgendaIdsPage;
