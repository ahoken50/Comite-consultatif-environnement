import React, { useState, useRef, useEffect } from 'react';
import {
    TextField,
    Popper,
    Paper,
    List,
    ListItem,
    ListItemButton,
    ListItemAvatar,
    ListItemText,
    Avatar,
    Typography,
    Box,
    Chip
} from '@mui/material';
import { Person } from '@mui/icons-material';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/rootReducer';
import type { Member } from '../../types/member.types';

interface MentionInputProps {
    value: string;
    onChange: (value: string) => void;
    onMention?: (member: Member) => void;
    placeholder?: string;
    label?: string;
    multiline?: boolean;
    rows?: number;
    fullWidth?: boolean;
    disabled?: boolean;
}

/**
 * Mention Input Component (#6.4)
 * Text input that supports @mentions with autocomplete
 */
const MentionInput: React.FC<MentionInputProps> = ({
    value,
    onChange,
    onMention,
    placeholder = 'Tapez @ pour mentionner quelqu\'un...',
    label,
    multiline = true,
    rows = 3,
    fullWidth = true,
    disabled = false
}) => {
    const { items: members } = useSelector((state: RootState) => state.members);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [mentionStart, setMentionStart] = useState(-1);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const anchorRef = useRef<HTMLDivElement>(null);

    // Filter members based on search term
    const filteredMembers = members.filter(member =>
        member.isActive &&
        member.displayName.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 5);

    // Handle text change to detect @ mentions
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        const cursorPos = e.target.selectionStart || 0;

        // Find if we're in a mention context
        const textBeforeCursor = newValue.substring(0, cursorPos);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');

        if (lastAtIndex >= 0) {
            const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
            // Check if there's a space after @, which would end the mention
            if (!textAfterAt.includes(' ')) {
                setShowSuggestions(true);
                setSearchTerm(textAfterAt);
                setMentionStart(lastAtIndex);
                setSelectedIndex(0);
            } else {
                setShowSuggestions(false);
            }
        } else {
            setShowSuggestions(false);
        }

        onChange(newValue);
    };

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showSuggestions || filteredMembers.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev < filteredMembers.length - 1 ? prev + 1 : 0
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev > 0 ? prev - 1 : filteredMembers.length - 1
                );
                break;
            case 'Enter':
            case 'Tab':
                if (showSuggestions && filteredMembers.length > 0) {
                    e.preventDefault();
                    handleSelectMember(filteredMembers[selectedIndex]);
                }
                break;
            case 'Escape':
                setShowSuggestions(false);
                break;
        }
    };

    // Insert mention into text
    const handleSelectMember = (member: Member) => {
        const beforeMention = value.substring(0, mentionStart);
        const afterMention = value.substring(
            mentionStart + 1 + searchTerm.length
        );

        const newValue = `${beforeMention}@${member.displayName} ${afterMention}`;
        onChange(newValue);
        setShowSuggestions(false);

        // Notify parent about the mention
        onMention?.(member);

        // Focus back on input
        inputRef.current?.focus();
    };

    // Close suggestions when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
                setShowSuggestions(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <Box ref={anchorRef} sx={{ position: 'relative' }}>
            <TextField
                inputRef={inputRef}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                label={label}
                multiline={multiline}
                rows={rows}
                fullWidth={fullWidth}
                disabled={disabled}
                variant="outlined"
                size="small"
            />

            <Popper
                open={showSuggestions && filteredMembers.length > 0}
                anchorEl={anchorRef.current}
                placement="bottom-start"
                style={{ zIndex: 1300 }}
            >
                <Paper elevation={8} sx={{ width: 300, mt: 0.5 }}>
                    <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
                        <Typography variant="caption" color="text.secondary">
                            Mentionner un membre
                        </Typography>
                    </Box>
                    <List dense sx={{ py: 0 }}>
                        {filteredMembers.map((member, index) => (
                            <ListItem key={member.id} disablePadding>
                                <ListItemButton
                                    selected={index === selectedIndex}
                                    onClick={() => handleSelectMember(member)}
                                    sx={{ py: 1 }}
                                >
                                    <ListItemAvatar sx={{ minWidth: 40 }}>
                                        <Avatar
                                            src={member.photoURL}
                                            sx={{ width: 28, height: 28 }}
                                        >
                                            <Person fontSize="small" />
                                        </Avatar>
                                    </ListItemAvatar>
                                    <ListItemText
                                        primary={
                                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                {member.displayName}
                                            </Typography>
                                        }
                                        secondary={
                                            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                                                <Chip
                                                    label={member.role}
                                                    size="small"
                                                    sx={{ height: 18, fontSize: '0.65rem' }}
                                                />
                                                {member.expertiseTags?.slice(0, 2).map(tag => (
                                                    <Chip
                                                        key={tag}
                                                        label={tag}
                                                        size="small"
                                                        variant="outlined"
                                                        sx={{ height: 18, fontSize: '0.65rem' }}
                                                    />
                                                ))}
                                            </Box>
                                        }
                                    />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                </Paper>
            </Popper>
        </Box>
    );
};

export default MentionInput;
