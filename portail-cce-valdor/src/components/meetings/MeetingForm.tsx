import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    MenuItem,
    Grid
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MeetingType, MeetingStatus } from '../../types/meeting.types';

const meetingSchema = z.object({
    title: z.string().min(1, 'Le titre est requis'),
    date: z.string().min(1, 'La date est requise'),
    location: z.string().min(1, 'Le lieu est requis'),
    type: z.nativeEnum(MeetingType),
    status: z.nativeEnum(MeetingStatus),
});

type MeetingFormData = z.infer<typeof meetingSchema>;

interface MeetingFormProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (data: MeetingFormData) => void;
    initialData?: Partial<MeetingFormData>;
}

const MeetingForm: React.FC<MeetingFormProps> = ({ open, onClose, onSubmit, initialData }) => {
    const { control, handleSubmit, formState: { errors } } = useForm<MeetingFormData>({
        resolver: zodResolver(meetingSchema),
        defaultValues: {
            title: initialData?.title || '',
            date: initialData?.date || new Date().toISOString().slice(0, 16),
            location: initialData?.location || 'Salle du conseil',
            type: initialData?.type || MeetingType.REGULAR,
            status: initialData?.status || MeetingStatus.SCHEDULED,
        },
    });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{initialData ? 'Modifier la réunion' : 'Nouvelle réunion'}</DialogTitle>
            <form onSubmit={handleSubmit(onSubmit)}>
                <DialogContent>
                    <Grid container spacing={2}>
                        <Grid item xs={12}>
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
                        <Grid item xs={12} sm={6}>
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
                        <Grid item xs={12} sm={6}>
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
                        <Grid item xs={12} sm={6}>
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
                        <Grid item xs={12} sm={6}>
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
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>Annuler</Button>
                    <Button type="submit" variant="contained" color="primary">
                        Enregistrer
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default MeetingForm;
