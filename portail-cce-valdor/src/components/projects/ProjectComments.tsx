import React, { useState } from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemAvatar,
    Avatar,
    Divider
} from '@mui/material';
import { Send } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { addComment } from '../../features/projects/projectsSlice';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';
import type { Project, Comment } from '../../types/project.types';
import { format, isValid } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ProjectCommentsProps {
    project: Project;
}

const ProjectComments: React.FC<ProjectCommentsProps> = ({ project }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const [newComment, setNewComment] = useState('');

    const handleSendComment = async () => {
        if (!newComment.trim() || !user) return;

        const comment: Comment = {
            id: crypto.randomUUID(),
            userId: user.id,
            userName: user.displayName || 'Utilisateur',
            content: newComment,
            createdAt: new Date().toISOString()
        };

        try {
            await dispatch(addComment({
                projectId: project.id,
                comment,
                projectName: project.name,
                userId: user.id,
                userName: user.displayName || 'Utilisateur'
            })).unwrap();
            setNewComment('');
        } catch (error) {
            console.error('Failed to add comment:', error);
        }
    };

    const sortedComments = [...(project.comments || [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return (
        <Paper elevation={0} variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6" gutterBottom>
                Commentaires & Notes
            </Typography>

            <List sx={{ flex: 1, overflowY: 'auto', mb: 2 }}>
                {sortedComments.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 4 }}>
                        Aucun commentaire pour le moment.
                    </Typography>
                ) : (
                    sortedComments.map((comment, index) => (
                        <React.Fragment key={comment.id}>
                            <ListItem alignItems="flex-start" sx={{ px: 0 }}>
                                <ListItemAvatar>
                                    <Avatar alt={comment.userName} src="/static/images/avatar/1.jpg">
                                        {comment.userName.charAt(0)}
                                    </Avatar>
                                </ListItemAvatar>
                                <ListItemText
                                    primary={
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="subtitle2" component="span">
                                                {comment.userName}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {comment.createdAt && isValid(new Date(comment.createdAt)) ? format(new Date(comment.createdAt), "d MMMM yyyy 'à' HH:mm", { locale: fr }) : 'Date inconnue'}
                                            </Typography>
                                        </Box>
                                    }
                                    secondary={
                                        <Typography
                                            variant="body2"
                                            color="text.primary"
                                            sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}
                                        >
                                            {comment.content}
                                        </Typography>
                                    }
                                />
                            </ListItem>
                            {index < sortedComments.length - 1 && <Divider component="li" />}
                        </React.Fragment>
                    ))
                )}
            </List>

            <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                    fullWidth
                    size="small"
                    placeholder="Écrire un commentaire..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    multiline
                    maxRows={4}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendComment();
                        }
                    }}
                />
                <Button
                    variant="contained"
                    color="primary"
                    endIcon={<Send />}
                    onClick={handleSendComment}
                    disabled={!newComment.trim()}
                >
                    Envoyer
                </Button>
            </Box>
        </Paper>
    );
};

export default ProjectComments;
