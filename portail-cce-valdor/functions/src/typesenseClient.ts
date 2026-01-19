import axios from "axios";
import { defineSecret } from "firebase-functions/params";

// Define secrets
const typesenseApiKey = defineSecret("TYPESENSE_ADMIN_KEY");
const typesenseHost = defineSecret("TYPESENSE_HOST");

// Interfaces matching the frontend ones
interface SearchableMeeting {
    id: string;
    title: string;
    date: string;
    dateTimestamp: number;
    type: string;
    status: string;
    minutes: string;
    agendaItemTitles: string[];
    resolutions: string[];
    attendeeNames: string[];
    embedding?: number[];
}

interface SearchableProject {
    id: string;
    code: string;
    name: string;
    description: string;
    category: string;
    status: string;
    priority: string;
    notes: string;
}

interface SearchableRegulation {
    id: string;
    title: string;
    content: string;
    category: string;
    year: number;
    status: string;
    embedding?: number[];
}

// Helper to get client configuration
const getClient = () => {
    const host = typesenseHost.value();
    const key = typesenseApiKey.value();

    if (!host || !key) {
        throw new Error("Typesense configuration missing (TYPESENSE_HOST or TYPESENSE_ADMIN_KEY)");
    }

    // Clean host
    const cleanHost = host.replace(/^https?:\/\//, "").replace(/:443$/, "").trim();

    return axios.create({
        baseURL: `https://${cleanHost}`,
        headers: {
            "Content-Type": "application/json",
            "X-TYPESENSE-API-KEY": key
        }
    });
};

export const indexMeeting = async (meeting: SearchableMeeting) => {
    try {
        const client = getClient();
        await client.post("/collections/meetings/documents?action=upsert", meeting);
        console.log(`[Typesense] Indexed meeting ${meeting.id}`);
    } catch (error) {
        console.error(`[Typesense] Failed to index meeting ${meeting.id}`, error);
    }
};

export const indexProject = async (project: SearchableProject) => {
    try {
        const client = getClient();
        await client.post("/collections/projects/documents?action=upsert", project);
        console.log(`[Typesense] Indexed project ${project.id}`);
    } catch (error) {
        console.error(`[Typesense] Failed to index project ${project.id}`, error);
    }
};

export const indexRegulation = async (regulation: SearchableRegulation) => {
    try {
        const client = getClient();
        await client.post("/collections/regulations/documents?action=upsert", regulation);
        console.log(`[Typesense] Indexed regulation ${regulation.id}`);
    } catch (error) {
        console.error(`[Typesense] Failed to index regulation ${regulation.id}`, error);
    }
};

export const deleteFromIndex = async (collection: string, id: string) => {
    try {
        const client = getClient();
        await client.delete(`/collections/${collection}/documents/${id}`);
        console.log(`[Typesense] Deleted ${id} from ${collection}`);
    } catch (error) {
        // Ignore 404s
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            return;
        }
        console.error(`[Typesense] Failed to delete ${id} from ${collection}`, error);
    }
};

export { typesenseApiKey, typesenseHost, SearchableMeeting, SearchableProject, SearchableRegulation };
