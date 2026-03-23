import React, { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, Button, CircularProgress, IconButton
} from '@mui/material';
import { OpenInNew as OpenInNewIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { collection, query, orderBy, getDocs, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import type { MinuteExtract } from '../../services/pdfServiceExtract';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { AccessControl } from '../../components/auth/AccessControl';

const ExtractsPage: React.FC = () => {
    const [extracts, setExtracts] = useState<MinuteExtract[]>([]);
    const [loading, setLoading] = useState(true);
    const [generatingId, setGeneratingId] = useState<string | null>(null);

    useEffect(() => {
        const fetchExtracts = async () => {
            try {
                const q = query(collection(db, 'extracts'), orderBy('uploadedAt', 'desc'));
                const snapshot = await getDocs(q);
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MinuteExtract));
                setExtracts(data);
            } catch (error) {
                console.error("Erreur de chargement des extraits", error);
            } finally {
                setLoading(false);
            }
        };
        fetchExtracts();
    }, []);

    const handleDelete = async (id: string) => {
        if (window.confirm("Êtes-vous sûr de vouloir supprimer cet extrait ?")) {
            try {
                await deleteDoc(doc(db, 'extracts', id));
                setExtracts(prev => prev.filter(e => e.id !== id));
            } catch (error) {
                console.error("Erreur lors de la suppression de l'extrait", error);
                alert("Impossible de supprimer l'extrait.");
            }
        }
    };

    const handleGeneratePDF = async (extract: MinuteExtract) => {
        try {
            setGeneratingId(extract.id || null);
            const { getDoc, doc } = await import('firebase/firestore');
            const { db } = await import('../../services/firebase');
            
            const meetingDoc = await getDoc(doc(db, 'meetings', extract.meetingId));
            if (!meetingDoc.exists()) {
                alert("Réunion introuvable.");
                return;
            }
            
            const meeting = { id: meetingDoc.id, ...meetingDoc.data() } as any;
            const item = meeting.agendaItems?.find((a: any) => a.id === extract.agendaItemId) || null;
            if (!item) {
                alert("Point à l'ordre du jour introuvable dans cette réunion.");
                return;
            }
            
            const orderMatch = extract.extractNumber?.match(/EXT-(\d+)/);
            const orderNumber = orderMatch ? parseInt(orderMatch[1], 10) : 1;
            
            const { generateExtractPDF_WindowPrint } = await import('../../services/pdfServiceExtract');
            await generateExtractPDF_WindowPrint(meeting, item, orderNumber);
            
        } catch (error) {
            console.error("Erreur génération PDF:", error);
            alert("Erreur lors de la génération du PDF.");
        } finally {
            setGeneratingId(null);
        }
    };

    // Group extracts by meeting
    const groupedExtracts = extracts.reduce((acc, ex) => {
        if (!acc[ex.meetingId]) acc[ex.meetingId] = [];
        acc[ex.meetingId].push(ex);
        return acc;
    }, {} as Record<string, MinuteExtract[]>);

    const sortedMeetingIds = Object.keys(groupedExtracts).sort((a, b) => {
        const dateA = new Date(groupedExtracts[a][0].meetingDate || 0).getTime();
        const dateB = new Date(groupedExtracts[b][0].meetingDate || 0).getTime();
        return dateB - dateA;
    });

    return (
        <Box sx={{ p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" component="h1" gutterBottom>
                    Registre des Extraits de Procès-Verbaux
                </Typography>
            </Box>
            
            {loading ? (
                <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
                     <CircularProgress />
                </Box>
            ) : sortedMeetingIds.length > 0 ? (
                sortedMeetingIds.map(meetingId => {
                    const group = groupedExtracts[meetingId];
                    // Sort extracts within a meeting by their EXT number
                    const sortedGroup = [...group].sort((a, b) => {
                        const numA = parseInt(a.extractNumber?.match(/\d+/)?.[0] || '0');
                        const numB = parseInt(b.extractNumber?.match(/\d+/)?.[0] || '0');
                        return numA - numB;
                    });
                    
                    const meetingDateStr = group[0].meetingDate 
                        ? format(new Date(group[0].meetingDate), 'd MMMM yyyy', { locale: fr })
                        : 'Date inconnue';

                    return (
                        <Box key={meetingId} mb={5}>
                            <Typography variant="h6" gutterBottom color="primary" sx={{ borderBottom: '2px solid', borderColor: 'divider', pb: 1 }}>
                                Assemblée du {meetingDateStr}
                            </Typography>
                            <TableContainer component={Paper} elevation={2}>
                                <Table size="small">
                                   <TableHead sx={{ backgroundColor: 'background.default' }}>
                                      <TableRow>
                                         <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Ref. Extrait</TableCell>
                                         <TableCell sx={{ fontWeight: 'bold', width: '50%' }}>Sujet / Titre de la Résolution</TableCell>
                                         <TableCell sx={{ fontWeight: 'bold', width: '20%' }}>Généré le</TableCell>
                                         <TableCell align="right" sx={{ fontWeight: 'bold', width: '15%' }}>Actions</TableCell>
                                      </TableRow>
                                   </TableHead>
                                   <TableBody>
                                      {sortedGroup.map(ex => (
                                          <TableRow key={ex.id} hover>
                                              <TableCell>
                                                  <Chip 
                                                      label={ex.extractNumber || '---'} 
                                                      color="primary" 
                                                      variant="outlined" 
                                                      size="small" 
                                                  />
                                              </TableCell>
                                              <TableCell>{ex.title}</TableCell>
                                              <TableCell>
                                                  {ex.uploadedAt ? format(new Date(ex.uploadedAt), 'd MMM yyyy, HH:mm', { locale: fr }) : 'N/A'}
                                              </TableCell>
                                              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                                  <Button 
                                                      startIcon={generatingId === ex.id ? <CircularProgress size={16} color="inherit" /> : <OpenInNewIcon />} 
                                                      onClick={() => handleGeneratePDF(ex)}
                                                      disabled={generatingId === ex.id}
                                                      size="small"
                                                      variant="contained"
                                                      disableElevation
                                                      sx={{ mr: 1 }}
                                                  >
                                                      Consulter
                                                  </Button>
                                                  <AccessControl allowedRoles={['coordinator']}>
                                                      <IconButton size="small" color="error" onClick={() => ex.id && handleDelete(ex.id)}>
                                                          <DeleteIcon fontSize="small" />
                                                      </IconButton>
                                                  </AccessControl>
                                              </TableCell>
                                          </TableRow>
                                      ))}
                                   </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>
                    );
                })
            ) : (
                <Paper sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body1" color="text.secondary">
                        Aucun extrait trouvé. Les extraits peuvent être générés depuis l'étape de finalisation d'un PV approuvé.
                    </Typography>
                </Paper>
            )}
        </Box>
    );
};

export default ExtractsPage;
