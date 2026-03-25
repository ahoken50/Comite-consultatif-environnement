import React, { useEffect } from 'react';
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
import type { Project } from '../../types/project.types';
import type { Member as TeamMember } from '../../types/member.types';
import { ProjectStatus, Priority, Category } from '../../types/project.types';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSettings } from '../../features/settings/settingsSlice';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';

const projectSchema = z.object({
    code: z.string().min(1, 'Le code est requis'),
    name: z.string().min(1, 'Le nom est requis'),
    status: z.nativeEnum(ProjectStatus),
    priority: z.nativeEnum(Priority),
    category: z.string().min(1, 'La catégorie est requise'),
    coordinatorId: z.string().min(1, 'Le responsable est requis'),
    description: z.string().optional(),
    currentDetails: z.string().optional(),
    nextSteps: z.string().optional(),
    startDate: z.string().optional(),
    isUrgent: z.boolean(),
});

type ProjectFormData = z.infer<typeof projectSchema>;

interface ProjectFormProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (data: ProjectFormData) => void;
    initialData?: Partial<Project>;
    members?: TeamMember[]; // Using imported Member type aliased as TeamMember
}

const ProjectForm: React.FC<ProjectFormProps> = ({ open, onClose, onSubmit, initialData, members = [] }) => {
    const dispatch = useDispatch<AppDispatch>();
    const { categories } = useSelector((state: RootState) => state.settings);

    useEffect(() => {
        dispatch(fetchSettings());
    }, [dispatch]);

    const { control, handleSubmit, formState: { errors } } = useForm<ProjectFormData>({
        resolver: zodResolver(projectSchema),
        defaultValues: {
            code: initialData?.code || '',
            name: initialData?.name || '',
            status: initialData?.status || ProjectStatus.PENDING,
            priority: initialData?.priority || Priority.MEDIUM,
            category: initialData?.category || '',
            coordinatorId: initialData?.coordinatorId || '',
            description: initialData?.description || '',
            startDate: initialData?.startDate || '',
            currentDetails: initialData?.currentDetails || '',
            nextSteps: initialData?.nextSteps || '',
            isUrgent: initialData?.isUrgent || false,
        }
    });

    const formId = React.useId();

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>{initialData ? 'Modifier le projet' : 'Nouveau projet'}</DialogTitle>
            <form onSubmit={handleSubmit(onSubmit as any)}>
                <DialogContent>
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, sm: 4 }}>
                            <Controller
                                name="code"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${formId}-code`}
                                        label="Code (ex: EC-01)"
                                        fullWidth
                                        error={!!errors.code}
                                        helperText={errors.code?.message}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 8 }}>
                            <Controller
                                name="name"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${formId}-name`}
                                        label="Nom du projet"
                                        fullWidth
                                        error={!!errors.name}
                                        helperText={errors.name?.message}
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Controller
                                name="coordinatorId"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${formId}-coordinatorId`}
                                        select
                                        label="Responsable du projet"
                                        fullWidth
                                        error={!!errors.coordinatorId}
                                        helperText={errors.coordinatorId?.message || "Sélectionnez la personne en charge de ce projet."}
                                    >
                                        <MenuItem value="">
                                            <em>Non assigné</em>
                                        </MenuItem>
                                        {members.map((member) => (
                                            <MenuItem key={member.id} value={member.id}>
                                                {member.displayName || member.email}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 4 }}>
                            <Controller
                                name="category"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${formId}-category`}
                                        select
                                        label="Catégorie"
                                        fullWidth
                                        error={!!errors.category}
                                        helperText={errors.category?.message}
                                    >
                                        {categories && categories.length > 0 ? (
                                            categories.map((cat) => (
                                                <MenuItem key={cat} value={cat}>
                                                    {cat}
                                                </MenuItem>
                                            ))
                                        ) : (
                                            Object.values(Category).map((option) => (
                                                <MenuItem key={option} value={option}>
                                                    {option}
                                                </MenuItem>
                                            ))
                                        )}
                                    </TextField>
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                            <Controller
                                name="priority"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${formId}-priority`}
                                        select
                                        label="Priorité"
                                        fullWidth
                                    >
                                        {Object.values(Priority).map((option) => (
                                            <MenuItem key={option} value={option}>
                                                {option === Priority.LOW ? 'Basse' :
                                                    option === Priority.MEDIUM ? 'Moyenne' :
                                                        option === Priority.HIGH ? 'Élevée' :
                                                            option === Priority.CRITICAL ? 'Critique' : option}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                            <Controller
                                name="status"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${formId}-status`}
                                        select
                                        label="Statut"
                                        fullWidth
                                    >
                                        {Object.values(ProjectStatus).map((option) => (
                                            <MenuItem key={option} value={option}>
                                                {option === ProjectStatus.PENDING ? 'En attente' :
                                                    option === ProjectStatus.IN_PROGRESS ? 'En cours' :
                                                        option === ProjectStatus.BLOCKED ? 'Bloqué' :
                                                            option === ProjectStatus.COMPLETED ? 'Terminé' :
                                                                option === ProjectStatus.FINANCING_RECEIVED ? 'Financement reçu' :
                                                                    option === ProjectStatus.TO_CLARIFY ? 'À clarifier' : option}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <Controller
                                name="description"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${formId}-description`}
                                        label="Description du projet"
                                        fullWidth
                                        multiline
                                        rows={3}
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                            <Controller
                                name="startDate"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${formId}-startDate`}
                                        label="Date de début"
                                        type="date"
                                        fullWidth
                                        InputLabelProps={{ shrink: true }}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            {/* Placeholder for Estimated Completion Date if needed to be moved here */}
                        </Grid>

                        <Grid size={{ xs: 12, md: 6 }}>
                            <Controller
                                name="currentDetails"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${formId}-currentDetails`}
                                        label="Détails actuels"
                                        fullWidth
                                        multiline
                                        rows={3}
                                    />
                                )}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Controller
                                name="nextSteps"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${formId}-nextSteps`}
                                        label="Prochaines étapes"
                                        multiline
                                        rows={3}
                                        fullWidth
                                        placeholder="Quelles sont les prochaines actions ?"
                                    />
                                )}
                            />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                            <Controller
                                name="isUrgent"
                                control={control}
                                render={({ field }) => (
                                    <FormControlLabel
                                        control={<Checkbox {...field} checked={field.value} id={`${formId}-isUrgent`} />}
                                        label="Marquer comme URGENT"
                                    />
                                )}
                            />
                        </Grid>
                    </Grid >
                </DialogContent >
                <DialogActions>
                    <Button onClick={onClose}>Annuler</Button>
                    <Button type="submit" variant="contained">Enregistrer</Button>
                </DialogActions>
            </form >
        </Dialog >
    );
};

export default ProjectForm;
