import React, { useState } from 'react';
import { Box, Grid, TextField, MenuItem, IconButton, Tooltip, CircularProgress, InputAdornment, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, Chip } from '@mui/material';
import { AutoMode, Link, Shield, CheckCircle, Warning, HelpOutline, AutoAwesome, Delete, Assignment as AssignmentIcon } from '@mui/icons-material';
import type { MinuteEntry } from '../../types/meeting.types';
import { searchMeetings, searchRegulations } from '../../services/supabaseSearchService';
import { aiService } from '../../services/ai/UnifiedAIService';
import { useNavigate } from 'react-router-dom';
import JurisprudenceChatBox from '../search/JurisprudenceChatBox';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/rootReducer';

interface MinuteEntryEditorProps {
    entry: MinuteEntry;
    entryIndex: number;
    itemId: string;
    onChange: (itemId: string, entryIndex: number, field: string, value: any) => void;
    onDelete?: (itemId: string, entryIndex: number) => void;
    readOnly?: boolean;
    itemTitle: string;
    itemDescription: string;
    meetingId?: string;
    meetingDate?: string;
    siblingEntries?: MinuteEntry[];
    userRole?: string;
    linkedProjectId?: string;
}

/**
 * Editable minute entry component for resolutions and comments.
 * Extracted from MinutesEditor to reduce component size and improve reusability.
 */
const MinuteEntryEditor: React.FC<MinuteEntryEditorProps> = ({
    entry,
    entryIndex,
    itemId,
    onChange,
    onDelete,
    readOnly = false,
    itemTitle,
    itemDescription,
    meetingId,
    meetingDate,
    siblingEntries = [],
    userRole,
    linkedProjectId
}) => {
    const navigate = useNavigate();
    const [isExpanded, setIsExpanded] = useState(false);
    const [isDrafting, setIsDrafting] = useState(false);
    const [showChat, setShowChat] = useState(false);

    // Fetch linked project details from Redux
    const linkedProject = useSelector((state: RootState) => 
        linkedProjectId ? state.projects.items.find(p => p.id === linkedProjectId) : undefined
    );

    const getProjectStatusChip = () => {
        if (!linkedProject) return null;

        let color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' = 'info';
        let statusText = '';

        switch (linkedProject.status) {
            case 'completed':
                color = 'success';
                statusText = 'Terminé';
                break;
            case 'in_progress':
                color = 'primary';
                statusText = 'En cours';
                break;
            case 'pending':
                color = 'warning';
                statusText = 'En attente';
                break;
            case 'blocked':
                color = 'error';
                statusText = 'Bloqué';
                break;
            case 'financing_received':
                color = 'success';
                statusText = 'Financement reçu';
                break;
            case 'to_clarify':
                color = 'secondary';
                statusText = 'À clarifier';
                break;
            default:
                statusText = linkedProject.status || 'Inconnu';
        }

        const percentage = linkedProject.completionPercentage !== undefined ? `${linkedProject.completionPercentage}%` : '0%';
        const label = `Projet : ${linkedProject.name} (${statusText} - ${percentage})`;

        return (
            <Tooltip title={`Ouvrir le projet : ${linkedProject.name}`}>
                <Chip
                    icon={<AssignmentIcon />}
                    label={label}
                    color={color}
                    variant="outlined"
                    size="small"
                    onClick={() => navigate(`/projects/${linkedProject.id}`)}
                    sx={{ cursor: 'pointer', mb: 1.5, fontWeight: 'bold' }}
                />
            </Tooltip>
        );
    };

    const handleFieldChange = (field: string, value: any) => {
        onChange(itemId, entryIndex, field, value);
    };

    const [complianceResult, setComplianceResult] = useState<{
        compliant: boolean;
        issues: string[];
        suggestions: string[];
        citedRegulations: string[];
    } | null>(null);
    const [checkingCompliance, setCheckingCompliance] = useState(false);

    const handleGuardianCheck = async () => {
        if (!entry.content) return;
        setCheckingCompliance(true);
        setComplianceResult(null);

        try {
            const result = await aiService.checkRegulatoryCompliance(entry.content);
            setComplianceResult(result);
            if (!result.compliant) {
                // If checking compliance, we might want to alert the user immediately
                // alert(`⚠️ Conflits détectés: ${result.issues.length}`);
            }
        } catch (error) {
            console.error('Guardian check failed', error);
        } finally {
            setCheckingCompliance(false);
        }
    };

    // Détection proactive et debouncée (3s) des conflits réglementaires
    React.useEffect(() => {
        if (!entry.content || entry.type !== 'resolution') {
            setComplianceResult(null);
            return;
        }

        const timer = setTimeout(() => {
            handleGuardianCheck();
        }, 3000); // Déclenchement automatique après 3 secondes d'inactivité

        return () => clearTimeout(timer);
    }, [entry.content, entry.type]);

    const handleMagicDraft = async () => {
        if (!itemTitle) return;
        setIsDrafting(true);
        try {
            // 1. Search for similar resolutions in Typesense
            // The service automatically handles vector embedding for queries > 3 chars
            const searchResults = await searchMeetings(itemTitle, {
                matchCount: 3,
                // We could filter by status if needed, e.g. filterBy: 'status:=Published'
            });

            // Extract resolutions from the matching meetings
            // Since we don't have item-level granularity in the index yet, we take resolutions from the top matching meetings
            const similarResolutions = searchResults.hits
                .flatMap(hit => {
                    const doc = hit.document;
                    // Return all resolutions from this matching meeting
                    return (doc.resolutions || []).map(r => ({
                        content: r,
                        similarity: 0.8, // Approximation
                        source: `${doc.title} (${new Date(doc.date).toLocaleDateString()})`
                    }));
                })
                .slice(0, 5) // Take a few more candidates
                .filter(r => r.content.length > 50); // specific resolutions usually have length

            // 2. Call AI to draft
            const draft = await aiService.draftResolution({
                title: itemTitle,
                description: itemDescription,
                similarResolutions: similarResolutions.slice(0, 3) // Pass top 3
            });

            // 3. Update field
            handleFieldChange('content', draft);
            setIsExpanded(true);

        } catch (error) {
            console.error("Magic Draft failed:", error);
            alert("Erreur lors de la génération: " + (error instanceof Error ? error.message : String(error)));
        } finally {
            setIsDrafting(false);
        }
    };

    const handleAutoLink = async () => {
        if (!entry.content) return;
        setIsDrafting(true); // Reuse drafting spinner

        try {
            let newContent = entry.content;
            let matchCount = 0;

            // Regex for patterns like "Règlement 2024-02", "R. 2024-02", "Règlement numéro 2024-02"
            // Captures: 1=Prefix, 2=Number
            const regex = /(Règlement|R\.|Règlement numéro)\s+((?:\d{4}-\d{2,3})|(?:\d+(?:\.\d+)*))/gi;

            // We need to find all unique matches first to avoid searching same thing twice
            const matches = Array.from(entry.content.matchAll(regex));
            const uniqueNumbers = [...new Set(matches.map(m => m[2]))];

            for (const number of uniqueNumbers) {
                // Search in Typesense
                // We use relaxed search to find "2024-02" even if title is "Règlement 2024-02 de zonage"
                const results = await searchRegulations(number, {
                    matchCount: 1,
                    // filterBy: 'status:=[En vigueur,Projet]' // Prioritize active ones - Supabase implementation of hybrid search doesn't support complex filters currently, text search fallback does.
                });

                if (results.found > 0) {
                    // Replace all occurrences of this number pattern with a markdown link
                    // We use a broader replacement regex to catch the full phrase
                    // e.g. Replace "Règlement 2024-02" with "[Règlement 2024-02](/regulations?search=2024-02)"

                    // Simple text replacement for now. 
                    // To be safer, we should replace the specific matched text.
                    // Let's replace the whole match: "(Prefix) (Number)"
                    for (const m of matches.filter(m => m[2] === number)) {
                        const fullMatch = m[0];
                        // Avoid double-linking if already linked
                        if (!newContent.includes(`[${fullMatch}]`) && !newContent.includes(`](${number})`)) {
                            newContent = newContent.replaceAll(fullMatch, `[${fullMatch}](/regulations?search=${number})`);
                            matchCount++;
                        }
                    }
                }
            }

            if (matchCount > 0) {
                handleFieldChange('content', newContent);
                // alert(`🔗 ${matchCount} lien(s) créé(s) !`); // Toast handles this better if we had access
            } else {
                // No matches found
            }

        } catch (error) {
            console.error('Auto-link failed', error);
        } finally {
            setIsDrafting(false);
        }
    };

    const borderColor = entry.type === 'resolution' ? 'primary.main' : entry.type === 'note' ? 'grey.500' : 'warning.main';
    const contentLabel = entry.type === 'resolution'
        ? "Contenu de la résolution"
        : entry.type === 'note'
            ? "Contenu de la note"
            : "Contenu du commentaire";
    const contentPlaceholder = entry.type === 'resolution'
        ? "CONSIDÉRANT que...\n\nIL EST RÉSOLU..."
        : entry.type === 'note'
            ? "Saisir la note simple..."
            : "Saisir le commentaire...";

    const handleCreateRecommendation = () => {
        if (!meetingId || !meetingDate) {
            alert("Erreur: Informations de réunion manquantes");
            return;
        }

        navigate('/recommendations', {
            state: {
                createRecommendation: {
                    meetingId: meetingId,
                    meetingDate: meetingDate,
                    sourceResolutionNumber: entry.number || '',
                    sourceResolutionContent: entry.content || '',
                    projectName: itemTitle,
                    description: entry.content || '',
                    // Collect sibling comments to pass as context notes for AI
                    notes: siblingEntries
                        .filter(e => e.type === 'comment' && e.content)
                        .map(e => `[Commentaire PV]: ${e.content}`)
                        .join('\n\n'),
                    considerants: [] // Could try to extract considerants here too if needed
                }
            }
        });
    };

    const handleCreateTask = () => {
        if (!linkedProjectId) {
            alert("Veuillez d'abord lier un projet à ce point de l'ordre du jour.");
            return;
        }
        
        // Navigate to the project page with state to open the task creation dialog
        navigate(`/projects/${linkedProjectId}`, {
            state: {
                openTaskDialog: true,
                newTaskContext: {
                    sourceMeetingId: meetingId,
                    sourceAgendaItemId: itemId,
                    sourceMinuteEntryOrder: entry.number || `Entrée ${entryIndex + 1}`,
                    description: `Suite à la résolution ${entry.number || ''}:\n${entry.content}`
                }
            }
        });
    };

    return (
        <Box
            id={`resolution-${itemId}-${entryIndex}`}
            sx={{
                mb: 2,
                p: 2,
                bgcolor: 'grey.50',
                borderRadius: 1,
                border: '1px solid',
                borderColor,
                position: 'relative'
            }}
        >
            {!readOnly && onDelete && (
                <IconButton
                    size="small"
                    onClick={() => onDelete(itemId, entryIndex)}
                    sx={{ position: 'absolute', top: 4, right: 4 }}
                    color="error"
                    title="Supprimer cette entrée"
                >
                    <Delete fontSize="small" />
                </IconButton>
            )}
            <Grid container spacing={2} sx={{ mb: 1, pr: 4 }}>
                <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                        select
                        fullWidth
                        label="Type"
                        size="small"
                        value={entry.type}
                        onChange={(e) => handleFieldChange('type', e.target.value)}
                        disabled={readOnly}
                    >
                        <MenuItem value="resolution">📋 Résolution</MenuItem>
                        <MenuItem value="comment">💬 Commentaire</MenuItem>
                        <MenuItem value="note">📝 Note simple</MenuItem>
                    </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                        fullWidth
                        label="Numéro (ex: 09-35)"
                        size="small"
                        value={entry.number || ''}
                        onChange={(e) => handleFieldChange('number', e.target.value)}
                        disabled={readOnly}
                    />
                </Grid>
                {entry.type === 'resolution' && meetingId && (userRole === 'coordinator') && (
                    <Grid size={{ xs: 12, sm: 4 }} sx={{ display: 'flex', alignItems: 'flex-end', pb: 0.5, gap: 1 }}>
                        {linkedProjectId && (
                            <Tooltip title="Créer une tâche liée à cette décision dans le projet">
                                <Button
                                    variant="outlined"
                                    size="small"
                                    color="info"
                                    onClick={handleCreateTask}
                                    startIcon={<AssignmentIcon />}
                                >
                                    Tâche
                                </Button>
                            </Tooltip>
                        )}
                        <Tooltip title="Créer une recommandation au conseil basée sur cette résolution">
                            <Button
                                variant="outlined"
                                size="small"
                                color="secondary"
                                onClick={handleCreateRecommendation}
                                startIcon={<AutoAwesome />}
                            >
                                Recommander
                            </Button>
                        </Tooltip>
                    </Grid>
                )}
            </Grid>
            {getProjectStatusChip()}
            <TextField
                fullWidth
                multiline
                rows={isExpanded ? 12 : 4}
                label={contentLabel}
                placeholder={contentPlaceholder}
                value={entry.content || ''}
                onChange={(e) => handleFieldChange('content', e.target.value)}
                onFocus={() => setIsExpanded(true)}
                onBlur={() => setIsExpanded(false)}
                variant="outlined"
                size="small"
                disabled={readOnly}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 1, flexDirection: 'column', gap: 1 }}>
                            {!readOnly && (
                                <>
                                    {entry.type === 'resolution' && (
                                        <Tooltip title="✨ 'Magic Draft' : Rédiger avec IA">
                                            <IconButton
                                                onClick={handleMagicDraft}
                                                color="primary"
                                                disabled={isDrafting}
                                                size="small"
                                                sx={{
                                                    bgcolor: 'primary.50',
                                                    '&:hover': { bgcolor: 'primary.100' },
                                                    border: '1px solid',
                                                    borderColor: 'primary.main'
                                                }}
                                            >
                                                {isDrafting ? <CircularProgress size={20} /> : <AutoMode fontSize="small" />}
                                            </IconButton>
                                        </Tooltip>
                                    )}

                                    <Tooltip title="❓ Questionner la Jurisprudence">
                                        <IconButton
                                            onClick={() => setShowChat(true)}
                                            color="info"
                                            size="small"
                                            sx={{
                                                bgcolor: 'info.50',
                                                '&:hover': { bgcolor: 'info.100' },
                                                border: '1px solid',
                                                borderColor: 'info.main'
                                            }}
                                        >
                                            <HelpOutline fontSize="small" />
                                        </IconButton>
                                    </Tooltip>

                                    <Tooltip title="🔗 Auto-Connecteur : Lier règlements détectés">
                                        <IconButton
                                            onClick={handleAutoLink}
                                            color="secondary"
                                            disabled={isDrafting}
                                            size="small"
                                            sx={{
                                                bgcolor: 'secondary.50',
                                                '&:hover': { bgcolor: 'secondary.100' },
                                                border: '1px solid',
                                                borderColor: 'secondary.main'
                                            }}
                                        >
                                            <Link fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="🛡️ Le Gardien : Vérifier la conformité réglementaire">
                                        <IconButton
                                            onClick={handleGuardianCheck}
                                            color="error"
                                            disabled={isDrafting || checkingCompliance}
                                            size="small"
                                            sx={{
                                                bgcolor: 'error.50',
                                                '&:hover': { bgcolor: 'error.100' },
                                                border: '1px solid',
                                                borderColor: 'error.main'
                                            }}
                                        >
                                            {checkingCompliance ? <CircularProgress size={20} color="error" /> : <Shield fontSize="small" />}
                                        </IconButton>
                                    </Tooltip>
                                </>
                            )}
                        </InputAdornment>
                    ),
                }}
                sx={{
                    transition: 'all 0.3s ease-in-out',
                    '& .MuiInputBase-root': {
                        transition: 'all 0.3s ease-in-out',
                        pr: 1
                    }
                }}
            />

            {/* Guardian Results Display - Kept as is */}
            {complianceResult && (
                <Box sx={{ mt: 2, p: 2, borderRadius: 1, bgcolor: complianceResult.compliant ? 'success.50' : 'error.50', border: '1px solid', borderColor: complianceResult.compliant ? 'success.main' : 'error.main' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        {complianceResult.compliant ? <CheckCircle color="success" sx={{ mr: 1 }} /> : <Warning color="error" sx={{ mr: 1 }} />}
                        <Typography variant="subtitle2" color={complianceResult.compliant ? 'success.dark' : 'error.dark'}>
                            {complianceResult.compliant ? 'Conforme aux règlements vérifiés' : 'Attention : Conflits potentiels détectés'}
                        </Typography>
                    </Box>

                    {!complianceResult.compliant && (
                        <Box sx={{ mt: 1 }}>
                            {complianceResult.issues.map((issue, i) => (
                                <Typography key={i} variant="body2" color="error" sx={{ display: 'flex', alignItems: 'flex-start', mt: 0.5 }}>
                                    • {issue}
                                </Typography>
                            ))}
                            {complianceResult.suggestions.length > 0 && (
                                <Box sx={{ mt: 1 }}>
                                    <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>Suggestions :</Typography>
                                    {complianceResult.suggestions.map((suggestion, i) => (
                                        <Typography key={i} variant="caption" display="block" color="text.secondary" sx={{ ml: 1 }}>
                                            - {suggestion}
                                        </Typography>
                                    ))}
                                </Box>
                            )}
                        </Box>
                    )}

                    {complianceResult.citedRegulations.length > 0 && (
                        <Typography variant="caption" display="block" sx={{ mt: 1, color: 'text.secondary', fontStyle: 'italic' }}>
                            Règlements analysés : {complianceResult.citedRegulations.join(', ')}
                        </Typography>
                    )}
                </Box>
            )}

            {/* Jurisprudence Chat Dialog */}
            <Dialog
                open={showChat}
                onClose={() => setShowChat(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <AutoAwesome color="primary" />
                    Assistant Jurisprudence
                    <Typography variant="caption" sx={{ ml: 'auto', color: 'text.secondary' }}>
                        Contexte : {itemTitle}
                    </Typography>
                </DialogTitle>
                <DialogContent dividers sx={{ p: 0 }}>
                    <JurisprudenceChatBox
                        height="50vh"
                        initialContext={`Point à l'étude : ${itemTitle}\nDescription : ${itemDescription}`}
                        placeholder="Ex: A-t-on déjà accepté ce type de demande ?"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowChat(false)}>Fermer</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default React.memo(MinuteEntryEditor);
