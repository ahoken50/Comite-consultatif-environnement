import React, { useState, useMemo } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    FormGroup,
    FormControlLabel,
    Checkbox,
    Typography,
    Box,
    TextField,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Grid,
    ListItemButton
} from '@mui/material';
import { AutoAwesome } from '@mui/icons-material';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/rootReducer';
import { ProjectStatus } from '../../types/project.types';
import { MeetingStatus } from '../../types/meeting.types';
import type { AgendaItem } from '../../types/meeting.types';

interface SmartPlanningDialogProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (meetingData: any) => void;
}

const SmartPlanningDialog: React.FC<SmartPlanningDialogProps> = ({ open, onClose, onConfirm }) => {
    const { items: projects } = useSelector((state: RootState) => state.projects);
    const { items: meetings } = useSelector((state: RootState) => state.meetings);

    const [selectedProjects, setSelectedProjects] = useState<Record<string, boolean>>({});
    const [includeReview, setIncludeReview] = useState(true);
    const [includeVaria, setIncludeVaria] = useState(true);
    const [includeQuestions, setIncludeQuestions] = useState(true);
    const [includeRollover, setIncludeRollover] = useState(false);

    // Find last completed meeting
    const lastCompletedMeeting = useMemo(() => {
        return [...meetings]
            .filter(m => m.status === MeetingStatus.COMPLETED)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    }, [meetings]);

    // Candidates for rollover (non-standard items)
    const rolloverItems = useMemo(() => {
        if (!lastCompletedMeeting) return [];
        const standardTitles = ['Ouverture', 'adoption', 'Levée', 'Varia', 'Période de questions'];
        return lastCompletedMeeting.agendaItems.filter(item =>
            !standardTitles.some(t => item.title.toLowerCase().includes(t.toLowerCase()))
        );
    }, [lastCompletedMeeting]);

    const [meetingDate, setMeetingDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() + 7); // Default next week
        return d.toISOString().split('T')[0];
    });

    // Filter relevant projects for discussion
    const activeProjects = useMemo(() => {
        return projects.filter(p =>
            p.status === ProjectStatus.IN_PROGRESS ||
            p.status === ProjectStatus.PENDING ||
            p.status === ProjectStatus.TO_CLARIFY
        );
    }, [projects]);

    // Initialize selection state once
    React.useEffect(() => {
        if (open) {
            const initialSelection: Record<string, boolean> = {};
            activeProjects.forEach(p => {
                // Determine if urgent or high priority, autoselect
                const isPriority = p.priority === 'high' || p.priority === 'critical' || p.isUrgent;
                initialSelection[p.id] = !!isPriority;
            });
            setSelectedProjects(initialSelection);
        }
    }, [open, activeProjects]);

    const handleProjectToggle = (id: string) => {
        setSelectedProjects(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const handleCreate = () => {
        const agendaItems: Partial<AgendaItem>[] = [];
        let order = 1;

        if (includeReview) {
            agendaItems.push({
                title: 'Ouverture de l\'assemblée et adoption de l\'ordre du jour',
                description: 'Vérification du quorum et adoption.',
                duration: 5,
                presenter: 'Président',
                objective: 'Décision',
                order: order++
            });
            agendaItems.push({
                title: 'Revue et adoption du procès-verbal précédent',
                description: 'Lecture et adoption du PV de la dernière réunion.',
                duration: 10,
                presenter: 'Secrétaire',
                objective: 'Décision',
                order: order++
            });
        }

        // Add selected projects
        activeProjects.forEach(p => {
            if (selectedProjects[p.id]) {
                agendaItems.push({
                    title: `Suivi: ${p.name}`,
                    description: `État d'avancement et prochaines étapes.\n${p.nextSteps || ''}`,
                    duration: 15,
                    presenter: 'Coordonnateur',
                    objective: 'Information/Direction',
                    linkedProjectId: p.id,
                    order: order++
                });
            }
        });

        if (includeVaria) {
            agendaItems.push({
                title: 'Varia',
                description: 'Points divers.',
                duration: 10,
                presenter: 'Tous',
                objective: 'Information',
                order: order++
            });
        }

        if (includeQuestions) {
            agendaItems.push({
                title: 'Période de questions',
                description: 'Questions des membres et du public.',
                duration: 15,
                presenter: 'Président',
                objective: 'Information',
                order: order++
            });
        }

        // Next meeting info (simplified)
        agendaItems.push({
            title: 'Levée de l\'assemblée',
            description: '',
            duration: 0,
            presenter: 'Président',
            objective: 'Décision',
            order: order++
        });

        const meetingData = {
            title: `Réunion CCE du ${new Date(meetingDate).toLocaleDateString()}`,
            date: meetingDate + 'T19:00:00', // Default 7 PM
            type: 'regular',
            status: 'scheduled',
            location: 'Salle du Conseil (Hôtel de Ville)', // Default
            agendaItems
        };

        onConfirm(meetingData);
        onClose();
    };

    const selectedCount = Object.values(selectedProjects).filter(Boolean).length;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AutoAwesome color="primary" />
                Planification Intelligente
            </DialogTitle>
            <DialogContent dividers>
                <Grid container spacing={3}>
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="subtitle1" gutterBottom fontWeight="bold">
                            Configuration
                        </Typography>
                        <Box sx={{ mb: 2 }}>
                            <TextField
                                label="Date prévue"
                                type="date"
                                fullWidth
                                value={meetingDate}
                                onChange={(e) => setMeetingDate(e.target.value)}
                                InputLabelProps={{ shrink: true }}
                            />
                        </Box>
                        <FormGroup>
                            <FormControlLabel
                                control={<Checkbox checked={includeReview} onChange={(e) => setIncludeReview(e.target.checked)} />}
                                label="Inclure l'ouverture et adoption du PV"
                            />
                            {lastCompletedMeeting && rolloverItems.length > 0 && (
                                <FormControlLabel
                                    control={<Checkbox checked={includeRollover} onChange={(e) => setIncludeRollover(e.target.checked)} />}
                                    label={`Importer ${rolloverItems.length} points de la dernière réunion (${new Date(lastCompletedMeeting.date).toLocaleDateString()})`}
                                />
                            )}
                            <FormControlLabel
                                control={<Checkbox checked={includeVaria} onChange={(e) => setIncludeVaria(e.target.checked)} />}
                                label="Inclure Varia"
                            />
                            <FormControlLabel
                                control={<Checkbox checked={includeQuestions} onChange={(e) => setIncludeQuestions(e.target.checked)} />}
                                label="Inclure période de questions"
                            />
                        </FormGroup>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="subtitle1" gutterBottom fontWeight="bold" sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            Projets à discuter
                            <Typography variant="caption" sx={{ alignSelf: 'center' }}>
                                {selectedCount} sélectionné(s)
                            </Typography>
                        </Typography>
                        <Typography variant="caption" color="textSecondary" paragraph>
                            Détectés automatiquement parmi les projets en cours.
                        </Typography>

                        <List dense sx={{ maxHeight: 300, overflow: 'auto', border: '1px solid #eee', borderRadius: 1 }}>
                            {activeProjects.map(project => (
                                <ListItem key={project.id} disablePadding>
                                    <ListItemButton role={undefined} onClick={() => handleProjectToggle(project.id)} dense>
                                        <ListItemIcon>
                                            <Checkbox
                                                edge="start"
                                                checked={!!selectedProjects[project.id]}
                                                tabIndex={-1}
                                                disableRipple
                                            />
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={project.name}
                                            secondary={project.isUrgent ? 'URGENT' : project.code}
                                            primaryTypographyProps={{
                                                color: project.isUrgent ? 'error' : 'textPrimary',
                                                fontWeight: project.isUrgent ? 'bold' : 'normal'
                                            }}
                                        />
                                    </ListItemButton>
                                </ListItem>
                            ))}
                            {activeProjects.length === 0 && (
                                <ListItem>
                                    <ListItemText secondary="Aucun projet actif trouvé." />
                                </ListItem>
                            )}
                        </List>
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Annuler</Button>
                <Button variant="contained" onClick={handleCreate} startIcon={<AutoAwesome />}>
                    Générer la réunion
                </Button>
            </DialogActions>
        </Dialog >
    );
};

export default SmartPlanningDialog;
