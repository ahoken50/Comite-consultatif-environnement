import React, { useState, useEffect } from 'react';
import {
    Card, CardHeader, CardContent, Box, Typography, LinearProgress,
    IconButton, Chip, Tooltip, Skeleton, Badge
} from '@mui/material';
import {
    SmartToy, TrendingUp, TrendingDown, TrendingFlat,
    PlayArrow, CheckCircle, Warning, HourglassEmpty, Info
} from '@mui/icons-material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';
import { runAutonomousMLLoop } from '../../services/mlSuggestionsService';
import { getLastMLLoopResult, getVerificationQueueCount, type MLLoopResult } from '../../services/voiceAlertService';

interface MLDashboardData {
    rlhf: {
        avgReward: number;
        rewardTrend: string;
        recentRewards: Array<{ totalReward: number; grade: string; timestamp: string }>;
    };
    embeddingQuality: {
        avgAccuracy: number;
        totalMembers: number;
    };
    qualityTrends: {
        overallTrend?: string;
        qualityTrend?: Array<any>;
        avgQualityScore?: number;
    };
}

const AIHealthWidget: React.FC = () => {
    const [data, setData] = useState<MLDashboardData | null>(null);
    const [lastLoop, setLastLoop] = useState<MLLoopResult | null>(null);
    const [verificationCount, setVerificationCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const functions = getFunctions(getApp(), 'us-central1');
                const getDashboard = httpsCallable(functions, 'get_ml_dashboard');

                const [dashResult, loopResult, queueCount] = await Promise.allSettled([
                    getDashboard(),
                    getLastMLLoopResult(),
                    getVerificationQueueCount(),
                ]);

                if (dashResult.status === 'fulfilled') {
                    setData((dashResult.value as any).data as MLDashboardData);
                }
                if (loopResult.status === 'fulfilled') {
                    setLastLoop(loopResult.value);
                }
                if (queueCount.status === 'fulfilled') {
                    setVerificationCount(queueCount.value);
                }
            } catch (e) {
                console.error('[AIHealthWidget] Error:', e);
                setError(true);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const handleRunMLLoop = async () => {
        setRunning(true);
        try {
            const result = await runAutonomousMLLoop(undefined, 'quick');
            setLastLoop({
                timestamp: new Date().toISOString(),
                autoLearned: result.autoLearned,
                queuedForReview: result.queuedForReview,
                suggestionsGenerated: result.suggestionsGenerated,
                mode: 'quick',
            });
        } catch (e) {
            console.error('[AIHealthWidget] ML loop failed:', e);
        } finally {
            setRunning(false);
        }
    };

    const getRewardColor = (score: number) => {
        if (score >= 0.7) return '#22c55e';
        if (score >= 0.4) return '#eab308';
        return '#ef4444';
    };

    const getTrendIcon = (trend: string) => {
        switch (trend) {
            case 'improving': return <TrendingUp sx={{ color: '#22c55e', fontSize: 20 }} />;
            case 'declining': return <TrendingDown sx={{ color: '#ef4444', fontSize: 20 }} />;
            default: return <TrendingFlat sx={{ color: '#64748b', fontSize: 20 }} />;
        }
    };

    const formatDate = (ts: string) => {
        try {
            const d = new Date(ts);
            return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        } catch {
            return 'N/D';
        }
    };

    if (loading) {
        return (
            <Card sx={{ height: '100%' }}>
                <CardHeader title={<Skeleton width={180} />} />
                <CardContent>
                    <Skeleton variant="rectangular" height={20} sx={{ mb: 2 }} />
                    <Skeleton variant="rectangular" height={20} sx={{ mb: 2 }} />
                    <Skeleton variant="rectangular" height={20} />
                </CardContent>
            </Card>
        );
    }

    if (error || !data) {
        return (
            <Card sx={{ height: '100%' }}>
                <CardHeader
                    avatar={<SmartToy color="primary" />}
                    title="Santé IA"
                />
                <CardContent>
                    <Typography variant="body2" color="text.secondary">
                        Impossible de charger les données IA.
                    </Typography>
                </CardContent>
            </Card>
        );
    }

    const avgReward = data.rlhf?.avgReward || 0;
    const rewardPercent = Math.max(0, Math.min(100, ((avgReward + 1) / 2) * 100));

    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader
                avatar={<SmartToy color="primary" />}
                title={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>Santé IA</Typography>
                        {verificationCount > 0 && (
                            <Badge badgeContent={verificationCount} color="warning" max={99}>
                                <HourglassEmpty fontSize="small" color="action" />
                            </Badge>
                        )}
                    </Box>
                }
                action={
                    <Tooltip title={running ? "Boucle ML en cours..." : "Lancer la boucle ML"}>
                        <span>
                            <IconButton
                                onClick={handleRunMLLoop}
                                disabled={running}
                                color="primary"
                                size="small"
                            >
                                {running ? <HourglassEmpty fontSize="small" /> : <PlayArrow fontSize="small" />}
                            </IconButton>
                        </span>
                    </Tooltip>
                }
                sx={{ pb: 0 }}
            />
            <CardContent sx={{ pt: 1 }}>
                {/* RLHF Score */}
                <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Score RLHF</Typography>
                            <Tooltip title="Indicateur d'apprentissage par renforcement (Reinforcement Learning from Human Feedback) mesurant l'adéquation des suggestions de l'IA par rapport aux corrections humaines (-1.00 à +1.00). Plus le score est proche de 1.00, plus l'IA est alignée sur vos préférences.">
                                <Info sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
                            </Tooltip>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: getRewardColor(avgReward) }}>
                                {avgReward.toFixed(2)}
                            </Typography>
                            {getTrendIcon(data.rlhf?.rewardTrend || 'stable')}
                        </Box>
                    </Box>
                    <LinearProgress
                        variant="determinate"
                        value={rewardPercent}
                        sx={{
                            height: 8,
                            borderRadius: 4,
                            bgcolor: 'grey.200',
                            '& .MuiLinearProgress-bar': {
                                borderRadius: 4,
                                bgcolor: getRewardColor(avgReward),
                            }
                        }}
                    />
                </Box>

                {/* Embedding Quality */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">Précision vocale</Typography>
                        <Tooltip title="Précision moyenne du modèle à identifier les membres à partir de leurs empreintes vocales. Si affiché à 0%, cela signifie qu'aucune boucle de calibration ML n'a encore été complétée avec des données vocales enregistrées.">
                            <Info sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
                        </Tooltip>
                    </Box>
                    <Chip
                        label={`${((data.embeddingQuality?.avgAccuracy || 0) * 100).toFixed(0)}%`}
                        size="small"
                        color={data.embeddingQuality?.avgAccuracy >= 0.7 ? 'success' : 'warning'}
                        variant="outlined"
                    />
                </Box>

                {/* Quality Trend */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">Tendance qualité PV</Typography>
                        <Tooltip title="Score d'évaluation moyen (sur 100) de la qualité des procès-verbaux générés, basé sur la pertinence du ton, le respect du format officiel et les corrections apportées.">
                            <Info sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
                        </Tooltip>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {getTrendIcon(data.qualityTrends?.overallTrend || 'stable')}
                        <Typography variant="caption">
                            {data.qualityTrends?.avgQualityScore
                                ? `${data.qualityTrends.avgQualityScore.toFixed(0)}/100`
                                : 'N/D'}
                        </Typography>
                    </Box>
                </Box>

                {/* Verification Queue */}
                {verificationCount > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <Warning fontSize="small" sx={{ color: '#f97316' }} />
                        <Typography variant="caption" color="text.secondary">
                            {verificationCount} vérification{verificationCount > 1 ? 's' : ''} en attente
                        </Typography>
                    </Box>
                )}

                {/* Last ML Loop */}
                {lastLoop && (
                    <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CheckCircle sx={{ fontSize: 14, color: '#22c55e' }} />
                            Dernière boucle : {formatDate(lastLoop.timestamp)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                            {lastLoop.autoLearned} auto-appris · {lastLoop.queuedForReview} en file
                        </Typography>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};

export default AIHealthWidget;
