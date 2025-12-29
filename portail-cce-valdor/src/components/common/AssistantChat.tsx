import React, { useState, useRef, useEffect } from 'react';
import {
    Box,
    Paper,
    Typography,
    TextField,
    Fab,
    List,
    ListItem,
    Avatar,
    IconButton,
    Fade,
    Divider
} from '@mui/material';
import { SmartToy, Send, Close, Chat } from '@mui/icons-material';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/rootReducer';

interface Message {
    id: string;
    text: React.ReactNode;
    sender: 'user' | 'ai';
    timestamp: Date;
}

const AssistantChat: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { id: '1', text: 'Bonjour ! Je suis l\'assistant IA du CCE. Comment puis-je vous aider aujourd\'hui ?', sender: 'ai', timestamp: new Date() }
    ]);
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Data context
    const { items: projects } = useSelector((state: RootState) => state.projects);
    const { items: meetings } = useSelector((state: RootState) => state.meetings);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSend = async () => {
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

        // AI Logic with Vertex AI
        setMessages(prev => [...prev, {
            id: 'loading',
            text: 'Réflexion en cours...',
            sender: 'ai',
            timestamp: new Date()
        }]);

        try {
            // Dynamic import to avoid SSR/Initial load issues
            // @ts-ignore
            const { getGenerativeModel } = await import('firebase/ai');
            const { vertexAI } = await import('../../services/firebase');

            const model = getGenerativeModel(vertexAI, { model: 'gemini-2.0-flash' });

            // Prepare Context
            const contextData = {
                currentDate: new Date().toISOString(),
                projects: projects.map(p => ({
                    id: p.id,
                    code: p.code,
                    name: p.name,
                    status: p.status,
                    priority: p.priority,
                    category: p.category,
                    nextSteps: p.nextSteps
                })),
                meetings: meetings.map(m => ({
                    id: m.id,
                    date: m.date,
                    location: m.location
                }))
            };

            const prompt = `
            Tu es l'assistant virtuel du Comité Consultatif en Environnement (CCE).
            
            Contexte actuel (JSON):
            ${JSON.stringify(contextData)}

            Instructions:
            1. Réponds de manière concise et utile en français.
            2. Utilise le contexte fourni pour répondre aux questions sur les projets et réunions.
            3. Si on te demande de chercher un projet, donne son statut et ses prochaines étapes.
            4. Si on te demande les prochaines réunions, liste-les.
            
            Question de l'utilisateur: "${userText}"
            `;

            const result = await model.generateContent(prompt);
            const response = result.response;
            const text = response.text();

            setMessages(prev => {
                const filtered = prev.filter(m => m.id !== 'loading');
                return [...filtered, {
                    id: (Date.now() + 1).toString(),
                    text: text, // Gemini returns Markdown, plain text for now or need a parser
                    sender: 'ai',
                    timestamp: new Date()
                }];
            });

        } catch (error) {
            console.error("Vertex AI Error:", error);
            setMessages(prev => {
                const filtered = prev.filter(m => m.id !== 'loading');
                return [...filtered, {
                    id: (Date.now() + 1).toString(),
                    text: "Désolé, je rencontre des difficultés pour accéder à mon cerveau numérique (Vertex AI).",
                    sender: 'ai',
                    timestamp: new Date()
                }];
            });
        }
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
