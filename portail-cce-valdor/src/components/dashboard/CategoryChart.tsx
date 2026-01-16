import React from 'react';
import { Card, CardHeader, CardContent, Typography } from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface CategoryData {
    name: string;
    value: number;
    color: string;
    [key: string]: string | number; // Index signature for Recharts compatibility
}

interface CategoryChartProps {
    data: CategoryData[];
}

const CategoryChart: React.FC<CategoryChartProps> = ({ data }) => {
    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader title="Répartition par catégorie" sx={{ borderBottom: 1, borderColor: 'divider' }} />
            <CardContent>
                <div style={{ width: '100%', height: 300 }}>
                    {data.length > 0 ? (
                        <ResponsiveContainer width="99%" height="100%">
                            <PieChart>
                                <Pie
                                    data={data}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                    label={({ name, value }) => `${name}: ${value}`}
                                >
                                    {data.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
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
                                Aucun projet à afficher
                            </Typography>
                            <Typography variant="caption" color="text.disabled">
                                Créez des projets pour voir la répartition
                            </Typography>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default CategoryChart;
