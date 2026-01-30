// Mock mammoth
import * as mammoth from 'mammoth';
import { vi, describe, it, expect } from 'vitest';

vi.mock('mammoth', () => ({
    default: {
        convertToHtml: vi.fn(),
        extractRawText: vi.fn()
    }
}));

import { matchPVToAgenda, parseAgendaDOCX } from '../services/docxParserService';
import type { AgendaItem } from '../types/meeting.types';

describe('docxParserService', () => {
    describe('parseAgendaDOCX (Block Splitting)', () => {
        it('should split embedded resolution from paragraph content', async () => {
            // Mock HTML return
            // @ts-ignore
            (mammoth.default.convertToHtml as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `<p>Texte introductif. RÉSOLUTION 24-05 Il est résolu de... Fin.</p>`,
                messages: []
            });

            const mockFile = new File([''], 'test.docx', { type: 'application/docx' });
            // Mock arrayBuffer for the file
            mockFile.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));

            const result = await parseAgendaDOCX(mockFile);

            // We expect logic to have identified this. 
            // Currently parseAgendaDOCX returns structured AgendaItems.
            // We check if it extracted the resolution properly.

            // The splitter logic should produce:
            // 1. "Texte introductif." (Content)
            // 2. "RÉSOLUTION 24-05" (Resolution)
            // 3. "Il est résolu de... Fin." (Content -> likely joined to resolution content)

            // The AgendaItems mapper should pickup the resolution
            const itemWithRes = result.agendaItems?.find(i => i.minuteEntries?.some(e => e.number === '05' || e.number === '24-05'));
            expect(itemWithRes).toBeDefined();
            expect(itemWithRes?.minuteEntries![0].type).toBe('resolution');
        });

        it('should handle multiple embedded items', async () => {
            // @ts-ignore
            (mammoth.default.convertToHtml as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `<h1>Point 3</h1>
                        <p>Discussion... COMMENTAIRE 3-A Question... RÉSOLUTION 3-01 Décision.</p>`,
                messages: []
            });

            const mockFile = new File([''], 'test2.docx');
            mockFile.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));

            const result = await parseAgendaDOCX(mockFile);

            const item = result.agendaItems?.find(i => i.title === 'Point 3');
            expect(item).toBeDefined();
            expect(item!.minuteEntries).toHaveLength(2);
            // Verify order (Comment then Resolution)
            expect(item!.minuteEntries![0].type).toBe('comment');
            expect(item!.minuteEntries![1].type).toBe('resolution');
        });
    });

    describe('matchPVToAgenda', () => {
        it('should match exact titles', () => {
            const pvItems: AgendaItem[] = [{ id: '1', title: 'Ouverture', minuteEntries: [], order: 1, duration: 0, presenter: '', objective: '', description: '' }];
            const agendaItems: AgendaItem[] = [{ id: 'a1', title: 'Ouverture', minuteEntries: [], order: 1, duration: 0, presenter: '', objective: '', description: '' }];

            const result = matchPVToAgenda(pvItems, agendaItems);
            expect(result.size).toBe(1);
            expect(result.get('a1')).toBe(pvItems[0]);
        });

        it('should match similar titles with minor differences (case, punctuation)', () => {
            const pvItems: AgendaItem[] = [{ id: '1', title: '3.1. Approbation du PV', minuteEntries: [], order: 1, duration: 0, presenter: '', objective: '', description: '' }];
            const agendaItems: AgendaItem[] = [{ id: 'a1', title: '3.1 Approbation du P.V.', minuteEntries: [], order: 1, duration: 0, presenter: '', objective: '', description: '' }];

            const result = matchPVToAgenda(pvItems, agendaItems);
            expect(result.size).toBe(1);
            expect(result.get('a1')).toBe(pvItems[0]);
        });

        it('should match titles that contain each other', () => {
            const pvItems: AgendaItem[] = [{ id: '1', title: '4.1 Dossier XYZ', minuteEntries: [], order: 1, duration: 0, presenter: '', objective: '', description: '' }];
            const agendaItems: AgendaItem[] = [{ id: 'a1', title: '4.1 Étude du Dossier XYZ', minuteEntries: [], order: 1, duration: 0, presenter: '', objective: '', description: '' }];

            const result = matchPVToAgenda(pvItems, agendaItems);
            expect(result.size).toBe(1);
            expect(result.get('a1')).toBe(pvItems[0]);
        });

        it('should match based on word overlap ratio', () => {
            const pvItems: AgendaItem[] = [{ id: '1', title: 'Demande de dérogation mineure 123 Main St', minuteEntries: [], order: 1, duration: 0, presenter: '', objective: '', description: '' }];
            const agendaItems: AgendaItem[] = [{ id: 'a1', title: 'Dérogation 123 Main St - Analyse', minuteEntries: [], order: 1, duration: 0, presenter: '', objective: '', description: '' }];

            const result = matchPVToAgenda(pvItems, agendaItems);
            expect(result.size).toBe(1);
            expect(result.get('a1')).toBe(pvItems[0]);
        });

        it('should not match completely different titles', () => {
            const pvItems: AgendaItem[] = [{ id: '1', title: 'Varia', minuteEntries: [], order: 1, duration: 0, presenter: '', objective: '', description: '' }];
            const agendaItems: AgendaItem[] = [{ id: 'a1', title: 'Ouverture', minuteEntries: [], order: 1, duration: 0, presenter: '', objective: '', description: '' }];

            const result = matchPVToAgenda(pvItems, agendaItems);
            expect(result.size).toBe(0);
        });
    });
});
