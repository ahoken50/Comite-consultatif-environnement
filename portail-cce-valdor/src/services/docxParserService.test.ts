import { describe, it, expect } from 'vitest';
import { matchPVToAgenda } from '../services/docxParserService';
import type { AgendaItem } from '../types/meeting.types';

describe('docxParserService', () => {
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
