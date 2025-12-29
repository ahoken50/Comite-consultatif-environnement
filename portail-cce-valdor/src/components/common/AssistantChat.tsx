import React, { useState, useRef, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    IconButton,
    TextField,
    Fab,
    List,
    ListItem,
    Avatar,
    Divider,
    Fade,
    Link
} from '@mui/material';
import { Chat, Close, Send, SmartToy } from '@mui/icons-material';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { RootState } from '../../store/rootReducer';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Message {
    id: string;
    text: React.ReactNode;
    sender: 'user' | 'ai';
    timestamp: Date;
}

const AssistantChat: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            text: 'Bonjour ! Je suis l\'assistant virtuel du CCE. Je peux chercher des projets ou vous lister les prochaines réunions.',
            sender: 'ai',
            timestamp: new Date()
        }
    ]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    // Data Access
    const projects = useSelector((state: RootState) => state.projects.items);
    const meetings = useSelector((state: RootState) => state.meetings.items);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSend = () => {
        if (!input.trim()) return;

        const userText = input.trim();
        const userMsg: Message = {
            id: Date.now().toString(),
            text: userText,
            sender: 'user',
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');

        // AI Logic
        setTimeout(() => {
            let aiResponseText: React.ReactNode = "Je ne suis pas sûr de comprendre. Essayez 'Cherche projet [x]' ou 'Prochaines réunions'.";
            const lowerInput = userText.toLowerCase();

            // Intent: List Meetings
            if (lowerInput.includes('réunion') || lowerInput.includes('agenda')) {
                const now = new Date();
                const upcoming = meetings
                    .filter(m => new Date(m.date) >= now)
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .slice(0, 3);

                if (upcoming.length > 0) {
                    aiResponseText = (
                        <Box>
                            <Typography variant="body2" gutterBottom>Voici les prochaines réunions :</Typography>
                            <ul style={{ paddingLeft: 20, margin: 0 }}>
                                {upcoming.map(m => (
                                    <li key={m.id}>
                                        <Link
                                            component="button"
                                            variant="body2"
                                            onClick={() => {
                                                navigate(`/meetings/${m.id}`);
                                                setIsOpen(false);
                                            }}
                                            sx={{ textAlign: 'left' }}
                                        >
                                            {format(new Date(m.date), "d MMM à HH:mm", { locale: fr })}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </Box>
                    );
                } else {
                    aiResponseText = "Aucune réunion future trouvée.";
                }
            }
            // Intent: Search Projects
            else if (lowerInput.includes('cherche') || lowerInput.includes('projet')) {
                const keyword = lowerInput.replace('cherche', '').replace('projet', '').trim();
                if (keyword.length < 2 && !lowerInput.includes('projet')) {
                    aiResponseText = "Pour chercher un projet, précisez un mot-clé (ex: 'Projet Eau').";
                } else {
                    const results = projects.filter(p =>
                        p.name.toLowerCase().includes(keyword) ||
                        p.code.toLowerCase().includes(keyword)
                    ).slice(0, 3);

                    if (results.length > 0) {
                        aiResponseText = (
                            <Box>
                                <Typography variant="body2" gutterBottom>Voici des projets correspondants :</Typography>
                                <ul style={{ paddingLeft: 20, margin: 0 }}>
                                    {results.map(p => (
                                        <li key={p.id}>
                                            <Link
                                                component="button"
                                                variant="body2"
                                                onClick={() => {
                                                    navigate(`/projects/${p.id}`);
                                                    setIsOpen(false);
                                                }}
                                                sx={{ textAlign: 'left' }}
                                            >
                                                {p.code} - {p.name}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </Box>
                        );
                    } else {
                        aiResponseText = `Aucun projet trouvé pour "${keyword}".`;
                    }
                }
            }
            // Intent: Help
            else if (lowerInput.includes('aide') || lowerInput.includes('peux')) {
                aiResponseText = (
                    <Box>
                        <Typography variant="body2" gutterBottom>Je peux vous aider à :</Typography>
                        <ul style={{ paddingLeft: 20, margin: 0 }}>
                            <li>Voir les réunions : "Prochaines réunions"</li>
                            <li>Chercher un projet : "Cherche projet [nom]"</li>
                            <li>(Bientôt) Rédiger des PVs</li>
                        </ul>
                    </Box>
                );
            }

            const aiMsg: Message = {
                id: (Date.now() + 1).toString(),
                text: aiResponseText,
                sender: 'ai',
                timestamp: new Date()
            };
            setMessages(prev => [...prev, aiMsg]);
        }, 600);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <>
            <Fade in={!isOpen}>
                <Fab
                    color="primary"
                    aria-label="Assistant CCE"
                    onClick={() => setIsOpen(true)}
                    sx={{
                        position: 'fixed',
                        bottom: 24,
                        right: 24,
                        zIndex: 1000
                    }}
                >
                    <Chat />
                </Fab>
            </Fade>

            <Fade in={isOpen}>
                <Paper
                    elevation={12}
                    sx={{
                        position: 'fixed',
                        bottom: 24,
                        right: 24,
                        width: 350,
                        height: 500,
                        display: 'flex',
                        flexDirection: 'column',
                        zIndex: 1000,
                        borderRadius: 4,
                        overflow: 'hidden'
                    }}
                >
                    <Box sx={{
                        p: 2,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Avatar sx={{ bgcolor: 'white', color: 'primary.main', width: 32, height: 32 }}>
                                <SmartToy fontSize="small" />
                            </Avatar>
                            <Typography variant="subtitle1" fontWeight="bold">
                                Assistant CCE
                            </Typography>
                        </Box>
                        <IconButton size="small" onClick={() => setIsOpen(false)} sx={{ color: 'inherit' }}>
                            <Close />
                        </IconButton>
                    </Box>

                    <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2, bgcolor: '#f5f5f5' }}>
                        <List dense>
                            {messages.map((msg) => (
                                <ListItem
                                    key={msg.id}
                                    sx={{
                                        flexDirection: 'column',
                                        alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                                        py: 0.5
                                    }}
                                >
                                    <Paper
                                        sx={{
                                            p: 1.5,
                                            maxWidth: '85%',
                                            bgcolor: msg.sender === 'user' ? 'primary.main' : 'white',
                                            color: msg.sender === 'user' ? 'white' : 'text.primary',
                                            borderRadius: 2,
                                            borderBottomRightRadius: msg.sender === 'user' ? 0 : 2,
                                            borderBottomLeftRadius: msg.sender === 'ai' ? 0 : 2
                                        }}
                                    >
                                        <Typography component="div" variant="body2">{msg.text}</Typography>
                                    </Paper>
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, px: 1 }}>
                                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </Typography>
                                </ListItem>
                            ))}
                            <div ref={messagesEndRef} />
                        </List>
                    </Box>

                    <Divider />

                    <Box sx={{ p: 2, bgcolor: 'white', display: 'flex', gap: 1 }}>
                        <TextField
                            fullWidth
                            size="small"
                            placeholder="Posez une question..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={handleKeyPress}
                            variant="outlined"
                        />
                        <IconButton color="primary" onClick={handleSend} disabled={!input.trim()}>
                            <Send />
                        </IconButton>
                    </Box>
                </Paper>
            </Fade>
        </>
    );
};

export default AssistantChat;
