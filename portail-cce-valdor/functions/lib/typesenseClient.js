"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.typesenseHost = exports.typesenseApiKey = exports.deleteFromIndex = exports.indexRegulation = exports.indexProject = exports.indexMeeting = void 0;
const axios_1 = require("axios");
const params_1 = require("firebase-functions/params");
// Define secrets
const typesenseApiKey = (0, params_1.defineSecret)("TYPESENSE_ADMIN_KEY");
exports.typesenseApiKey = typesenseApiKey;
const typesenseHost = (0, params_1.defineSecret)("TYPESENSE_HOST");
exports.typesenseHost = typesenseHost;
// Helper to get client configuration
const getClient = () => {
    const host = typesenseHost.value();
    const key = typesenseApiKey.value();
    if (!host || !key) {
        throw new Error("Typesense configuration missing (TYPESENSE_HOST or TYPESENSE_ADMIN_KEY)");
    }
    // Clean host
    const cleanHost = host.replace(/^https?:\/\//, "").replace(/:443$/, "").trim();
    return axios_1.default.create({
        baseURL: `https://${cleanHost}`,
        headers: {
            "Content-Type": "application/json",
            "X-TYPESENSE-API-KEY": key
        }
    });
};
const indexMeeting = async (meeting) => {
    try {
        const client = getClient();
        await client.post("/collections/meetings/documents?action=upsert", meeting);
        console.log(`[Typesense] Indexed meeting ${meeting.id}`);
    }
    catch (error) {
        console.error(`[Typesense] Failed to index meeting ${meeting.id}`, error);
    }
};
exports.indexMeeting = indexMeeting;
const indexProject = async (project) => {
    try {
        const client = getClient();
        await client.post("/collections/projects/documents?action=upsert", project);
        console.log(`[Typesense] Indexed project ${project.id}`);
    }
    catch (error) {
        console.error(`[Typesense] Failed to index project ${project.id}`, error);
    }
};
exports.indexProject = indexProject;
const indexRegulation = async (regulation) => {
    try {
        const client = getClient();
        await client.post("/collections/regulations/documents?action=upsert", regulation);
        console.log(`[Typesense] Indexed regulation ${regulation.id}`);
    }
    catch (error) {
        console.error(`[Typesense] Failed to index regulation ${regulation.id}`, error);
    }
};
exports.indexRegulation = indexRegulation;
const deleteFromIndex = async (collection, id) => {
    var _a;
    try {
        const client = getClient();
        await client.delete(`/collections/${collection}/documents/${id}`);
        console.log(`[Typesense] Deleted ${id} from ${collection}`);
    }
    catch (error) {
        // Ignore 404s
        if (axios_1.default.isAxiosError(error) && ((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) === 404) {
            return;
        }
        console.error(`[Typesense] Failed to delete ${id} from ${collection}`, error);
    }
};
exports.deleteFromIndex = deleteFromIndex;
//# sourceMappingURL=typesenseClient.js.map