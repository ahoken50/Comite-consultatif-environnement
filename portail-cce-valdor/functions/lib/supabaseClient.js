"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFromIndex = exports.indexRegulation = exports.indexProject = exports.indexMeeting = exports.supabaseKeyParam = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const params_1 = require("firebase-functions/params");
// Define configuration parameters
const supabaseUrlParam = (0, params_1.defineString)('SUPABASE_URL');
// Export the secret so it can be used in function triggers
exports.supabaseKeyParam = (0, params_1.defineSecret)('SUPABASE_SERVICE_ROLE_KEY');
// Initialize Supabase Client lazily or on demand
// We use a helper to get the client ensures we capture the latest config values
const getSupabase = () => {
    const supabaseUrl = supabaseUrlParam.value();
    const supabaseKey = exports.supabaseKeyParam.value();
    if (!supabaseUrl || !supabaseKey) {
        console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
        console.error(`URL: ${supabaseUrl ? 'Set' : 'Missing'}, Key: ${supabaseKey ? 'Set' : 'Missing'}`);
        throw new Error("Supabase configuration missing");
    }
    return (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
};
// Indexing Functions
const indexMeeting = async (meeting) => {
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
    }
    catch (error) {
        console.error(`[Supabase] Critical failure in logical indexMeeting for ${meeting.id}`, error);
        // Rethrow so Cloud Functions knows it failed
        throw error;
    }
};
exports.indexMeeting = indexMeeting;
const indexProject = async (project) => {
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
        if (error)
            throw error;
        console.log(`[Supabase] Indexed project ${project.id}`);
    }
    catch (error) {
        console.error(`[Supabase] Failed to index project ${project.id}`, error);
    }
};
exports.indexProject = indexProject;
const indexRegulation = async (regulation) => {
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
        if (error)
            throw error;
        console.log(`[Supabase] Indexed regulation ${regulation.id}`);
    }
    catch (error) {
        console.error(`[Supabase] Failed to index regulation ${regulation.id}`, error);
    }
};
exports.indexRegulation = indexRegulation;
const deleteFromIndex = async (table, id) => {
    try {
        const supabase = getSupabase();
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error)
            throw error;
        console.log(`[Supabase] Deleted ${id} from ${table}`);
    }
    catch (error) {
        console.error(`[Supabase] Failed to delete ${id} from ${table}`, error);
    }
};
exports.deleteFromIndex = deleteFromIndex;
//# sourceMappingURL=supabaseClient.js.map