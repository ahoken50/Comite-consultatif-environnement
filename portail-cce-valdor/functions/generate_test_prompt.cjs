async function main() {
    try {
        const id = "CPqyaR5w4xFAf5YapJWb";
        const res = await fetch(`https://firestore.googleapis.com/v1/projects/comite-cce/databases/(default)/documents/meetings/${id}`);
        const doc = await res.json();
        
        const fields = doc.fields || {};
        
        // Mock meeting object
        const meeting = {
            id,
            title: fields.title?.stringValue || '',
            date: fields.date?.timestampValue || '',
            type: fields.type?.stringValue || '',
            minutes: fields.minutes?.stringValue || '',
            agendaItems: []
        };
        
        if (fields.agendaItems && fields.agendaItems.arrayValue && fields.agendaItems.arrayValue.values) {
            meeting.agendaItems = fields.agendaItems.arrayValue.values.map(val => {
                const item = val.mapValue?.fields || {};
                const mEntries = item.minuteEntries?.arrayValue?.values || [];
                
                return {
                    id: item.id?.stringValue || '',
                    title: item.title?.stringValue || '',
                    objective: item.objective?.stringValue || '',
                    decision: item.decision?.stringValue || '',
                    minuteEntries: mEntries.map(eVal => {
                        const entry = eVal.mapValue?.fields || {};
                        return {
                            type: entry.type?.stringValue || '',
                            number: entry.number?.stringValue || '',
                            content: entry.content?.stringValue || ''
                        };
                    })
                };
            });
        }
        
        // Formatting logic from GeminiProvider.ts
        const agendaItemsFormatted = (meeting.agendaItems || []).map((item, index) => {
            let itemText = `### Point ${index + 1}: ${item.title}\n`;
            itemText += `- Objectif: ${item.objective || 'Non spécifié'}\n`;
            if (item.decision) itemText += `- Décision: ${item.decision}\n`;
            if (item.minuteEntries && item.minuteEntries.length > 0) {
                itemText += `- Résolutions/Commentaires:\n`;
                item.minuteEntries.forEach(entry => {
                    const prefix = entry.type === 'resolution' ? '📋 Résolution' : '💬 Commentaire';
                    itemText += `  - ${prefix} ${entry.number || ''}: ${entry.content}\n`;
                });
            }
            return itemText;
        }).join('\n');

        // Reading modified prompt template
        const fs = require('fs');
        const path = require('path');
        const promptTemplate = fs.readFileSync(path.join(__dirname, '../src/prompts/action-items.md'), 'utf8');
        
        const prompt = promptTemplate
            .replace('{{meetingTitle}}', meeting.title)
            .replace('{{meetingDate}}', meeting.date)
            .replace('{{meetingType}}', meeting.type)
            .replace('{{generalNotes}}', meeting.minutes || 'Aucune note générale')
            .replace('{{agendaItems}}', agendaItemsFormatted || 'Aucun point à l\'ordre du jour');
            
        console.log("==================================================");
        console.log("GENERATED PROMPT FOR GEMINI:");
        console.log("==================================================");
        console.log(prompt);
        console.log("==================================================");
        
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
