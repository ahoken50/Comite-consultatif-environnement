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

    return (
        <Box sx={{ p: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" component="h1" gutterBottom>
                    Registre des Extraits de Procès-Verbaux
                </Typography>
            </Box>
            
            <TableContainer component={Paper}>
                {loading ? (
                    <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
                         <CircularProgress />
                    </Box>
                ) : (
                    <Table>
                       <TableHead>
                          <TableRow>
                             <TableCell sx={{ fontWeight: 'bold' }}>Ref. Extrait</TableCell>
                             <TableCell sx={{ fontWeight: 'bold' }}>Sujet / Titre de la Résolution</TableCell>
                             <TableCell sx={{ fontWeight: 'bold' }}>Date de Réunion (CCE)</TableCell>
                             <TableCell sx={{ fontWeight: 'bold' }}>Généré le</TableCell>
                             <TableCell align="right" sx={{ fontWeight: 'bold' }}>Actions</TableCell>
                          </TableRow>
                       </TableHead>
                       <TableBody>
                          {extracts.map(ex => (
                              <TableRow key={ex.id} hover>
                                  <TableCell>
                                      <Chip 
                                          label={ex.extractNumber || '---'} 
                                          color="primary" 
                                          variant="filled" 
                                          size="small" 
                                          sx={{ fontWeight: 'bold', fontSize: '1rem', p: 1 }}
                                      />
                                  </TableCell>
                                  <TableCell>{ex.title}</TableCell>
                                  <TableCell>
                                      {ex.meetingDate ? format(new Date(ex.meetingDate), 'd MMMM yyyy', { locale: fr }) : 'N/A'}
                                  </TableCell>
                                  <TableCell>
                                      {ex.uploadedAt ? format(new Date(ex.uploadedAt), 'd MMM yyyy', { locale: fr }) : 'N/A'}
                                  </TableCell>
                                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                      <Button 
                                          startIcon={<OpenInNewIcon />} 
                                          component="a" 
                                          href={ex.url} 
                                          target="_blank" 
                                          size="small"
                                          variant="outlined"
                                          sx={{ mr: 1 }}
                                      >
                                          Consulter
                                      </Button>
                                      <AccessControl allowedRoles={['coordinator']}>
                                          <IconButton size="small" color="error" onClick={() => ex.id && handleDelete(ex.id)}>
                                              <DeleteIcon />
                                          </IconButton>
                                      </AccessControl>
                                  </TableCell>
                              </TableRow>
                          ))}
                          {extracts.length === 0 && (
                              <TableRow>
                                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                                      <Typography variant="body1" color="text.secondary">
                                          Aucun extrait trouvé. Les extraits peuvent être générés depuis l'étape de finalisation d'un PV approuvé.
                                      </Typography>
                                  </TableCell>
                              </TableRow>
                          )}
                       </TableBody>
                    </Table>
                )}
            </TableContainer>
        </Box>
    );
};

export default ExtractsPage;
