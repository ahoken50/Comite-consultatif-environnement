import { createClient } from '@supabase/supabase-js';
import { defineString, defineSecret } from 'firebase-functions/params';

// Define configuration parameters
const supabaseUrlParam = defineString('SUPABASE_URL');
// Export the secret so it can be used in function triggers
export const supabaseKeyParam = defineSecret('SUPABASE_SERVICE_ROLE_KEY');

// Initialize Supabase Client lazily or on demand
// We use a helper to get the client ensures we capture the latest config values
const getSupabase = () => {
    const supabaseUrl = supabaseUrlParam.value();
    const supabaseKey = supabaseKeyParam.value();

    if (!supabaseUrl || !supabaseKey) {
        console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
        console.error(`URL: ${supabaseUrl ? 'Set' : 'Missing'}, Key: ${supabaseKey ? 'Set' : 'Missing'}`);
        throw new Error("Supabase configuration missing");
    }

    return createClient(supabaseUrl, supabaseKey);
};

// Interfaces matching the SQL tables
export interface SearchableMeeting {
    id: string;
    title: string;
    date: string;
    dateTimestamp: number;
    type: string;
    status: string;
    minutes: string; // Full content
    agendaItemTitles: string[];
    resolutions: string[];
    attendeeNames: string[];
    embedding?: number[];
}

export interface SearchableProject {
    id: string;
    code: string;
    name: string;
    description: string;
    category: string;
    status: string;
    priority: string;
    notes: string;
    embedding?: number[];
}

export interface SearchableRegulation {
    id: string;
    title: string;
    content: string;
    category: string;
    year: number;
    status: string;
    embedding?: number[];
}

// Indexing Functions

export const indexMeeting = async (meeting: SearchableMeeting) => {
    try {
        const supabase = getSupabase();
        // Map camelCase (TS) to snake_case (SQL) if needed, or just insert as is if columns match
        // Our SQL used snake_case for arrays: agenda_item_titles, attendee_names
        const row = {
            id: meeting.id,
            title: meeting.title,
            date: meeting.date,
            date_timestamp: meeting.dateTimestamp,
            type: meeting.type,
            status: meeting.status,
            minutes: meeting.minutes,
            agenda_item_titles: meeting.agendaItemTitles,
            resolutions: meeting.resolutions,
            attendee_names: meeting.attendeeNames,
            embedding: meeting.embedding
        };

        const { error } = await supabase.from('meetings').upsert(row);
        if (error) {
            console.error(`[Supabase Error] Upsert failed for meeting ${meeting.id}:`, JSON.stringify(error));
            throw error;
        }
        console.log(`[Supabase] Successfully indexed meeting ${meeting.id}`);
    } catch (error) {
        console.error(`[Supabase] Critical failure in logical indexMeeting for ${meeting.id}`, error);
        // Rethrow so Cloud Functions knows it failed
        throw error;
    }
};

export const indexProject = async (project: SearchableProject) => {
    try {
        const supabase = getSupabase();
        const row = {
            id: project.id,
            code: project.code,
            name: project.name,
            description: project.description,
            category: project.category,
            status: project.status,
            priority: project.priority,
            notes: project.notes,
            embedding: project.embedding
        };

        const { error } = await supabase.from('projects').upsert(row);
        if (error) throw error;
        console.log(`[Supabase] Indexed project ${project.id}`);
    } catch (error) {
        console.error(`[Supabase] Failed to index project ${project.id}`, error);
    }
};

export const indexRegulation = async (regulation: SearchableRegulation) => {
    try {
        const supabase = getSupabase();
        const row = {
            id: regulation.id,
            title: regulation.title,
            content: regulation.content,
            category: regulation.category,
            year: regulation.year,
            status: regulation.status,
            embedding: regulation.embedding
        };

        const { error } = await supabase.from('regulations').upsert(row);
        if (error) throw error;
        console.log(`[Supabase] Indexed regulation ${regulation.id}`);
    } catch (error) {
        console.error(`[Supabase] Failed to index regulation ${regulation.id}`, error);
    }
};

export const deleteFromIndex = async (table: 'meetings' | 'projects' | 'regulations', id: string) => {
    try {
        const supabase = getSupabase();
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) throw error;
        console.log(`[Supabase] Deleted ${id} from ${table}`);
    } catch (error) {
        console.error(`[Supabase] Failed to delete ${id} from ${table}`, error);
    }
};
