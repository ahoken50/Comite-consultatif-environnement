import React from 'react';
import {
    Box,
    Typography,
    List,
    ListItem,
    Divider,
    Chip,
    Button
} from '@mui/material';
import { Gavel, Event, AttachFile } from '@mui/icons-material';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/rootReducer';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ProjectRecommendationsProps {
    projectId: string;
}

const ProjectRecommendations: React.FC<ProjectRecommendationsProps> = ({ projectId }) => {
    const { recommendations, loading } = useSelector((state: RootState) => state.governance);

    // Filter recommendations that are linked to this project
    const linkedRecommendations = recommendations.filter(rec => 
        rec.projectId === projectId || 
        (rec.linkedProjectIds && rec.linkedProjectIds.includes(projectId))
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'accepted': return 'success';
            case 'rejected': return 'error';
            case 'pending': return 'warning';
            case 'deferred': return 'info';
            case 'modified': return 'secondary';
            default: return 'default';
        }
    };

    if (loading && recommendations.length === 0) {
        return <Typography>Chargement des recommandations...</Typography>;
    }

    return (
        <Box>
            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Gavel color="primary" /> Recommandations au Conseil
            </Typography>
            
            <List sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                {linkedRecommendations.length === 0 ? (
                    <Typography color="text.secondary" align="center" py={4}>
                        Aucune recommandation associée à ce projet n'a été trouvée.
                    </Typography>
                ) : (
                    linkedRecommendations.map((rec, index) => (
                        <React.Fragment key={rec.id}>
                            {index > 0 && <Divider />}
                            <ListItem alignItems="flex-start" sx={{ py: 3 }}>
                                <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Event fontSize="small" color="action" />
                                            <Typography variant="subtitle2">
                                                Réunion du {rec.meetingDate ? format(new Date(rec.meetingDate), 'd MMMM yyyy', { locale: fr }) : 'Non planifiée'}
                                            </Typography>
                                        </Box>
                                        <Chip 
                                            label={rec.status.toUpperCase()} 
                                            color={getStatusColor(rec.status) as any} 
                                            size="small" 
                                            variant="outlined"
                                        />
                                    </Box>

                                    <Typography variant="h6" gutterBottom color="primary">
                                        {rec.sourceAgendaItemOrder ? `Sujet ${rec.sourceAgendaItemOrder} - ` : ''}
                                        {rec.resolutions && rec.resolutions.length > 0 ? rec.resolutions[0].title : 'Recommandation'}
                                    </Typography>

                                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mb: 2 }}>
                                        {rec.description.length > 300 ? `${rec.description.substring(0, 300)}...` : rec.description}
                                    </Typography>

                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                        {rec.sourceResolutionNumber && (
                                            <Chip label={`Réf: ${rec.sourceResolutionNumber}`} size="small" variant="outlined" />
                                        )}
                                        
                                        {(rec.attachments && rec.attachments.length > 0) && (
                                            <Button 
                                                size="small" 
                                                startIcon={<AttachFile />}
                                                href={rec.attachments[0].url}
                                                target="_blank"
                                                variant="text"
                                            >
                                                Voir PDF
                                            </Button>
                                        )}
                                    </Box>
                                </Box>
                            </ListItem>
                        </React.Fragment>
                    ))
                )}
            </List>
        </Box>
    );
};

export default ProjectRecommendations;
