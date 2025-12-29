import React, { useMemo } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Paper } from '@mui/material';
import type { Project } from '../../types/project.types';
import type { Meeting } from '../../types/meeting.types';
import { useNavigate } from 'react-router-dom';

const locales = {
    'fr': fr,
};

const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
});

interface ProjectCalendarProps {
    projects: Project[];
    meetings: Meeting[];
}

interface CalendarEvent {
    id: string;
    title: string;
    start: Date;
    end: Date;
    type: 'project_deadline' | 'meeting';
    resource: Project | Meeting;
}

const ProjectCalendar: React.FC<ProjectCalendarProps> = ({ projects, meetings }) => {
    const navigate = useNavigate();

    const events = useMemo(() => {
        const projectEvents: CalendarEvent[] = projects
            .filter(p => p.estimatedCompletionDate)
            .map(p => ({
                id: p.id,
                title: `Échéance: ${p.name}`,
                start: new Date(p.estimatedCompletionDate!),
                end: new Date(p.estimatedCompletionDate!),
                type: 'project_deadline',
                resource: p
            }));

        const meetingEvents: CalendarEvent[] = meetings.map(m => {
            const startDate = new Date(m.date);
            // Default duration 2h if not parsed (assuming logic exists elsewhere, simplified here)
            const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

            return {
                id: m.id,
                title: `Réunion: ${m.title}`,
                start: startDate,
                end: endDate,
                type: 'meeting',
                resource: m
            };
        });

        return [...projectEvents, ...meetingEvents];
    }, [projects, meetings]);

    const handleSelectEvent = (event: CalendarEvent) => {
        if (event.type === 'project_deadline') {
            navigate(`/projects/${event.id}`);
        } else {
            navigate(`/meetings/${event.id}`);
        }
    };

    const eventStyleGetter = (event: CalendarEvent) => {
        let backgroundColor = '#3174ad';
        if (event.type === 'project_deadline') {
            backgroundColor = '#ed6c02'; // Orange for deadlines
        } else {
            backgroundColor = '#2e7d32'; // Green for meetings
        }

        return {
            style: {
                backgroundColor,
                borderRadius: '4px',
                opacity: 0.8,
                color: 'white',
                border: '0px',
                display: 'block'
            }
        };
    };

    return (
        <Paper sx={{ p: 2, height: 700 }}>
            <Calendar
                localizer={localizer}
                events={events}
                startAccessor="start"
                endAccessor="end"
                style={{ height: '100%' }}
                culture='fr'
                messages={{
                    next: "Suivant",
                    previous: "Précédent",
                    today: "Aujourd'hui",
                    month: "Mois",
                    week: "Semaine",
                    day: "Jour",
                    agenda: "Agenda",
                    date: "Date",
                    time: "Heure",
                    event: "Événement",
                    noEventsInRange: "Aucun événement dans cette période.",
                }}
                onSelectEvent={handleSelectEvent}
                eventPropGetter={eventStyleGetter}
                views={['month', 'week', 'agenda']}
                defaultView='month'
            />
        </Paper>
    );
};

export default ProjectCalendar;
