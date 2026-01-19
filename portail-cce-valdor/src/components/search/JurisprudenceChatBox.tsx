import React, { useState } from 'react';
import { Box, TextField, IconButton, InputAdornment, Typography, CircularProgress, Divider } from '@mui/material';
import { Send, AutoAwesome } from '@mui/icons-material';
import { searchMeetings } from '../../services/typesenseService';

interface JurisprudenceChatBoxProps {
    initialContext?: string;
    height?: string | number;
    placeholder?: string;
}

const JurisprudenceChatBox: React.FC<JurisprudenceChatBoxProps> = ({
    initialContext = '',
    height = '60vh',
    placeholder = "Posez votre question..."
}) => {
    const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([]);
    const [chatInput, setChatInput] = useState('');
    const [chatLoading, setChatLoading] = useState(false);

    const handleChat = async () => {
        if (!chatInput.trim()) return;

        const userMessage = chatInput;
        setChatInput('');
        setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
        setChatLoading(true);

        try {
            // 1. Search for context (limited to top 5 for context)
            const { aiService } = await import('../../services/ai/UnifiedAIService');
            const searchResponse = await searchMeetings(userMessage, { perPage: 5 });

            const fetchedContext = searchResponse.hits.map(h =>
                `SOURCE: ${h.document.title} (${h.document.date})\nEXTRAIT: ${h.document.resolutions?.join('\n') || h.document.minutes || ''}`
            ).join('\n\n');

            const fullContext = (initialContext ? `CONTEXTE DE LA RÉUNION ACTUELLE :\n${initialContext}\n\n` : '') + fetchedContext;

            // 2. Ask AI
            const answer = await aiService.chatWithJurisprudence(userMessage, fullContext);

            setChatHistory(prev => [...prev, { role: 'assistant', content: answer }]);
        } catch (error) {
            console.error('Chat failed', error);
            setChatHistory(prev => [...prev, { role: 'assistant', content: "Désolé, une erreur est survenue lors de la consultation de la jurisprudence." }]);
        } finally {
            setChatLoading(false);
        }
    };

    return (
        <Box sx={{ height, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ flexGrow: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
                {chatHistory.length === 0 && (
                    <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                        <AutoAwesome sx={{ fontSize: 40, mb: 1 }} />
                        <Typography>Posez une question à la jurisprudence.</Typography>
                        <Typography variant="caption">L'IA analysera les résolutions passées pour vous répondre.</Typography>
                    </Box>
                )}

                {chatHistory.map((msg, i) => (
                    <Box key={i} sx={{
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '85%',
                        bgcolor: msg.role === 'user' ? 'primary.light' : 'grey.100',
                        color: msg.role === 'user' ? 'white' : 'text.primary',
                        p: 2,
                        borderRadius: 2,
                        boxShadow: 1
                    }}>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>{msg.content}</Typography>
                    </Box>
                ))}

                {chatLoading && (
                    <Box sx={{ alignSelf: 'flex-start', p: 2 }}>
                        <CircularProgress size={20} />
                    </Box>
                )}
            </Box>
            <Divider />
            <Box sx={{ p: 2, bgcolor: 'background.default' }}>
                <TextField
                    fullWidth
                    placeholder={placeholder}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleChat()}
                    disabled={chatLoading}
                    size="small"
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton onClick={handleChat} disabled={!chatInput.trim() || chatLoading} color="primary" size="small">
                                    <Send fontSize="small" />
                                </IconButton>
                            </InputAdornment>
                        )
                    }}
                />
            </Box>
        </Box>
    );
};

export default JurisprudenceChatBox;
