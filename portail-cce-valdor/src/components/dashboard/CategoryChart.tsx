import React from 'react';
import { Card, CardHeader, CardContent, Box } from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const data: Array<{ name: string; value: number; color: string }> = [];

const CategoryChart: React.FC = () => {
    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader title="Répartition par catégorie" sx={{ borderBottom: 1, borderColor: 'divider' }} />
            <CardContent>
                <Box sx={{ height: 300, width: '100%', minHeight: 300, minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
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
