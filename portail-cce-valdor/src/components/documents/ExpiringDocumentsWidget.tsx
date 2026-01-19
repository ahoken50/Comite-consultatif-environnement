import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Card,
    CardContent,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Chip,
    Button,
    Divider,
    Skeleton
} from '@mui/material';
import { Warning, Description, CalendarToday, Refresh } from '@mui/icons-material';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { formatDistanceToNow, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import type { Document } from '../../types/document.types';

interface ExpiringDocumentsWidgetProps {
    daysThreshold?: number; // Show documents expiring within this many days
}

/**
 * Expiring Documents Widget (#4.7)
 * Shows documents that are expiring soon or have expired
 */
const ExpiringDocumentsWidget: React.FC<ExpiringDocumentsWidgetProps> = ({
    daysThreshold = 30
}) => {
    const navigate = useNavigate();
    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchExpiringDocuments = async () => {
        setLoading(true);
        setError(null);

        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() + daysThreshold);

            // Query documents with expirationDate before cutoff
            const docsRef = collection(db, 'documents');
            const q = query(
                docsRef,
                where('expirationDate', '<=', Timestamp.fromDate(cutoffDate))
            );

            const snapshot = await getDocs(q);
            const docs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Document));

            // Sort by expiration date (soonest first)
            docs.sort((a, b) => {
                const getDate = (d: any) => {
                    if (!d) return Infinity;
                    // Handle Firestore Timestamp
                    if (d.toDate && typeof d.toDate === 'function') {
                        return d.toDate().getTime();
                    }
                    // Handle String or Date
                    const date = new Date(d);
                    return isNaN(date.getTime()) ? Infinity : date.getTime();
                };

                return getDate(a.expirationDate) - getDate(b.expirationDate);
            });

            setDocuments(docs);
        } catch (err) {
            console.error('Error fetching expiring documents:', err);
            setError('Erreur lors du chargement des documents');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchExpiringDocuments();
    }, [daysThreshold]);

    const getExpirationStatus = (expirationDate: any) => {
        const now = new Date();
        let expDate: Date;

        // Handle Firestore Timestamp
        if (expirationDate && expirationDate.toDate && typeof expirationDate.toDate === 'function') {
            expDate = expirationDate.toDate();
        } else {
            expDate = new Date(expirationDate);
        }

        // Safety check
        if (isNaN(expDate.getTime())) {
            return { label: 'Date invalide', color: 'default' as const };
        }

        const daysLeft = differenceInDays(expDate, now);

        if (daysLeft < 0) {
            return { label: 'Expiré', color: 'error' as const };
        } else if (daysLeft === 0) {
            return { label: "Expire aujourd'hui", color: 'error' as const };
        } else if (daysLeft <= 7) {
            return { label: `${daysLeft}j restants`, color: 'error' as const };
        } else if (daysLeft <= 14) {
            return { label: `${daysLeft}j restants`, color: 'warning' as const };
        } else {
            return { label: `${daysLeft}j restants`, color: 'info' as const };
        }
    };

    if (loading) {
        return (
            <Card sx={{ height: '100%' }}>
                <CardContent>
                    <Skeleton variant="text" width="60%" />
                    <Box sx={{ mt: 2 }}>
                        <Skeleton variant="rectangular" height={40} sx={{ mb: 1 }} />
                        <Skeleton variant="rectangular" height={40} sx={{ mb: 1 }} />
                        <Skeleton variant="rectangular" height={40} />
                    </Box>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card sx={{ height: '100%' }}>
            <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Warning color="warning" fontSize="small" />
                        <Typography variant="overline" sx={{ fontWeight: 600, letterSpacing: 1 }}>
                            DOCUMENTS EXPIRÉS OU À RENOUVELER
                        </Typography>
                    </Box>
                    <Button
                        size="small"
                        startIcon={<Refresh />}
                        onClick={fetchExpiringDocuments}
                    >
                        Actualiser
                    </Button>
                </Box>

                {error && (
                    <Typography color="error" variant="body2" sx={{ mb: 2 }}>
                        {error}
                    </Typography>
                )}

                {documents.length === 0 ? (
                    <Box sx={{ textAlign: 'center', py: 3 }}>
                        <CalendarToday color="disabled" sx={{ fontSize: 48, mb: 1 }} />
                        <Typography color="text.secondary" variant="body2">
                            Aucun document expirant dans les {daysThreshold} prochains jours
                        </Typography>
                    </Box>
                ) : (
                    <List dense>
                        {documents.slice(0, 5).map((doc, index) => {
                            const status = getExpirationStatus(doc.expirationDate!);
                            return (
                                <React.Fragment key={doc.id}>
                                    {index > 0 && <Divider />}
                                    <ListItem
                                        sx={{ py: 1, cursor: 'pointer' }}
                                        onClick={() => {
                                            if (doc.linkedEntityType === 'project') {
                                                navigate(`/projects/${doc.linkedEntityId}`);
                                            } else if (doc.linkedEntityType === 'meeting') {
                                                navigate(`/meetings/${doc.linkedEntityId}`);
                                            }
                                        }}
                                    >
                                        <ListItemIcon sx={{ minWidth: 36 }}>
                                            <Description color="action" fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={
                                                <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                                                    {doc.name}
                                                </Typography>
                                            }
                                            secondary={
                                                <Typography variant="caption" color="text.secondary">
                                                    {formatDistanceToNow(new Date(doc.expirationDate!), {
                                                        addSuffix: true,
                                                        locale: fr
                                                    })}
                                                </Typography>
                                            }
                                        />
                                        <Chip
                                            label={status.label}
                                            size="small"
                                            color={status.color}
                                            sx={{ ml: 1 }}
                                        />
                                    </ListItem>
                                </React.Fragment>
                            );
                        })}
                    </List>
                )}

                {documents.length > 5 && (
                    <Box sx={{ mt: 2, textAlign: 'center' }}>
                        <Button
                            size="small"
                            onClick={() => navigate('/documents?filter=expiring')}
                        >
                            Voir tous ({documents.length})
                        </Button>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};

export default ExpiringDocumentsWidget;
