import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    MenuItem,
    Grid,
    Typography,
    IconButton,
    Box,
    Divider
} from '@mui/material';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Add, Delete, Print, UploadFile } from '@mui/icons-material';
import { MeetingType, MeetingStatus } from '../../types/meeting.types';
import { generateAgendaPDF } from '../../services/pdfServiceAgenda';
import { parseAgendaPDF } from '../../services/pdfParserService';

const agendaItemSchema = z.object({
    title: z.string().min(1, 'Le titre est requis'),
    description: z.string().optional(),
    duration: z.coerce.number().min(1, 'La durée est requise'),
    presenter: z.string().min(1, 'Le responsable est requis'),
    objective: z.string().min(1, 'L\'objectif est requis'),
    decision: z.string().optional(),
});

const meetingSchema = z.object({
    title: z.string().min(1, 'Le titre est requis'),
    date: z.string().min(1, 'La date est requise'),
    location: z.string().min(1, 'Le lieu est requis'),
    type: z.nativeEnum(MeetingType),
    status: z.nativeEnum(MeetingStatus),
    agendaItems: z.array(agendaItemSchema).optional(),
});

type MeetingFormData = z.infer<typeof meetingSchema>;

interface MeetingFormProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (data: MeetingFormData) => void;
    initialData?: Partial<MeetingFormData> & { id?: string };
}

const MeetingForm: React.FC<MeetingFormProps> = ({ open, onClose, onSubmit, initialData }) => {
    const { control, handleSubmit, formState: { errors }, watch, setValue } = useForm<MeetingFormData>({
        resolver: zodResolver(meetingSchema) as any,
        defaultValues: {
            title: initialData?.title || '',
            date: initialData?.date || new Date().toISOString().slice(0, 16),
            location: initialData?.location || 'Salle du conseil',
            type: initialData?.type || MeetingType.REGULAR,
            status: initialData?.status || MeetingStatus.SCHEDULED,
            agendaItems: initialData?.agendaItems || [],
        },
    });

    const { fields, append, remove, replace } = useFieldArray({
        control,
        name: "agendaItems",
    });

    const handlePrint = () => {
        const data = watch();
        // Create a temporary meeting object for the PDF generator
        const meetingForPdf = {
            ...data,
            id: initialData?.id || 'temp',
            attendees: [],
            minutes: '',
            dateCreated: new Date().toISOString(),
            dateUpdated: new Date().toISOString(),
            agendaItems: data.agendaItems?.map((item, index) => ({
                ...item,
                id: `item-${index}`,
                order: index + 1,
                description: item.description || '',
            })) || []
        };
        generateAgendaPDF(meetingForPdf as any);
    };

    const handleImportPDF = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const parsedData = await parseAgendaPDF(file);

            if (parsedData.title) {
                setValue('title', parsedData.title);
            }
            if (parsedData.date) {
                setValue('date', parsedData.date);
            }
            if (parsedData.agendaItems && parsedData.agendaItems.length > 0) {
                const formItems = parsedData.agendaItems.map(item => ({
                    title: item.title,
                    duration: item.duration || 15,
                    presenter: item.presenter || 'Coordonnateur',
                    objective: item.objective || 'Information',
                    decision: item.decision || '',
                    description: item.description || ''
                }));
                replace(formItems);
            }
        } catch (error) {
            console.error('Error parsing PDF:', error);
            alert('Erreur lors de la lecture du PDF.');
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {initialData ? 'Modifier la réunion' : 'Nouvelle réunion'}
                <Box>
                    {!initialData && (
                        <Button
                            component="label"
                            htmlFor="pdf-upload-input"
                            startIcon={<UploadFile />}
                            variant="outlined"
                            size="small"
                            sx={{ mr: 1 }}
                        >
                            Importer PDF
                            <input
                                id="pdf-upload-input"
                                type="file"
                                hidden
                                accept=".pdf"
                                onChange={handleImportPDF}
                            />
                        </Button>
                    )}
                    {initialData && (
                        <Button
                            startIcon={<Print />}
                            onClick={handlePrint}
                            variant="outlined"
                            size="small"
                        >
                            Imprimer l'ODJ
                        </Button>
                    )}
                </Box>
            </DialogTitle>
            <form onSubmit={handleSubmit(onSubmit)}>
                <DialogContent>
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12 }}>
                            <Typography variant="h6" gutterBottom>Informations générales</Typography>
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <Controller
                                name="title"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Titre"
                                        fullWidth
                                        error={!!errors.title}
                                        helperText={errors.title?.message}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <Controller
                                name="date"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Date et heure"
                                        type="datetime-local"
                                        fullWidth
                                        InputLabelProps={{ shrink: true }}
                                        error={!!errors.date}
                                        helperText={errors.date?.message}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <Controller
                                name="location"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Lieu"
                                        fullWidth
                                        error={!!errors.location}
                                        helperText={errors.location?.message}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <Controller
                                name="type"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        select
                                        label="Type"
                                        fullWidth
                                        error={!!errors.type}
                                        helperText={errors.type?.message}
                                    >
                                        {Object.values(MeetingType).map((type) => (
                                            <MenuItem key={type} value={type}>
                                                {type === MeetingType.REGULAR ? 'Régulière' :
                                                    type === MeetingType.SPECIAL ? 'Spéciale' : 'Urgence'}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <Controller
                                name="status"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        select
                                        label="Statut"
                                        fullWidth
                                        error={!!errors.status}
                                        helperText={errors.status?.message}
                                    >
                                        {Object.values(MeetingStatus).map((status) => (
                                            <MenuItem key={status} value={status}>
                                                {status}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Divider sx={{ my: 2 }} />
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                <Typography variant="h6">Ordre du jour</Typography>
                                <Button
                                    startIcon={<Add />}
                                    onClick={() => append({ title: '', duration: 15, presenter: '', objective: 'Information', decision: '' })}
                                    variant="outlined"
                                    size="small"
                                >
                                    Ajouter un point
                                </Button>
                            </Box>
                        </Grid>

                        {fields.map((field, index) => (
                            <React.Fragment key={field.id}>
                                <Grid size={{ xs: 12 }} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="subtitle2" sx={{ width: 24 }}>{index + 1}.</Typography>
                                    <Grid container spacing={2} sx={{ flexGrow: 1 }}>
                                        <Grid size={{ xs: 12, sm: 6 }}>
                                            <Controller
                                                name={`agendaItems.${index}.title`}
                                                control={control}
                                                render={({ field }) => (
                                                    <TextField {...field} label="Sujet" fullWidth size="small" error={!!errors.agendaItems?.[index]?.title} />
                                                )}
                                            />
                                        </Grid>
                                        <Grid size={{ xs: 6, sm: 3 }}>
                                            <Controller
                                                name={`agendaItems.${index}.objective`}
                                                control={control}
                                                render={({ field }) => (
                                                    <TextField {...field} label="Objectif" fullWidth size="small" select>
                                                        <MenuItem value="Information">Information</MenuItem>
                                                        <MenuItem value="Décision">Décision</MenuItem>
                                                        <MenuItem value="Consultation">Consultation</MenuItem>
                                                    </TextField>
                                                )}
                                            />
                                        </Grid>
                                        <Grid size={{ xs: 6, sm: 3 }}>
                                            <Controller
                                                name={`agendaItems.${index}.duration`}
                                                control={control}
                                                render={({ field }) => (
                                                    <TextField {...field} label="Durée (min)" type="number" fullWidth size="small" />
                                                )}
                                            />
                                        </Grid>
                                        <Grid size={{ xs: 12, sm: 6 }}>
                                            <Controller
                                                name={`agendaItems.${index}.presenter`}
                                                control={control}
                                                render={({ field }) => (
                                                    <TextField {...field} label="Responsable" fullWidth size="small" />
                                                )}
                                            />
                                        </Grid>
                                        <Grid size={{ xs: 12, sm: 6 }}>
                                            <Controller
                                                name={`agendaItems.${index}.decision`}
                                                control={control}
                                                render={({ field }) => (
                                                    <TextField {...field} label="Note / Décision attendue" fullWidth size="small" />
                                                )}
                                            />
                                        </Grid>
                                    </Grid>
                                    <IconButton onClick={() => remove(index)} color="error">
                                        <Delete />
                                    </IconButton>
                                </Grid>
                                <Grid size={{ xs: 12 }}>
                                    <Divider />
                                </Grid>
                            </React.Fragment>
                        ))}
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>Annuler</Button>
                    <Button type="submit" variant="contained" color="primary">
                        Enregistrer
                    </Button>
                </DialogActions>
            </form>
        </Dialog >
    );
};

export default MeetingForm;
