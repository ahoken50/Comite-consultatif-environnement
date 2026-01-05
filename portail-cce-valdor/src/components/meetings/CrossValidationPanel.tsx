import React from 'react';
import {
    Box,
    Paper,
    Typography,
    Alert,
    AlertTitle,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Chip,
    Button,
    Collapse,
    Divider
} from '@mui/material';
import {
    CheckCircle,
    Warning,
    Error as ErrorIcon,
    ExpandMore,
    ExpandLess,
    Sync
} from '@mui/icons-material';
import type { AgendaItem } from '../../types/meeting.types';

interface CrossValidationPanelProps {
    odjItems: AgendaItem[];
    pvItems: AgendaItem[];
    onSync?: (missingItems: AgendaItem[]) => void;
}

interface ValidationIssue {
    type: 'missing_in_pv' | 'missing_in_odj' | 'order_mismatch' | 'title_mismatch';
    severity: 'error' | 'warning' | 'info';
    odjItem?: AgendaItem;
    pvItem?: AgendaItem;
    message: string;
}

/**
 * CrossValidationPanel - Compare ODJ with PV and highlight differences
 */
const CrossValidationPanel: React.FC<CrossValidationPanelProps> = ({
    odjItems,
    pvItems,
    onSync
}) => {
    const [expanded, setExpanded] = React.useState(false);

    // Perform validation
    const issues = React.useMemo(() => {
        const result: ValidationIssue[] = [];

        // Check for items in ODJ but not in PV
        odjItems.forEach((odjItem) => {
            const matchingPV = pvItems.find(pv =>
                pv.title.toLowerCase().trim() === odjItem.title.toLowerCase().trim() ||
                pv.order === odjItem.order
            );

            if (!matchingPV) {
                result.push({
                    type: 'missing_in_pv',
                    severity: 'warning',
                    odjItem,
                    message: `Point "${odjItem.title}" absent du PV`
                });
            } else if (matchingPV.order !== odjItem.order) {
                result.push({
                    type: 'order_mismatch',
                    severity: 'info',
                    odjItem,
                    pvItem: matchingPV,
                    message: `Ordre différent: ODJ #${odjItem.order} vs PV #${matchingPV.order}`
                });
            }
        });

        // Check for items in PV but not in ODJ
        pvItems.forEach(pvItem => {
            const matchingODJ = odjItems.find(odj =>
                odj.title.toLowerCase().trim() === pvItem.title.toLowerCase().trim()
            );

            if (!matchingODJ) {
                result.push({
                    type: 'missing_in_odj',
                    severity: 'error',
                    pvItem,
                    message: `Point "${pvItem.title}" dans le PV mais pas dans l'ODJ`
                });
            }
        });

        // Check for items requiring resolution but missing one
        odjItems.forEach(item => {
            if (item.objective === 'Decision' || item.objective === 'Décision') {
                const hasResolution = item.minuteEntries?.some(e => e.type === 'resolution');
                if (!hasResolution && item.minuteType !== 'resolution') {
                    result.push({
                        type: 'missing_in_pv',
                        severity: 'warning',
                        odjItem: item,
                        message: `Point "${item.title}" requiert une décision mais aucune résolution trouvée`
                    });
                }
            }
        });

        return result;
    }, [odjItems, pvItems]);

    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const infoCount = issues.filter(i => i.severity === 'info').length;

    const getOverallStatus = () => {
        if (errorCount > 0) return 'error';
        if (warningCount > 0) return 'warning';
        if (infoCount > 0) return 'info';
        return 'success';
    };

    const getIcon = (severity: string) => {
        switch (severity) {
            case 'error': return <ErrorIcon color="error" />;
            case 'warning': return <Warning color="warning" />;
            default: return <CheckCircle color="info" />;
        }
    };

    const missingItems = issues
        .filter(i => i.type === 'missing_in_pv' && i.odjItem)
        .map(i => i.odjItem!);

    if (odjItems.length === 0 || pvItems.length === 0) {
        return null;
    }

    return (
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer'
                }}
                onClick={() => setExpanded(!expanded)}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                        🔍 Validation Croisée ODJ / PV
                    </Typography>
                    {issues.length === 0 ? (
                        <Chip
                            icon={<CheckCircle />}
                            label="Conforme"
                            color="success"
                            size="small"
                        />
                    ) : (
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {errorCount > 0 && (
                                <Chip label={`${errorCount} erreur(s)`} color="error" size="small" />
                            )}
                            {warningCount > 0 && (
                                <Chip label={`${warningCount} avertissement(s)`} color="warning" size="small" />
                            )}
                            {infoCount > 0 && (
                                <Chip label={`${infoCount} info(s)`} color="info" size="small" />
                            )}
                        </Box>
                    )}
                </Box>
                {expanded ? <ExpandLess /> : <ExpandMore />}
            </Box>

            <Collapse in={expanded}>
                <Divider sx={{ my: 2 }} />

                {issues.length === 0 ? (
                    <Alert severity="success">
                        <AlertTitle>Validation réussie</AlertTitle>
                        Tous les points de l'ordre du jour correspondent au procès-verbal.
                    </Alert>
                ) : (
                    <>
                        <Alert severity={getOverallStatus()} sx={{ mb: 2 }}>
                            <AlertTitle>
                                {errorCount > 0 ? 'Incohérences détectées' :
                                    warningCount > 0 ? 'Vérifications recommandées' :
                                        'Différences mineures'}
                            </AlertTitle>
                            {issues.length} différence(s) trouvée(s) entre l'ODJ et le PV.
                        </Alert>

                        <List dense>
                            {issues.map((issue, index) => (
                                <ListItem key={index}>
                                    <ListItemIcon>
                                        {getIcon(issue.severity)}
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={issue.message}
                                        secondary={issue.type === 'order_mismatch' ?
                                            `ODJ: "${issue.odjItem?.title}" | PV: "${issue.pvItem?.title}"` :
                                            null
                                        }
                                    />
                                </ListItem>
                            ))}
                        </List>

                        {missingItems.length > 0 && onSync && (
                            <Box sx={{ mt: 2, textAlign: 'right' }}>
                                <Button
                                    variant="outlined"
                                    startIcon={<Sync />}
                                    onClick={() => onSync(missingItems)}
                                >
                                    Ajouter les points manquants au PV
                                </Button>
                            </Box>
                        )}
                    </>
                )}
            </Collapse>
        </Paper>
    );
};

export default CrossValidationPanel;
