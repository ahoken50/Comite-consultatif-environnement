/**
 * Utility functions for robust JSON parsing and recovery of AI generated content.
 */

/**
 * Scans a string and extracts all balanced { ... } substrings, handling nested braces and string literals.
 */
export function extractAllJSONObjects(text: string): string[] {
    const candidates: string[] = [];
    let index = -1;
    while ((index = text.indexOf('{', index + 1)) !== -1) {
        let braceCount = 0;
        let inString = false;
        let escape = false;
        for (let i = index; i < text.length; i++) {
            const char = text[i];
            if (escape) { escape = false; continue; }
            if (char === '\\') { escape = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            
            if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        candidates.push(text.substring(index, i + 1));
                        break;
                    }
                }
            }
        }
    }
    return candidates;
}

/**
 * Parses projects list robustly from Gemini/Claude raw output string.
 * Handles missing commas, semicolons, extra characters, and truncated outputs.
 */
export function extractProjectsRobust(text: string): any[] {
    let cleaned = text.trim();
    
    // Remove markdown code block wrappers if present
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    
    // 1. Try standard JSON parse first with basic array comma repair
    try {
        const basicRepair = cleaned.replace(/\}\s*\{/g, '},{');
        const parsed = JSON.parse(basicRepair);
        if (parsed && Array.isArray(parsed.projects)) {
            return parsed.projects;
        }
        if (Array.isArray(parsed)) {
            return parsed;
        }
    } catch (e) {
        // Standard parse failed, fallback to candidate recovery
    }
    
    // 2. Extact all candidate brace-balanced objects
    const candidates = extractAllJSONObjects(cleaned);
    const projects: any[] = [];
    const seenNames = new Set<string>();
    
    // 3. Try to locate the outer projects wrapper first
    for (const cand of candidates) {
        try {
            const parsed = JSON.parse(cand);
            if (parsed && Array.isArray(parsed.projects)) {
                return parsed.projects;
            }
        } catch (e) {}
    }
    
    // 4. Extract individual project-like objects
    for (const cand of candidates) {
        try {
            const parsed = JSON.parse(cand);
            // A project must have at least a name and some details
            if (parsed && parsed.name && (parsed.description || parsed.category || parsed.priority)) {
                if (!seenNames.has(parsed.name)) {
                    seenNames.add(parsed.name);
                    projects.push(parsed);
                }
            }
        } catch (e) {
            // Try repairing properties comma if it failed (e.g. missing commas between properties)
            try {
                const repaired = cand.replace(/("[\s\S]*?"|\d+|true|false|null)\s+("([^"]+)"\s*:)/g, '$1,$2');
                const parsedObj = JSON.parse(repaired);
                if (parsedObj && parsedObj.name && (parsedObj.description || parsedObj.category || parsedObj.priority)) {
                    if (!seenNames.has(parsedObj.name)) {
                        seenNames.add(parsedObj.name);
                        projects.push(parsedObj);
                    }
                }
            } catch (innerErr) {}
        }
    }
    
    return projects;
}
