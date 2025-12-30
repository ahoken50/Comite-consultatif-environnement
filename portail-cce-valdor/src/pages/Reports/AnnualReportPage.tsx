import React, { useState } from 'react';
import {
    Box,
    Typography,
    Button,
    Card,
    CardContent,
    Grid,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Alert
} from '@mui/material';
import { PictureAsPdf } from '@mui/icons-material';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/rootReducer';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// Ensure jsPDF types are correct
interface jsPDFCustom extends jsPDF {
    lastAutoTable: { finalY: number };
}

const AnnualReportPage: React.FC = () => {
    const [year, setYear] = useState(new Date().getFullYear());
    const [loading, setLoading] = useState(false);

    // Fetch data from Redux
    const { items: projects } = useSelector((state: RootState) => state.projects);
    const { items: members } = useSelector((state: RootState) => state.members);
    const { items: meetings } = useSelector((state: RootState) => state.meetings);
    const recommendations = useSelector((state: RootState) => state.governance?.recommendations || []);

    const generatePDF = () => {
        setLoading(true);
        try {
            const doc = new jsPDF() as jsPDFCustom;

            // --- PAGE 1: COVER ---
            doc.setFillColor(46, 125, 50); // Green
            doc.rect(0, 0, 210, 297, 'F');

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(24);
            doc.setFont('helvetica', 'bold');
            doc.text(`Rapport Annuel ${year}`, 105, 120, { align: 'center' });

            doc.setFontSize(16);
            doc.text('Comité Consultatif en Environnement', 105, 140, { align: 'center' });
            doc.text('Ville de Val-d\'Or', 105, 150, { align: 'center' });

            doc.setFontSize(12);
            doc.text(`Généré le ${format(new Date(), 'd MMMM yyyy', { locale: fr })}`, 105, 250, { align: 'center' });

            doc.addPage();

            // --- PAGE 2: STATS ---
            doc.setFillColor(255, 255, 255); // White bg
            doc.setTextColor(0, 0, 0);

            doc.setFontSize(18);
            doc.text('Sommaire des Activités', 14, 20);

            const yearProjects = projects.filter(p => new Date(p.dateCreated).getFullYear() === year);
            const yearMeetings = meetings.filter(m => new Date(m.date).getFullYear() === year);
            const yearRecs = recommendations.filter(r => new Date(r.dateSent).getFullYear() === year);

            const stats = [
                ['Réunions tenues', yearMeetings.length.toString()],
                ['Projets initiés', yearProjects.length.toString()],
                ['Recommandations émises', yearRecs.length.toString()],
                ['Membres actifs au 31 déc.', members.filter(m => m.isActive).length.toString()]
            ];

            autoTable(doc, {
                startY: 30,
                head: [['Indicateur', 'Valeur']],
                body: stats,
                theme: 'striped',
                headStyles: { fillColor: [46, 125, 50] }
            });

            // --- PAGE 3: RECOMMENDATIONS ---
            const finalY = (doc as any).lastAutoTable?.finalY || 100;
            doc.text('Détail des Recommandations', 14, finalY + 20);

            const recRows = yearRecs.map(r => [
                format(new Date(r.dateSent), 'dd/MM'),
                r.projectName || r.projectId || 'N/A',
                r.status === 'accepted' ? 'Acceptée' : r.status === 'rejected' ? 'Refusée' : 'En cours'
            ]);

            autoTable(doc, {
                startY: finalY + 30,
                head: [['Date', 'Sujet', 'Statut']],
                body: recRows,
                headStyles: { fillColor: [46, 125, 50] }
            });

            doc.save(`Rapport_CCE_${year}.pdf`);

        } catch (err) {
            console.error('Error creating PDF', err);
            alert('Erreur lors de la création du PDF');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box p={3}>
            <Typography variant="h4" gutterBottom>Générateur de Rapport Annuel</Typography>
            <Alert severity="info" sx={{ mb: 4 }}>
                Ce module génère un PDF officiel résumant les activités du CCE pour l'année sélectionnée.
            </Alert>

            <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                    <Card>
                        <CardContent>
                            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                <FormControl fullWidth size="small">
                                    <InputLabel>Année Fiscale</InputLabel>
                                    <Select
                                        value={year}
                                        label="Année Fiscale"
                                        onChange={(e) => setYear(Number(e.target.value))}
                                    >
                                        {[2023, 2024, 2025, 2026].map(y => (
                                            <MenuItem key={y} value={y}>{y}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <Button
                                    variant="contained"
                                    startIcon={<PictureAsPdf />}
                                    onClick={generatePDF}
                                    disabled={loading}
                                    sx={{ minWidth: 200 }}
                                >
                                    {loading ? 'Génération...' : 'Télécharger PDF'}
                                </Button>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Box>
    );
};

export default AnnualReportPage;
