import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Grid,
    MenuItem,
    FormControlLabel,
    Checkbox
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Project, ProjectStatus, Priority, Category } from '../../types/project.types';

const projectSchema = z.object({
    code: z.string().min(1, 'Le code est requis'),
    name: z.string().min(3, 'Le nom doit contenir au moins 3 caractères'),
    category: z.nativeEnum(Category),
    priority: z.nativeEnum(Priority),
    status: z.nativeEnum(ProjectStatus),
    description: z.string().optional(),
    isUrgent: z.boolean().optional(),
});

type ProjectFormData = z.infer<typeof projectSchema>;

interface ProjectFormProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (data: ProjectFormData) => void;
    initialData?: Partial<Project>;
}

const ProjectForm: React.FC<ProjectFormProps> = ({ open, onClose, onSubmit, initialData }) => {
    const { control, handleSubmit, formState: { errors } } = useForm<ProjectFormData>({
        resolver: zodResolver(projectSchema),
        defaultValues: {
            code: initialData?.code || '',
            name: initialData?.name || '',
            category: initialData?.category || Category.WATER,
            priority: initialData?.priority || Priority.MEDIUM,
            status: initialData?.status || ProjectStatus.PENDING,
            description: initialData?.description || '',
            isUrgent: initialData?.isUrgent || false,
        }
    });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>{initialData ? 'Modifier le projet' : 'Nouveau projet'}</DialogTitle>
            <form onSubmit={handleSubmit(onSubmit)}>
                <DialogContent>
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={4}>
                            <Controller
                                name="code"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Code (ex: EC-01)"
                                        fullWidth
                                        error={!!errors.code}
                                        helperText={errors.code?.message}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid item xs={12} sm={8}>
                            <Controller
                                name="name"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Nom du projet"
                                        fullWidth
                                        error={!!errors.name}
                                        helperText={errors.name?.message}
                                    />
                                )}
                            />
                        </Grid>

                        <Grid item xs={12} sm={4}>
                            <Controller
                                name="category"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        select
                                        label="Catégorie"
                                        fullWidth
                                    >
                                        {Object.values(Category).map((option) => (
                                            <MenuItem key={option} value={option}>
                                                {option}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                )}
                            />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <Controller
                                name="priority"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        select
                                        label="Priorité"
                                        fullWidth
                                    >
                                        {Object.values(Priority).map((option) => (
                                            <MenuItem key={option} value={option}>
                                                {option}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                )}
                            />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <Controller
                                name="status"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        select
                                        label="Statut"
                                        fullWidth
                                    >
                                        {Object.values(ProjectStatus).map((option) => (
                                            <MenuItem key={option} value={option}>
                                                {option}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                )}
                            />
                        </Grid>

                        <Grid item xs={12}>
                            <Controller
                                name="description"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Description"
                                        multiline
                                        rows={4}
                                        fullWidth
                                    />
                                )}
                            />
                        </Grid>

                        <Grid item xs={12}>
                            <Controller
                                name="isUrgent"
                                control={control}
                                render={({ field }) => (
                                    <FormControlLabel
                                        control={<Checkbox {...field} checked={field.value} />}
                                        label="Marquer comme URGENT"
                                    />
                                )}
                            />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>Annuler</Button>
                    <Button type="submit" variant="contained">Enregistrer</Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default ProjectForm;
