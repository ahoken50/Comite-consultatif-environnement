import React, { useState, useRef, useEffect } from 'react';
import {
    Card, CardHeader, CardContent, Box, Typography, TextField,
    IconButton, Chip, CircularProgress, Divider, Avatar
} from '@mui/material';
import { AutoAwesome, Send, SmartToy } from '@mui/icons-material';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/rootReducer';
// @ts-expect-error
import { getGenerativeModel } from 'firebase/ai';
import { vertexAI } from '../../services/firebase';

interface ChatMessage {
    id: string;
    text: string;
    sender: 'user' | 'ai';
    timestamp: Date;
}

const QUICK_SUGGESTIONS = [
    { emoji: '📋', label: 'Résumé dernière séance' },
    { emoji: '🔴', label: 'Projets urgents' },
    { emoji: '📅', label: 'Prochaine séance' },
    { emoji: '🔍', label: 'Rechercher une résolution' },
];

const AssistantChatWidget: React.FC = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const { items: projects } = useSelector((state: RootState) => state.projects);
    const { items: meetings } = useSelector((state: RootState) => state.meetings);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = async (text: string) => {
        if (!text.trim() || loading) return;

        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            text: text.trim(),
            sender: 'user',
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        try {
            // RAG context from Supabase
            let ragContext = '';
            try {
                const { searchResolutions } = await import('../../services/supabaseSearchService');
                const hits = await searchResolutions(text, { matchCount: 3, matchThreshold: 0.3 });
                if (hits?.hits?.length) {
                    ragContext = '\n\nRésolutions pertinentes :\n' +
                        hits.hits.map((h: any) =>
                            `[${h.document.number || ''}] ${h.document.meetingTitle} — ${h.document.content?.slice(0, 200)}`
                        ).join('\n');
                }
            } catch { /* RAG optional */ }

            const model = getGenerativeModel(vertexAI, { model: 'gemini-2.5-flash' });

            const contextData = {
                currentDate: new Date().toISOString(),
                projectCount: projects.length,
                urgentProjects: projects.filter(p => p.isUrgent || p.status === 'blocked').map(p => ({ code: p.code, name: p.name, status: p.status })),
                recentMeetings: meetings.slice(0, 5).map(m => ({ date: m.date, title: m.title || `Séance ${m.meetingNumber || ''}`, status: m.status })),
            };

            const prompt = `Tu es l'assistant IA du CCE Val-d'Or. Réponds brièvement en français.
            
Contexte: ${JSON.stringify(contextData)}
${ragContext}

Question: "${text}"

Instructions: Sois concis (max 150 mots). Si pertinent, cite les numéros de résolution.`;

            const result = await model.generateContent(prompt);
            const response = result.response.text();

            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                text: response,
                sender: 'ai',
                timestamp: new Date(),
            }]);
        } catch (error) {
            console.error('[AssistantChatWidget] Error:', error);
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                text: "Désolé, une erreur est survenue.",
                sender: 'ai',
                timestamp: new Date(),
            }]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    return (
        <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <CardHeader
                avatar={
                    <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>
                        <SmartToy sx={{ fontSize: 18 }} />
                    </Avatar>
                }
                title={
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>Assistant CCE</Typography>
                }
                sx={{ pb: 0 }}
            />
            <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', pt: 1, overflow: 'hidden' }}>
                {/* Chat Messages */}
                <Box sx={{
                    flex: 1,
                    overflow: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    mb: 1,
                    minHeight: 200,
                    maxHeight: 280,
                }}>
                    {messages.length === 0 && (
                        <Box sx={{ textAlign: 'center', py: 2, color: 'text.secondary' }}>
                            <AutoAwesome sx={{ fontSize: 32, mb: 1, color: 'primary.main', opacity: 0.6 }} />
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                Posez une question sur vos séances, projets ou résolutions.
                            </Typography>
                            {/* Quick suggestions */}
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 0.5 }}>
                                {QUICK_SUGGESTIONS.map((s) => (
                                    <Chip
                                        key={s.label}
                                        label={`${s.emoji} ${s.label}`}
                                        size="small"
                                        variant="outlined"
                                        onClick={() => sendMessage(s.label)}
                                        sx={{
                                            cursor: 'pointer',
                                            fontSize: '0.7rem',
                                            '&:hover': { bgcolor: 'primary.main', color: 'white', borderColor: 'primary.main' },
                                        }}
                                    />
                                ))}
                            </Box>
                        </Box>
                    )}

                    {messages.map((msg) => (
                        <Box
                            key={msg.id}
                            sx={{
                                alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                                maxWidth: '85%',
                                bgcolor: msg.sender === 'user' ? 'primary.main' : 'grey.100',
                                color: msg.sender === 'user' ? 'white' : 'text.primary',
                                p: 1.5,
                                borderRadius: 2,
                                borderBottomRightRadius: msg.sender === 'user' ? 0 : 8,
                                borderBottomLeftRadius: msg.sender === 'ai' ? 0 : 8,
                            }}
                        >
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-line', fontSize: '0.8rem' }}>
                                {msg.text}
                            </Typography>
                        </Box>
                    ))}

                    {loading && (
                        <Box sx={{ alignSelf: 'flex-start', p: 1 }}>
                            <CircularProgress size={18} />
                        </Box>
                    )}
                    <div ref={messagesEndRef} />
                </Box>

                {/* Input */}
                <Divider sx={{ mb: 1 }} />
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="Posez une question..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyPress}
                        disabled={loading}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                borderRadius: 3,
                                fontSize: '0.85rem',
                            }
                        }}
                    />
                    <IconButton
                        color="primary"
                        onClick={() => sendMessage(input)}
                        disabled={!input.trim() || loading}
                        size="small"
                    >
                        <Send fontSize="small" />
                    </IconButton>
                </Box>
            </CardContent>
        </Card>
    );
};

export default AssistantChatWidget;
