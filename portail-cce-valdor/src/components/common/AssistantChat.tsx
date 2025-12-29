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
    Fade
} from '@mui/material';
import { Chat, Close, Send, SmartToy } from '@mui/icons-material';

interface Message {
    id: string;
    text: string;
    sender: 'user' | 'ai';
    timestamp: Date;
}

const AssistantChat: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            text: 'Bonjour ! Je suis l\'assistant virtuel du CCE. Comment puis-je vous aider aujourd\'hui ?',
            sender: 'ai',
            timestamp: new Date()
        }
    ]);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSend = () => {
        if (!input.trim()) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            text: input,
            sender: 'user',
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');

        // Simulate AI response
        setTimeout(() => {
            const aiMsg: Message = {
                id: (Date.now() + 1).toString(),
                text: "Je suis une version de démonstration pour l'instant. Bientôt, je pourrai vous aider à rédiger des PV, analyser des documents et planifier vos réunions !",
                sender: 'ai',
                timestamp: new Date()
            };
            setMessages(prev => [...prev, aiMsg]);
        }, 1000);
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
                                        <Typography variant="body2">{msg.text}</Typography>
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
