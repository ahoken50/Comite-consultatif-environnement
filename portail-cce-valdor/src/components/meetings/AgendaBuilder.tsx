import React from 'react';
import {
    Box,
    Typography,
    IconButton,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Button
} from '@mui/material';
import { DragIndicator, Add, Delete } from '@mui/icons-material';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AgendaItem } from '../../types/meeting.types';

interface AgendaBuilderProps {
    items: AgendaItem[];
    onItemsChange: (items: AgendaItem[]) => void;
}

const SortableItem = ({ item, onDelete }: { item: AgendaItem; onDelete: (id: string) => void }) => {
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
                <IconButton edge="end" aria-label="delete" onClick={() => onDelete(item.id)}>
                    <Delete />
                </IconButton>
            }
            sx={{ bgcolor: 'background.paper', mb: 1, borderRadius: 1, boxShadow: 1 }}
        >
            <ListItemIcon {...attributes} {...listeners} sx={{ cursor: 'grab' }}>
                <DragIndicator />
            </ListItemIcon>
            <ListItemText
                primary={item.title}
                secondary={`${item.duration} min - ${item.presenter}`}
            />
        </ListItem>
    );
};

const AgendaBuilder: React.FC<AgendaBuilderProps> = ({ items, onItemsChange }) => {
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
        };
        onItemsChange([...items, newItem]);
    };

    const handleDeleteItem = (id: string) => {
        onItemsChange(items.filter(item => item.id !== id));
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
                            <SortableItem key={item.id} item={item} onDelete={handleDeleteItem} />
                        ))}
                    </List>
                </SortableContext>
            </DndContext>
        </Box>
    );
};

export default AgendaBuilder;
