import React from 'react';
import { Card, CardHeader, CardContent } from '@mui/material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const data: Array<{ name: string; completed: number; new: number }> = [];

const ProgressChart: React.FC = () => {
    return (
        <Card sx={{ height: '100%' }}>
            <CardHeader title="Progression mensuelle" sx={{ borderBottom: 1, borderColor: 'divider' }} />
            <CardContent>
                <div style={{ height: 300, width: '100%', minHeight: 300, minWidth: 0 }}>
                    {data.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                                <YAxis axisLine={false} tickLine={false} />
                                <Tooltip />
                                <Legend />
                                <Line type="monotone" dataKey="completed" name="Réalisés" stroke="#059669" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                                <Line type="monotone" dataKey="new" name="Nouveaux" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>
                            Aucune donnée disponible
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default ProgressChart;
