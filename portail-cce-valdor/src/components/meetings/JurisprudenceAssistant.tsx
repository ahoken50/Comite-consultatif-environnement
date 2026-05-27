import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    TextField,
    Button,
    Typography,
    Tabs,
    Tab,
    CircularProgress,
    IconButton,
    List,
    Chip,
    Paper,
    InputAdornment,
    Alert
} from '@mui/material';
import {
    Search as SearchIcon,
    Chat as ChatIcon,
    ContentCopy as CopyIcon,
    Send as SendIcon,
    AutoAwesome as SparklesIcon,
    ArrowForward as ArrowIcon
} from '@mui/icons-material';
import { searchResolutions } from '../../services/supabaseSearchService';
import { aiService } from '../../services/ai/UnifiedAIService';

interface JurisprudenceAssistantProps {
    onInsertText?: (text: string) => void;
    initialQuery?: string;
    onClose?: () => void;
}

interface ChatMessage {
    sender: 'user' | 'ai';
    text: string;
}

const JurisprudenceAssistant: React.FC<JurisprudenceAssistantProps> = ({
    onInsertText,
    initialQuery = '',
    onClose
}) => {
    const [activeTab, setActiveTab] = useState(0);
    
    // Search Tab States
    const [searchQuery, setSearchQuery] = useState(initialQuery);
    const [searchMode, setSearchMode] = useState<'semantic' | 'text'>('semantic');
    const [searching, setSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Chat Tab States
    const [chatInput, setChatInput] = useState('');
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatLoading, setChatLoading] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (initialQuery) {
            setSearchQuery(initialQuery);
            handleSearch(initialQuery);
        }
    }, [initialQuery]);

    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chatMessages, chatLoading]);

    // Handle Search
    const handleSearch = async (queryText?: string) => {
        const textToSearch = queryText || searchQuery;
        if (!textToSearch.trim()) return;

        setSearching(true);
        setSearchError(null);
        try {
            // Options: matchCount 8, vector similarity threshold 0.4
            const results = await searchResolutions(textToSearch, {
                matchCount: 8,
                matchThreshold: searchMode === 'semantic' ? 0.35 : 0.0
            });
            setSearchResults(results.hits || []);
        } catch (err: any) {
            console.error("Search failed:", err);
            setSearchError("Impossible de se connecter à la base vectorielle. Veuillez vérifier votre connexion.");
        } finally {
            setSearching(false);
        }
    };

    // Copy Content
    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        alert("Formulation copiée dans le presse-papiers !");
    };

    // Insert Content
    const handleInsert = (text: string) => {
        if (onInsertText) {
            onInsertText(text);
        }
    };

    // Handle Chat
    const handleSendChatMessage = async () => {
        if (!chatInput.trim() || chatLoading) return;

        const userQuestion = chatInput;
        setChatMessages(prev => [...prev, { sender: 'user', text: userQuestion }]);
        setChatInput('');
        setChatLoading(true);

        try {
            // 1. RAG Step: Search for resolutions related to the question
            const searchResults = await searchResolutions(userQuestion, {
                matchCount: 4,
                matchThreshold: 0.35
            });

            // 2. Format search results into context
            const contextText = searchResults.hits && searchResults.hits.length > 0
                ? searchResults.hits.map((h, i) => 
                    `[RÉSOLUTION ${h.document.number || i + 1} - Réunion: ${h.document.meetingTitle} (${h.document.date ? new Date(h.document.date).toLocaleDateString('fr-CA') : 'Date inconnue'})]\nContenu:\n${h.document.content}`
                  ).join('\n\n---\n\n')
                : "Aucune résolution passée correspondante trouvée.";

            // 3. Call Chat Service
            const aiResponse = await aiService.chatWithJurisprudence(userQuestion, contextText);
            
            setChatMessages(prev => [...prev, { sender: 'ai', text: aiResponse }]);
        } catch (err: any) {
            console.error("Chat failed:", err);
            setChatMessages(prev => [...prev, { sender: 'ai', text: "Désolé, je n'ai pas pu analyser la jurisprudence pour répondre à cette question. Veuillez vérifier les clés API ou votre connexion." }]);
        } finally {
            setChatLoading(false);
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: '#ffffff' }}>
            {/* Header */}
            <Box sx={{ p: 2, bgcolor: '#1e4e3d', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <SparklesIcon sx={{ color: '#c5a065' }} />
                    <Typography variant="h6" fontWeight="bold">Assistant Jurisprudence IA</Typography>
                </Box>
                {onClose && (
                    <Button onClick={onClose} size="small" sx={{ color: '#ffffff', borderColor: '#ffffff', textTransform: 'none' }} variant="outlined">
                        Fermer
                    </Button>
                )}
            </Box>

            {/* Tabs */}
            <Tabs 
                value={activeTab} 
                onChange={(_, val) => setActiveTab(val)} 
                variant="fullWidth"
                sx={{ 
                    borderBottom: 1, 
                    borderColor: 'divider',
                    '& .MuiTabs-indicator': { bgcolor: '#1e4e3d' },
                    '& .MuiTab-root.Mui-selected': { color: '#1e4e3d', fontWeight: 'bold' }
                }}
            >
                <Tab label="Recherche sémantique" icon={<SearchIcon fontSize="small" />} iconPosition="start" />
                <Tab label="Clavarder avec l'IA" icon={<ChatIcon fontSize="small" />} iconPosition="start" />
            </Tabs>

            {/* Content Areas */}
            <Box sx={{ flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                
                {/* TAB 0: SEMANTIC SEARCH */}
                {activeTab === 0 && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 2 }}>
                        {/* Search Mode Toggle */}
                        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                            <Button 
                                variant={searchMode === 'semantic' ? 'contained' : 'outlined'}
                                size="small"
                                onClick={() => setSearchMode('semantic')}
                                sx={{ 
                                    flexGrow: 1,
                                    bgcolor: searchMode === 'semantic' ? '#1e4e3d' : 'transparent',
                                    color: searchMode === 'semantic' ? '#ffffff' : '#1e4e3d',
                                    borderColor: '#1e4e3d',
                                    '&:hover': { bgcolor: searchMode === 'semantic' ? '#143529' : 'rgba(30, 78, 61, 0.04)', borderColor: '#1e4e3d' }
                                }}
                            >
                                ✨ IA Sémantique (Sens)
                            </Button>
                            <Button 
                                variant={searchMode === 'text' ? 'contained' : 'outlined'}
                                size="small"
                                onClick={() => setSearchMode('text')}
                                sx={{ 
                                    flexGrow: 1,
                                    bgcolor: searchMode === 'text' ? '#1e4e3d' : 'transparent',
                                    color: searchMode === 'text' ? '#ffffff' : '#1e4e3d',
                                    borderColor: '#1e4e3d',
                                    '&:hover': { bgcolor: searchMode === 'text' ? '#143529' : 'rgba(30, 78, 61, 0.04)', borderColor: '#1e4e3d' }
                                }}
                            >
                                Mot-clé exact
                            </Button>
                        </Box>

                        {/* Search Input */}
                        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                            <TextField
                                fullWidth
                                size="small"
                                placeholder="ex. protection des bandes riveraines..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                disabled={searching}
                                InputProps={{
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            {searching ? <CircularProgress size={20} /> : <SearchIcon color="action" />}
                                        </InputAdornment>
                                    )
                                }}
                            />
                            <Button 
                                variant="contained" 
                                onClick={() => handleSearch()}
                                disabled={searching || !searchQuery.trim()}
                                sx={{ bgcolor: '#1e4e3d', '&:hover': { bgcolor: '#143529' } }}
                            >
                                Chercher
                            </Button>
                        </Box>

                        {searchError && (
                            <Alert severity="error" sx={{ mb: 2 }}>{searchError}</Alert>
                        )}

                        {/* Results List */}
                        <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
                            {searching ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                                    <CircularProgress sx={{ color: '#1e4e3d' }} />
                                </Box>
                            ) : searchResults.length === 0 ? (
                                <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'text.secondary', p: 3, textAlign: 'center' }}>
                                    <SearchIcon sx={{ fontSize: 40, mb: 1, color: 'text.disabled' }} />
                                    <Typography variant="body2">
                                        Saisissez un sujet pour rechercher des formulations similaires dans la jurisprudence du CCE.
                                    </Typography>
                                </Box>
                            ) : (
                                <List sx={{ width: '100%', p: 0 }}>
                                    {searchResults.map((hit, index) => {
                                        const res = hit.document;
                                        // Calculate percentage similarity from distance
                                        const similarityPercent = hit.vectorDistance !== undefined 
                                            ? Math.round((1 - hit.vectorDistance) * 100) 
                                            : null;

                                        return (
                                            <Paper key={index} variant="outlined" sx={{ p: 2, mb: 2, borderColor: '#e0e0e0', '&:hover': { borderColor: '#1e4e3d' } }}>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                                                    <Box>
                                                        <Typography variant="subtitle2" fontWeight="bold" color="primary">
                                                            {res.meetingTitle}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            Séance du {res.date ? new Date(res.date).toLocaleDateString('fr-CA') : 'Date inconnue'}
                                                        </Typography>
                                                    </Box>
                                                    {similarityPercent !== null && (
                                                        <Chip 
                                                            label={`${similarityPercent}% Pertinence`} 
                                                            size="small" 
                                                            color={similarityPercent > 80 ? 'success' : similarityPercent > 60 ? 'warning' : 'default'}
                                                            variant="outlined" 
                                                        />
                                                    )}
                                                </Box>

                                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: '#fcfdfc', p: 1.5, borderRadius: 1, borderLeft: '3px solid #c5a065', mb: 1.5 }}>
                                                    {res.content}
                                                </Typography>

                                                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                                                    <Button 
                                                        size="small" 
                                                        variant="outlined" 
                                                        startIcon={<CopyIcon fontSize="small" />}
                                                        onClick={() => handleCopy(res.content)}
                                                        sx={{ color: '#1e4e3d', borderColor: '#1e4e3d', textTransform: 'none' }}
                                                    >
                                                        Copier
                                                    </Button>
                                                    {onInsertText && (
                                                        <Button 
                                                            size="small" 
                                                            variant="contained" 
                                                            startIcon={<ArrowIcon fontSize="small" />}
                                                            onClick={() => handleInsert(res.content)}
                                                            sx={{ bgcolor: '#1e4e3d', '&:hover': { bgcolor: '#143529' }, textTransform: 'none' }}
                                                        >
                                                            Insérer
                                                        </Button>
                                                    )}
                                                </Box>
                                            </Paper>
                                        );
                                    })}
                                </List>
                            )}
                        </Box>
                    </Box>
                )}

                {/* TAB 1: RAG CHAT */}
                {activeTab === 1 && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        {/* Messages Area */}
                        <Box sx={{ flexGrow: 1, p: 2, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, bgcolor: '#f9fbf9' }}>
                            {chatMessages.length === 0 && (
                                <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'text.secondary', p: 3, textAlign: 'center' }}>
                                    <SparklesIcon sx={{ fontSize: 50, mb: 1, color: '#c5a065' }} />
                                    <Typography variant="subtitle2" fontWeight="bold" gutterBottom>Clavarder avec la Jurisprudence</Typography>
                                    <Typography variant="body2" sx={{ maxWidth: 300 }}>
                                        Posez des questions sur les décisions du passé. L'IA consultera tous les PV archivés pour vous répondre avec exactitude.
                                    </Typography>
                                    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1, width: '100%', maxWidth: 300 }}>
                                        <Chip 
                                            label="Qu'a-t-on décidé pour les bornes de recharge ?" 
                                            onClick={() => setChatInput("Qu'a-t-on décidé pour les bornes de recharge ?")}
                                            variant="outlined" 
                                            clickable 
                                        />
                                        <Chip 
                                            label="Formulations pour coupes d'arbres riverains" 
                                            onClick={() => setChatInput("Donne-moi des exemples de résolutions pour les coupes d'arbres riverains")}
                                            variant="outlined" 
                                            clickable 
                                        />
                                    </Box>
                                </Box>
                            )}

                            {chatMessages.map((msg, index) => (
                                <Box 
                                    key={index} 
                                    sx={{ 
                                        display: 'flex', 
                                        justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                                        width: '100%'
                                    }}
                                >
                                    <Paper 
                                        elevation={1} 
                                        sx={{ 
                                            p: 1.5, 
                                            maxWidth: '85%', 
                                            bgcolor: msg.sender === 'user' ? '#1e4e3d' : '#ffffff',
                                            color: msg.sender === 'user' ? '#ffffff' : '#333333',
                                            borderRadius: msg.sender === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                                            border: msg.sender === 'user' ? 'none' : '1px solid #e2e8f0'
                                        }}
                                    >
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                            {msg.text}
                                        </Typography>
                                    </Paper>
                                </Box>
                            ))}

                            {chatLoading && (
                                <Box sx={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
                                    <Paper 
                                        elevation={1} 
                                        sx={{ 
                                            p: 1.5, 
                                            bgcolor: '#ffffff', 
                                            borderRadius: '12px 12px 12px 2px',
                                            border: '1px solid #e2e8f0',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1
                                        }}
                                    >
                                        <CircularProgress size={16} sx={{ color: '#1e4e3d' }} />
                                        <Typography variant="body2" color="text.secondary">L'IA parcourt les archives...</Typography>
                                    </Paper>
                                </Box>
                            )}
                            <div ref={chatEndRef} />
                        </Box>

                        {/* Input Area */}
                        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', bgcolor: '#ffffff', display: 'flex', gap: 1 }}>
                            <TextField
                                fullWidth
                                size="small"
                                placeholder="Posez votre question à la jurisprudence..."
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSendChatMessage()}
                                disabled={chatLoading}
                            />
                            <IconButton 
                                onClick={handleSendChatMessage}
                                disabled={chatLoading || !chatInput.trim()}
                                sx={{ 
                                    bgcolor: '#1e4e3d', 
                                    color: '#ffffff',
                                    '&:hover': { bgcolor: '#143529' },
                                    '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' }
                                }}
                            >
                                <SendIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default JurisprudenceAssistant;
