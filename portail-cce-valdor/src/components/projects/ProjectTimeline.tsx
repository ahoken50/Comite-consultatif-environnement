import React from 'react';
import { Box, Typography, Paper, Chip } from '@mui/material';
import {
    Assignment as TaskIcon,
    Gavel as ResolutionIcon,
    Comment as CommentIcon,
    GroupWork as CaucusIcon,
    AccountBalance as RecommendationIcon
} from '@mui/icons-material';
import type { Project } from '../../types/project.types';
import type { ProjectTask } from '../../types/task.types';
import type { CouncilRecommendation } from '../../types/recommendation.types';

interface ProjectTimelineProps {
    project: Project;
    tasks: ProjectTask[];
    recommendations: CouncilRecommendation[];
}

interface TimelineEvent {
    id: string;
    date: Date;
    type: 'comment' | 'task' | 'resolution' | 'caucus' | 'recommendation';
    title: string;
    description: string;
    author?: string;
    status?: string;
}

const ProjectTimeline: React.FC<ProjectTimelineProps> = ({ project, tasks, recommendations }) => {
    
    // Gather all events
    const events: TimelineEvent[] = [];

    // 1. Comments
    if (project.comments) {
        project.comments.forEach(c => {
            events.push({
                id: `comment-${c.id}`,
                date: new Date(c.createdAt),
                type: 'comment',
                title: 'Commentaire',
                description: c.content,
                author: c.userName
            });
        });
    }

    // 2. Tasks
    if (tasks) {
        tasks.forEach(t => {
            events.push({
                id: `task-created-${t.id}`,
                date: new Date(t.dateCreated),
                type: 'task',
                title: 'Tâche créée',
                description: t.description,
                status: t.status
            });
            if (t.status === 'completed' && t.dateCompleted) {
                events.push({
                    id: `task-completed-${t.id}`,
                    date: new Date(t.dateCompleted),
                    type: 'task',
                    title: 'Tâche complétée',
                    description: t.description,
                    status: t.status
                });
            }
        });
    }

    // 3. Linked Resolutions
    if (project.linkedResolutions) {
        project.linkedResolutions.forEach(r => {
            events.push({
                id: `resolution-${r.id}`,
                date: new Date(r.meetingDate || r.linkedAt),
                type: 'resolution',
                title: `${r.entryType === 'comment' ? 'Commentaire' : r.entryType === 'note' ? 'Note' : 'Résolution'} ${r.entryNumber} - ${r.meetingTitle}`,
                description: r.entryContent
            });
        });
    }

    // 4. Caucus Decisions
    if (project.caucusDecisions) {
        project.caucusDecisions.forEach(c => {
            events.push({
                id: `caucus-${c.id}`,
                date: new Date(c.date),
                type: 'caucus',
                title: 'Décision plénière',
                description: c.description
            });
        });
    }

    // 5. Recommendations
    const projRecommendations = recommendations.filter(r => r.linkedProjectIds?.includes(project.id) || r.projectId === project.id);
    projRecommendations.forEach(r => {
        events.push({
            id: `recommendation-${r.id}`,
            date: new Date(r.createdAt),
            type: 'recommendation',
            title: 'Recommandation au Conseil',
            description: r.description,
            status: r.status
        });
        if (r.councilMeetingDate) {
             events.push({
                id: `recommendation-council-${r.id}`,
                date: new Date(r.councilMeetingDate),
                type: 'recommendation',
                title: `Retour du Conseil (${r.councilResolutionNumber || 'Sans Numéro'})`,
                description: r.notes || 'Aucun commentaire du conseil.',
                status: r.status
            });
        }
    });

    // Sort events by date descending
    events.sort((a, b) => b.date.getTime() - a.date.getTime());

    const getEventIcon = (type: string) => {
        switch (type) {
            case 'comment': return <CommentIcon fontSize="small" sx={{ color: 'grey.600' }} />;
            case 'task': return <TaskIcon fontSize="small" color="info" />;
            case 'resolution': return <ResolutionIcon fontSize="small" color="primary" />;
            case 'caucus': return <CaucusIcon fontSize="small" color="secondary" />;
            case 'recommendation': return <RecommendationIcon fontSize="small" color="warning" />;
            default: return <CommentIcon fontSize="small" sx={{ color: 'grey.600' }} />;
        }
    };

    if (events.length === 0) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography color="text.secondary">Aucun événement dans l'historique de ce projet.</Typography>
            </Box>
        );
    }

    return (
        <Paper elevation={0} variant="outlined" sx={{ p: 2, bgcolor: '#fbfbfb' }}>
            <Typography variant="h6" gutterBottom>Historique Consolidé</Typography>
            <Box sx={{ position: 'relative', ml: 1, mt: 2 }}>
                {/* Vertical line connecting events */}
                <Box sx={{ 
                    position: 'absolute', 
                    top: 10, 
                    bottom: 10, 
                    left: 17, 
                    width: '2px', 
                    bgcolor: 'grey.300',
                    zIndex: 0
                }} />
                
                {events.map((event) => (
                    <Box key={event.id} sx={{ display: 'flex', mb: 3, position: 'relative', zIndex: 1 }}>
                        <Box sx={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            alignItems: 'center',
                            mr: 2,
                            width: '36px'
                        }}>
                            <Box sx={{ 
                                width: 36, 
                                height: 36, 
                                borderRadius: '50%', 
                                bgcolor: 'white',
                                border: '2px solid',
                                borderColor: 'grey.200',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: 1
                            }}>
                                {getEventIcon(event.type)}
                            </Box>
                        </Box>
                        <Box sx={{ flexGrow: 1, pt: 0.5 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <Typography variant="subtitle2" component="span" fontWeight="bold">
                                    {event.title}
                                    {event.status && (
                                        <Chip 
                                            label={event.status} 
                                            size="small" 
                                            sx={{ ml: 1, mb: 0.5, height: 20, fontSize: '0.7rem' }} 
                                            color={event.status === 'completed' || event.status === 'accepted' ? 'success' : 'default'}
                                        />
                                    )}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {event.date.toLocaleDateString()}
                                </Typography>
                            </Box>
                            
                            <Paper variant="outlined" sx={{ p: 1.5, mt: 1, bgcolor: 'white' }}>
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                                    {event.description}
                                </Typography>
                                {event.author && (
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                        Par {event.author}
                                    </Typography>
                                )}
                            </Paper>
                        </Box>
                    </Box>
                ))}
            </Box>
        </Paper>
    );
};

export default ProjectTimeline;
