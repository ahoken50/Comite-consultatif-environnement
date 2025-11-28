import React from 'react';
import { Card, CardHeader, CardContent, Box } from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const data = [
    { name: 'Eau', value: 8, color: '#0288D1' },
    { name: 'Biodiversité', value: 5, color: '#2E7D32' },
    { name: 'Matières résiduelles', value: 6, color: '#F57C00' },
    { name: 'Réglementation', value: 4, color: '#7B1FA2' },
];

const CategoryChart: React.FC = () => {
    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader title="Répartition par catégorie" sx={{ borderBottom: 1, borderColor: 'divider' }} />
            <CardContent>
                <Box sx={{ height: 300, width: '100%' }}>
                    <ResponsiveContainer>
                        <PieChart>
                            <Pie
                                data={data}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip />
                            <Legend verticalAlign="bottom" height={36} />
                        </PieChart>
                    </ResponsiveContainer>
                </Box>
            </CardContent>
        </Card>
    );
};

export default CategoryChart;
