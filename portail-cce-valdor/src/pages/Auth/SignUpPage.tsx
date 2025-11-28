import React, { useState } from 'react';
import { Box, Button, Card, CardContent, TextField, Typography, Alert, Link, InputAdornment, IconButton } from '@mui/material';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../../services/firebase';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { Visibility, VisibilityOff, Email, Lock, Person } from '@mui/icons-material';
import logo from '../../assets/logo-valdor.png';

const SignUpPage: React.FC = () => {
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password !== confirmPassword) {
            setError("Les mots de passe ne correspondent pas.");
            return;
        }

        setLoading(true);
        try {
            // 1. Create Authentication User
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Check if this is the first user in the 'users' collection
            const usersRef = collection(db, 'users');
            const snapshot = await getDocs(usersRef);
            const isFirstUser = snapshot.empty;

            const role = isFirstUser ? 'admin' : 'user';

            // 3. Create User Document in Firestore
            await setDoc(doc(db, 'users', user.uid), {
                uid: user.uid,
                email: user.email,
                displayName: fullName,
                role: role,
                createdAt: new Date().toISOString()
            });

            navigate('/dashboard');
        } catch (err: any) {
            console.error(err);
            if (err.code === 'auth/email-already-in-use') {
                setError("Cette adresse courriel est déjà utilisée.");
            } else if (err.code === 'auth/weak-password') {
                setError("Le mot de passe doit contenir au moins 6 caractères.");
            } else {
                setError("Une erreur est survenue lors de l'inscription.");
            }
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
                alt="Background"
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
                        Créer un compte
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'grey.600', fontWeight: 500, mb: 4, textAlign: 'center' }}>
                        Portail CCE Val-d'Or
                    </Typography>

                    {error && <Alert severity="error" sx={{ width: '100%', mb: 3 }}>{error}</Alert>}

                    <form onSubmit={handleSignup} style={{ width: '100%' }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'grey.800', ml: 0.5, mb: 0.5, display: 'block' }}>
                                    Nom complet
                                </Typography>
                                <TextField
                                    fullWidth
                                    placeholder="Jean Tremblay"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    required
                                    autoComplete="name"
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <Person sx={{ color: 'grey.500' }} />
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
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'grey.800', ml: 0.5, mb: 0.5, display: 'block' }}>
                                    Adresse courriel
                                </Typography>
                                <TextField
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
                                            '&.Mui-focused fieldset': { borderColor: '#059669', borderWidth: 2 },
                                        }
                                    }}
                                />
                            </Box>

                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'grey.800', ml: 0.5, mb: 0.5, display: 'block' }}>
                                    Mot de passe
                                </Typography>
                                <TextField
                                    type={showPassword ? "text" : "password"}
                                    fullWidth
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="new-password"
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <Lock sx={{ color: 'grey.500' }} />
                                            </InputAdornment>
                                        ),
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
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

                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'grey.800', ml: 0.5, mb: 0.5, display: 'block' }}>
                                    Confirmer le mot de passe
                                </Typography>
                                <TextField
                                    type={showPassword ? "text" : "password"}
                                    fullWidth
                                    placeholder="••••••••"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    autoComplete="new-password"
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <Lock sx={{ color: 'grey.500' }} />
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
                                {loading ? 'Création en cours...' : "S'inscrire"}
                            </Button>

                            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                                <Typography variant="body2" sx={{ color: 'grey.600' }}>
                                    Déjà un compte?{' '}
                                    <Link component={RouterLink} to="/login" sx={{ color: '#D32F2F', fontWeight: 600, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                        Se connecter
                                    </Link>
                                </Typography>
                            </Box>
                        </Box>
                    </form>
                </CardContent>
            </Card>
        </Box>
    );
};

export default SignUpPage;
