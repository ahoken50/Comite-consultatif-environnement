import { describe, it, expect } from 'vitest';
import { parseMinutesDraft } from '../services/minutesParserService';

describe('minutesParserService', () => {
    describe('parseMinutesDraft', () => {
        it('should correctly parse the introduction text', () => {
            const draft = `Notes préliminaires:
La séance commence à 19h.
Présences: Tous présents.

1. Ouverture`;

            const { intro, items } = parseMinutesDraft(draft);
            expect(intro).toContain('Notes préliminaires:');
            expect(intro).toContain('La séance commence à 19h.');
            expect(items).toHaveLength(1); // "1. Ouverture" IS a valid item section
        });

        it('should parse a simple item with resolution', () => {
            const draft = `Introduction text...

3.1 Approbation du PV
RÉSOLUTION 24-100
Il est résolu d'approuver le PV.`;

            const { items, intro } = parseMinutesDraft(draft);
            expect(intro).toContain('Introduction text...');
            expect(items).toHaveLength(1);
            expect(items[0].title).toBe('3.1 Approbation du PV');
            expect(items[0].minuteEntries).toHaveLength(1);
            expect(items[0].minuteEntries[0].type).toBe('resolution');
            expect(items[0].minuteEntries[0].number).toBe('24-100');
            expect(items[0].minuteEntries[0].content).toContain("Il est résolu d'approuver le PV.");
        });

        it('should parse a simple item with comment', () => {
            const draft = `4.1 Suivi dossier
COMMENTAIRE 24-A
Ceci est un commentaire de suivi.`;

            const { items } = parseMinutesDraft(draft);
            expect(items).toHaveLength(1);
            expect(items[0].minuteEntries).toHaveLength(1);
            expect(items[0].minuteEntries[0].type).toBe('comment');
            expect(items[0].minuteEntries[0].number).toBe('24-A');
            expect(items[0].minuteEntries[0].content).toBe('Ceci est un commentaire de suivi.');
        });

        it('should handle nested subtitles as content of the parent item', () => {
            const draft = `4. Revue des dossiers
4.1 Dossier A
COMMENTAIRE 24-B
Texte sur le dossier A.

4.2 Dossier B
RÉSOLUTION 24-101
Texte dossier B.`;

            // Logic check:
            // "4. Revue des dossiers" -> Section 1
            // "4.1 Dossier A" -> isSubTitle check against "4. Revue des dossiers"? 
            // "4.1" starts with "4." (normalized from valid regex match 1).
            // Actually, let's verify regex logic in service. 
            // numberedTitleRegex = /^(\d+([.-]\d+)*)[.)-]?\s+(.+)$/;
            // "4.1 Dossier A" matches.
            // But loop logic check says:
            // "2. Check for Comment Start" -> no.
            // "3. Identifiers for New Section" -> YES, it matches.
            // BUT, wait. My fix regarding sub-titles was inside the Resolution/Comment reading loop (while loop).
            // Here, "4.1 Dossier A" is a top-level line. 

            // If the AI output structure is:
            // 4. Section Title
            // COMMENTAIRE XX
            // 4.1 Subtitle (as text inside comment?) -> No, usually sub-items are separate items in Agenda.

            // Re-reading service logic:
            // The isSubTitle check is ONLY inside the `while` loop when reading resolution/comment text.
            // So if "4.1 ..." appears INSIDE a comment block, it is treated as text.
            // If it appears at top level, it starts a new section (Agenda Item).

            // Let's test the specific fix: "4.1" inside a comment block of "4."
            const complexDraft = `4. Revue
COMMENTAIRE 24-C
Voici le texte.
4.1 Sous-point interne
Suite du commentaire.`;

            const { items: complexItems } = parseMinutesDraft(complexDraft);
            expect(complexItems).toHaveLength(1);
            expect(complexItems[0].title).toBe('4. Revue');
            expect(complexItems[0].minuteEntries[0].content).toContain('4.1 Sous-point interne');
            expect(complexItems[0].minuteEntries[0].content).toContain('Suite du commentaire.');
        });

        it('should handle multiple entries in one item', () => {
            const draft = `5. Varia
RÉSOLUTION 24-105
Décision 1.

COMMENTAIRE 24-D
Commentaire sur autre point.`;

            const { items } = parseMinutesDraft(draft);
            expect(items).toHaveLength(1);
            expect(items[0].minuteEntries).toHaveLength(2);
            expect(items[0].minuteEntries[0].type).toBe('resolution');
            expect(items[0].minuteEntries[1].type).toBe('comment');
        });
    });
});
