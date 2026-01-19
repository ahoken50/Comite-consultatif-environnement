import React, { useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    Grid,
    Button,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    ListItemIcon,
} from '@mui/material';
import {
    Add,
    PictureAsPdf,
    RestartAlt
} from '@mui/icons-material';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { ReportSection, ReportSectionType } from '../../types/report.types';
import { SECTION_TYPES } from '../../types/report.types';

// Simple ID generator since uuid might not be available
const generateId = () => Math.random().toString(36).substring(2, 9);
import ReportSectionCard from './ReportSectionCard';
import SectionConfigModal from './SectionConfigModal';
import { generateCustomReport } from '../../services/reportGenerator';

const ReportBuilder: React.FC = () => {
    const [sections, setSections] = useState<ReportSection[]>([
        { id: '1', type: 'cover', title: 'Rapport Annuel 2024', config: { year: 2024 } },
        { id: '2', type: 'intro', title: 'Mot du Président', config: {} },
        { id: '3', type: 'stats', title: 'Statistiques Globales', config: {} },
        { id: '4', type: 'projects', title: 'Projets Analysés', config: { year: 2024 } }
    ]);

    const [activeId, setActiveId] = useState<string | null>(null);
    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [editingSection, setEditingSection] = useState<ReportSection | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleAddSection = (type: ReportSectionType) => {
        const typeInfo = SECTION_TYPES.find(t => t.type === type);
        const newSection: ReportSection = {
            id: generateId(),
            type,
            title: typeInfo?.defaultTitle || 'Nouvelle Section',
            config: {}
        };
        setSections([...sections, newSection]);
    };

    const handleRemoveSection = (id: string) => {
        setSections(sections.filter(s => s.id !== id));
    };

    const handleEditSection = (section: ReportSection) => {
        setEditingSection(section);
        setConfigModalOpen(true);
    };

    const handleSaveConfig = (updatedSection: ReportSection) => {
        setSections(sections.map(s => s.id === updatedSection.id ? updatedSection : s));
        setConfigModalOpen(false);
        setEditingSection(null);
    };

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (active.id !== over?.id) {
            setSections((items) => {
                const oldIndex = items.findIndex((item) => item.id === active.id);
                const newIndex = items.findIndex((item) => item.id === over?.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
        setActiveId(null);
    };

    const handleGeneratePDF = async () => {
        // TODO: Implement generation logic
        await generateCustomReport(sections);
    };

    return (
        <Box sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
                <Typography variant="h4">Générateur de Rapports Personnalisés</Typography>
                <Box>
                    <Button
                        variant="outlined"
                        startIcon={<RestartAlt />}
                        sx={{ mr: 1 }}
                        onClick={() => setSections([])}
                    >
                        Réinitialiser
                    </Button>
                    <Button
                        variant="contained"
                        color="primary"
                        startIcon={<PictureAsPdf />}
                        onClick={handleGeneratePDF}
                    >
                        Générer PDF
                    </Button>
                </Box>
            </Box>

            <Grid container spacing={3}>
                {/* Sidebar - Toolbox */}
                <Grid size={{ xs: 12, md: 3 }}>
                    <Paper sx={{ p: 2 }}>
                        <Typography variant="h6" gutterBottom>Modules Disponibles</Typography>
                        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                            Cliquez pour ajouter une section au rapport.
                        </Typography>
                        <List component="nav">
                            {SECTION_TYPES.map((item) => (
                                <ListItem
                                    key={item.type}
                                    disablePadding
                                    sx={{ mb: 1 }}
                                >
                                    <ListItemButton
                                        onClick={() => handleAddSection(item.type)}
                                        sx={{
                                            border: '1px solid #e0e0e0',
                                            borderRadius: 1,
                                            '&:hover': { bgcolor: 'action.hover' }
                                        }}
                                    >
                                        <ListItemIcon><Add /></ListItemIcon>
                                        <ListItemText primary={item.label} />
                                    </ListItemButton>
                                </ListItem>
                            ))}
                        </List>
                    </Paper>
                </Grid>

                {/* Canvas - Report Structure */}
                <Grid size={{ xs: 12, md: 9 }}>
                    <Paper
                        sx={{
                            p: 4,
                            minHeight: '600px',
                            bgcolor: '#f5f5f5',
                            border: '2px dashed #e0e0e0'
                        }}
                    >
                        <Box sx={{ maxWidth: '800px', mx: 'auto' }}>
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragStart={handleDragStart}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={sections.map(s => s.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    {sections.map((section, index) => (
                                        <ReportSectionCard
                                            key={section.id}
                                            section={section}
                                            index={index}
                                            onRemove={() => handleRemoveSection(section.id)}
                                            onEdit={() => handleEditSection(section)}
                                        />
                                    ))}
                                </SortableContext>
                                <DragOverlay>
                                    {activeId ? (
                                        <ReportSectionCard
                                            section={sections.find(s => s.id === activeId)!}
                                            index={0}
                                            isOverlay
                                        />
                                    ) : null}
                                </DragOverlay>
                            </DndContext>

                            {sections.length === 0 && (
                                <Box sx={{ textAlign: 'center', mt: 10, color: 'text.secondary' }}>
                                    <Typography variant="h6">Le rapport est vide</Typography>
                                    <Typography>Ajoutez des sections depuis la barre latérale.</Typography>
                                </Box>
                            )}
                        </Box>
                    </Paper>
                </Grid>
            </Grid>

            {/* Configuration Modal */}
            {editingSection && (
                <SectionConfigModal
                    open={configModalOpen}
                    section={editingSection}
                    onClose={() => setConfigModalOpen(false)}
                    onSave={handleSaveConfig}
                />
            )}
        </Box>
    );
};

export default ReportBuilder;
