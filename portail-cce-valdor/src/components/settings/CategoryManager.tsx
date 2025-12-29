import {
    Box,
    Typography,
    TextField,
    Button,
    Chip
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSettings, addCategory, deleteCategory } from '../../features/settings/settingsSlice';
import type { AppDispatch } from '../../store/store';
import type { RootState } from '../../store/rootReducer';

const CategoryManager: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { categories } = useSelector((state: RootState) => state.settings);
    const [newCategory, setNewCategory] = useState('');

    useEffect(() => {
        dispatch(fetchSettings());
    }, [dispatch]);

    const handleAdd = async () => {
        if (newCategory.trim() && !categories.includes(newCategory.trim())) {
            await dispatch(addCategory(newCategory.trim()));
            setNewCategory('');
        }
    };

    const handleDelete = async (category: string) => {
        if (window.confirm(`Supprimer la catégorie "${category}" ?`)) {
            await dispatch(deleteCategory(category));
        }
    };

    return (
        <Box>
            <Typography variant="h6" gutterBottom>Catégories de Projets</Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
                Gérez les catégories disponibles pour les projets. Ces catégories apparaissent dans les filtres et lors de la création de nouveaux projets.
            </Typography>

            <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                <TextField
                    label="Nouvelle catégorie"
                    size="small"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                />
                <Button variant="contained" startIcon={<Add />} onClick={handleAdd} disabled={!newCategory.trim()}>
                    Ajouter
                </Button>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {categories.map((category) => (
                    <Chip
                        key={category}
                        label={category}
                        onDelete={() => handleDelete(category)}
                        color="primary"
                        variant="outlined"
                    />
                ))}
            </Box>
        </Box>
    );
};

export default CategoryManager;
