import React, { useState } from 'react';
import { Box, Button, Card, CardContent, TextField, Typography, Alert, InputAdornment, IconButton, Link, CircularProgress } from '@mui/material';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { Email, Lock, Visibility, VisibilityOff } from '@mui/icons-material';
import logo from '../../assets/logo-valdor.png';

const LoginPage: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
            navigate('/dashboard');
        } catch (err: any) {
            setError('Échec de la connexion. Vérifiez vos identifiants.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{
            position: 'relative',
            minHeight: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            bgcolor: 'grey.900',
            overflow: 'hidden'
        }}>
            {/* Background Image */}
            <Box
                component="img"
                src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=2560&auto=format&fit=crop"
                alt=""
                sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    opacity: 0.9,
                    pointerEvents: 'none'
                }}
            />
            {/* Overlay */}
            <Box sx={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent, rgba(0,0,0,0.1))',
                pointerEvents: 'none'
            }} />

            <Card sx={{
                position: 'relative',
                zIndex: 10,
                maxWidth: 480,
                width: '100%',
                mx: 2,
                borderRadius: 3,
                boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
                overflow: 'hidden'
            }}>
                <CardContent sx={{ px: { xs: 4, md: 6 }, py: { xs: 5, md: 6 }, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

                    <Box sx={{ mb: 4, transform: 'scale(1.1)' }}>
                        <img src={logo} alt="Ville de Val-d'Or" style={{ height: 60 }} />
                    </Box>

                    <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', color: 'grey.900', mb: 1, textAlign: 'center' }}>
                        Connexion
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'grey.600', fontWeight: 500, mb: 4, textAlign: 'center' }}>
                        Portail CCE Val-d'Or
                    </Typography>

                    {error && <Alert severity="error" sx={{ width: '100%', mb: 3 }}>{error}</Alert>}

                    <form onSubmit={handleLogin} style={{ width: '100%' }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

                            <Box>
                                <Typography component="label" htmlFor="email" variant="caption" sx={{ fontWeight: 600, color: 'grey.800', ml: 0.5, mb: 0.5, display: 'block' }}>
                                    Adresse courriel
                                </Typography>
                                <TextField
                                    id="email"
                                    type="email"
                                    fullWidth
                                    placeholder="exemple@ville.valdor.qc.ca"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoComplete="email"
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <Email sx={{ color: 'grey.500' }} />
                                            </InputAdornment>
                                        ),
                                    }}
                                    sx={{
                                        '& .MuiOutlinedInput-root': {
                                            borderRadius: 2,
                                            bgcolor: 'white',
                                            '& fieldset': { borderColor: 'grey.400' },
                                            '&:hover fieldset': { borderColor: 'grey.500' },
                                            '&.Mui-focused fieldset': { borderColor: '#059669', borderWidth: 2 }, // Emerald 600
                                        }
                                    }}
                                />
                            </Box>

                            <Box>
                                <Typography component="label" htmlFor="password" variant="caption" sx={{ fontWeight: 600, color: 'grey.800', ml: 0.5, mb: 0.5, display: 'block' }}>
                                    Mot de passe
                                </Typography>
                                <TextField
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    fullWidth
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <Lock sx={{ color: 'grey.500' }} />
                                            </InputAdornment>
                                        ),
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
                                                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    edge="end"
                                                >
                                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                                </IconButton>
                                            </InputAdornment>
                                        )
                                    }}
                                    sx={{
                                        '& .MuiOutlinedInput-root': {
                                            borderRadius: 2,
                                            bgcolor: 'white',
                                            '& fieldset': { borderColor: 'grey.400' },
                                            '&:hover fieldset': { borderColor: 'grey.500' },
                                            '&.Mui-focused fieldset': { borderColor: '#059669', borderWidth: 2 },
                                        }
                                    }}
                                />
                            </Box>

                            <Button
                                type="submit"
                                variant="contained"
                                fullWidth
                                disabled={loading}
                                startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
                                sx={{
                                    mt: 2,
                                    py: 1.5,
                                    bgcolor: '#D32F2F', // Red 700
                                    '&:hover': { bgcolor: '#B71C1C' }, // Red 900
                                    borderRadius: 2,
                                    fontWeight: 'bold',
                                    textTransform: 'none',
                                    fontSize: '1rem',
                                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                                }}
                            >
                                {loading ? 'Connexion en cours...' : 'Se connecter'}
                            </Button>

                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                                <Link href="#" sx={{ color: '#D32F2F', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                    Mot de passe oublié?
                                </Link>
                                <Link component={RouterLink} to="/signup" sx={{ color: '#D32F2F', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                    Créer un compte
                                </Link>
                            </Box>
                        </Box>
                    </form>
                </CardContent>
            </Card>

            {/* Footer */}
            <Box sx={{
                position: 'absolute',
                bottom: 24,
                left: 0,
                right: 0,
                zIndex: 20,
                display: 'flex',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '0.875rem'
            }}>
                <Typography variant="body2" sx={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
                    © 2024 Ville de Val-d'Or. Tous droits réservés.
                </Typography>
            </Box>
        </Box>
    );
};

export default LoginPage;
