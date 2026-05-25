import React from 'react';
import { Card, CardHeader, CardContent, Typography } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface ProgressData {
    name: string;
    completed: number;
    new: number;
}

interface ProgressChartProps {
    data: ProgressData[];
}

const ProgressChart: React.FC<ProgressChartProps> = ({ data }) => {
    const hasData = data.some(d => d.completed > 0 || d.new > 0);
    const [isMounted, setIsMounted] = React.useState(false);

    React.useEffect(() => {
        setIsMounted(true);
    }, []);

    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader title="Progression mensuelle" sx={{ borderBottom: 1, borderColor: 'divider' }} />
            <CardContent>
                <div style={{ width: '100%', height: 300 }}>
                    {hasData ? (
                        isMounted ? (
                            <ResponsiveContainer width="99%" height={300}>
                            <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                                <YAxis axisLine={false} tickLine={false} />
                                <Tooltip />
                                <Legend />
                                <Line
                                    type="monotone"
                                    dataKey="completed"
                                    name="Réalisés"
                                    stroke="#059669"
                                    strokeWidth={2}
                                    dot={{ r: 4 }}
                                    activeDot={{ r: 6 }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="new"
                                    name="Nouveaux"
                                    stroke="#2563eb"
                                    strokeWidth={2}
                                    dot={{ r: 4 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                        ) : null
                    ) : (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            flexDirection: 'column',
                            gap: 8
                        }}>
                            <Typography variant="body2" color="text.secondary">
                                Aucune activité sur les 6 derniers mois
                            </Typography>
                            <Typography variant="caption" color="text.disabled">
                                Les données apparaîtront lorsque des projets seront créés
                            </Typography>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default ProgressChart;
