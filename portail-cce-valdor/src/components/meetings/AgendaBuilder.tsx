import React, { useState } from 'react';
import {
    Box,
    Typography,
    IconButton,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    MenuItem,
    Grid,
    Chip,
    Stack
} from '@mui/material';
import { DragIndicator, Add, Delete, Edit, AttachFile } from '@mui/icons-material';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AgendaItem } from '../../types/meeting.types';
import type { Document } from '../../types/document.types';
import DocumentUpload from '../documents/DocumentUpload';
import DocumentPreviewModal from '../documents/DocumentPreviewModal';

interface AgendaBuilderProps {
    items: AgendaItem[];
    onItemsChange: (items: AgendaItem[]) => void;
    meetingId?: string;
    documents?: Document[];
    onDocumentUpload?: () => void;
    initialAgendaItemId?: string;
}

const SortableItem = ({ item, onDelete, onEdit, linkedDocuments }: { item: AgendaItem; onDelete: (id: string) => void; onEdit: (item: AgendaItem) => void; linkedDocuments?: Document[] }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <ListItem
            ref={setNodeRef}
            style={style}
            secondaryAction={
                <Box>
                    <IconButton edge="end" aria-label="edit" onClick={() => onEdit(item)} sx={{ mr: 1 }}>
                        <Edit />
                    </IconButton>
                    <IconButton edge="end" aria-label="delete" onClick={() => onDelete(item.id)}>
                        <Delete />
                    </IconButton>
                </Box>
            }
            sx={{ bgcolor: 'background.paper', mb: 1, borderRadius: 1, boxShadow: 1 }}
        >
            <ListItemIcon {...attributes} {...listeners} sx={{ cursor: 'grab' }}>
                <DragIndicator />
            </ListItemIcon>
            <ListItemText
                primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {item.title}
                        {linkedDocuments && linkedDocuments.length > 0 && (
                            <Chip
                                icon={<AttachFile sx={{ fontSize: 16 }} />}
                                label={linkedDocuments.length}
                                size="small"
                                variant="outlined"
                            />
                        )}
                    </Box>
                }
                secondary={`${item.duration} min - ${item.presenter} - ${item.objective}`}
            />
        </ListItem>
    );
};

const AgendaBuilder: React.FC<AgendaBuilderProps> = ({ items, onItemsChange, meetingId, documents = [], onDocumentUpload, initialAgendaItemId }) => {
    const [editingItem, setEditingItem] = useState<AgendaItem | null>(null);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [previewDoc, setPreviewDoc] = useState<Document | null>(null);

    // Auto-open edit dialog if initialAgendaItemId is provided
    React.useEffect(() => {
        if (initialAgendaItemId && items.length > 0) {
            const itemToEdit = items.find(i => i.id === initialAgendaItemId);
            if (itemToEdit) {
                setEditingItem(itemToEdit);
                setIsEditOpen(true);
            }
        }
    }, [initialAgendaItemId, items]);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = items.findIndex((item) => item.id === active.id);
            const newIndex = items.findIndex((item) => item.id === over.id);
            onItemsChange(arrayMove(items, oldIndex, newIndex));
        }
    };

    const handleAddItem = () => {
        const newItem: AgendaItem = {
            id: Date.now().toString(),
            order: items.length,
            title: 'Nouveau point',
            description: '',
            duration: 15,
            presenter: 'Coordonnateur',
            objective: 'Information',
            decision: '',
        };
        onItemsChange([...items, newItem]);
    };

    const handleDeleteItem = (id: string) => {
        onItemsChange(items.filter(item => item.id !== id));
    };

    const handleEditItem = (item: AgendaItem) => {
        setEditingItem({ ...item });
        setIsEditOpen(true);
    };

    const handleSaveEdit = () => {
        if (editingItem) {
            onItemsChange(items.map(item => item.id === editingItem.id ? editingItem : item));
            setIsEditOpen(false);
            setEditingItem(null);
        }
    };

    const getLinkedDocuments = (itemId: string) => {
        return documents.filter(doc => doc.agendaItemId === itemId);
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Ordre du jour</Typography>
                <Button startIcon={<Add />} onClick={handleAddItem} variant="outlined" size="small">
                    Ajouter un point
                </Button>
            </Box>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={items.map(i => i.id)}
                    strategy={verticalListSortingStrategy}
                >
                    <List>
                        {items.map((item) => (
                            <SortableItem
                                key={item.id}
                                item={item}
                                onDelete={handleDeleteItem}
                                onEdit={handleEditItem}
                                linkedDocuments={getLinkedDocuments(item.id)}
                            />
                        ))}
                    </List>
                </SortableContext>
            </DndContext>

            <Dialog open={isEditOpen} onClose={() => setIsEditOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>Modifier le point</DialogTitle>
                <DialogContent>
                    {editingItem && (
                        <Grid container spacing={2} sx={{ mt: 1 }}>
                            <Grid size={{ xs: 12 }}>
                                <TextField
                                    label="Titre"
                                    fullWidth
                                    value={editingItem.title}
                                    onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                                />
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <TextField
                                    label="Durée (min)"
                                    type="number"
                                    fullWidth
                                    value={editingItem.duration}
                                    onChange={(e) => setEditingItem({ ...editingItem, duration: parseInt(e.target.value) || 0 })}
                                />
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                <TextField
                                    label="Responsable"
                                    fullWidth
                                    value={editingItem.presenter}
                                    onChange={(e) => setEditingItem({ ...editingItem, presenter: e.target.value })}
                                />
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                                <TextField
                                    select
                                    label="Objectif"
                                    fullWidth
                                    value={editingItem.objective}
                                    onChange={(e) => setEditingItem({ ...editingItem, objective: e.target.value })}
                                >
                                    <MenuItem value="Information">Information</MenuItem>
                                    <MenuItem value="Décision">Décision</MenuItem>
                                    <MenuItem value="Consultation">Consultation</MenuItem>
                                </TextField>
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                                <TextField
                                    label="Note / Décision attendue"
                                    fullWidth
                                    multiline
                                    rows={2}
                                    value={editingItem.decision || ''}
                                    onChange={(e) => setEditingItem({ ...editingItem, decision: e.target.value })}
                                />
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                                <TextField
                                    label="Description détaillée"
                                    fullWidth
                                    multiline
                                    rows={3}
                                    value={editingItem.description || ''}
                                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                                />
                            </Grid>

                            {/* Document Section in Edit Dialog */}
                            <Grid size={{ xs: 12 }}>
                                <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>Documents liés</Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                    Cliquez sur un document pour le prévisualiser.
                                </Typography>
                                {getLinkedDocuments(editingItem.id).length > 0 && (
                                    <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
                                        {getLinkedDocuments(editingItem.id).map(doc => (
                                            <Chip
                                                key={doc.id}
                                                label={doc.name}
                                                icon={<AttachFile />}
                                                variant="outlined"
                                                onClick={() => setPreviewDoc(doc)}
                                                onDelete={() => { /* TODO: Handle unlink/delete */ }}
                                                sx={{ cursor: 'pointer' }}
                                            />
                                        ))}
                                    </Stack>
                                )}
                                {meetingId && (
                                    <DocumentUpload
                                        linkedEntityId={meetingId}
                                        linkedEntityType="meeting"
                                        agendaItemId={editingItem.id}
                                        onUploadComplete={onDocumentUpload}
                                    />
                                )}
                            </Grid>
                        </Grid>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsEditOpen(false)}>Annuler</Button>
                    <Button onClick={handleSaveEdit} variant="contained">Enregistrer</Button>
                </DialogActions>
            </Dialog>

            {/* Document Preview Modal */}
            <DocumentPreviewModal
                open={!!previewDoc}
                onClose={() => setPreviewDoc(null)}
                document={previewDoc}
            />
        </Box>
    );
};

export default AgendaBuilder;
