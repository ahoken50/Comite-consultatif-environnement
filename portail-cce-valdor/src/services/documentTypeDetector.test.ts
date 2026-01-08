import { describe, it, expect } from 'vitest';
import {
    detectDocumentType,
    detectTypeFromFileName,
    getDocumentTypeLabel,
    getDocumentTypeIcon
} from './documentTypeDetector';

describe('documentTypeDetector', () => {
    describe('detectDocumentType', () => {
        it('should detect agenda documents', () => {
            const content = `ORDRE DU JOUR
            Comité Consultatif en Environnement
            Convocation à l'assemblée régulière
            
            1. Ouverture de la séance
            2. Approbation de l'ordre du jour
            3. Varia
            4. Levée de la séance`;

            const result = detectDocumentType(content);
            expect(result.type).toBe('agenda');
            expect(result.confidence).toBeGreaterThan(20);
            expect(result.matches).toContain('ordre du jour');
        });

        it('should detect minutes (procès-verbal) documents', () => {
            const content = `PROCÈS-VERBAL
            Réunion du 15 janvier 2024
            
            Membres présents: M. Dupont, Mme Martin
            
            RÉSOLUTION 24-01
            Proposé par M. Dupont
            Appuyé par Mme Martin
            Il est résolu d'approuver le procès-verbal.
            Adopté à l'unanimité.`;

            const result = detectDocumentType(content);
            expect(result.type).toBe('minutes');
            expect(result.confidence).toBeGreaterThan(30);
            expect(result.matches).toEqual(expect.arrayContaining(['procès-verbal']));
        });

        it('should detect resolution documents', () => {
            const content = `RÉSOLUTION CCE-2024-15
            
            CONSIDÉRANT que le comité a étudié le dossier;
            ATTENDU que les citoyens ont été consultés;
            
            IL EST RÉSOLU de recommander au conseil municipal...
            
            Proposé par: M. Martin
            Appuyé par: Mme Dupont`;

            const result = detectDocumentType(content);
            expect(result.type).toBe('resolution');
            expect(result.confidence).toBeGreaterThan(30);
        });

        it('should detect report documents', () => {
            const content = `RAPPORT ANNUEL 2024
            Comité Consultatif en Environnement
            
            Bilan des activités
            Statistiques et données
            
            Recommandations pour l'année suivante
            Conclusions et perspectives`;

            const result = detectDocumentType(content);
            expect(result.type).toBe('report');
            expect(result.confidence).toBeGreaterThan(20);
        });

        it('should detect correspondence documents', () => {
            const content = `Lettre officielle
            
            De: Direction de l'environnement
            À: Comité Consultatif en Environnement
            Objet: Demande de consultation
            
            Madame, Monsieur,
            
            Nous vous prions de bien vouloir...
            
            Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.`;

            const result = detectDocumentType(content);
            expect(result.type).toBe('correspondence');
            expect(result.confidence).toBeGreaterThan(20);
        });

        it('should return unknown for unrecognized documents', () => {
            const content = `Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`;

            const result = detectDocumentType(content);
            expect(result.type).toBe('unknown');
            expect(result.confidence).toBeLessThan(20);
        });

        it('should extract date from content', () => {
            const content = `PROCÈS-VERBAL
            Réunion tenue le 15 janvier 2024`;

            const result = detectDocumentType(content);
            expect(result.suggestedDate).toBe('2024-01-15');
        });

        it('should handle various date formats', () => {
            const content = `Assemblée du 3 mars 2025`;
            const result = detectDocumentType(content);
            expect(result.suggestedDate).toBe('2025-03-03');
        });

        it('should extract meeting reference', () => {
            const content = `Assemblée régulière du CCE`;
            const result = detectDocumentType(content);
            expect(result.suggestedMeeting).toBe('Assemblée régulière');
        });

        it('should handle special meeting types', () => {
            const content = `Réunion extraordinaire - Urgence environnementale`;
            const result = detectDocumentType(content);
            expect(result.suggestedMeeting).toBe('Réunion extraordinaire');
        });
    });

    describe('detectTypeFromFileName', () => {
        it('should detect agenda from filename', () => {
            expect(detectTypeFromFileName('ODJ_2024-01-15.docx').type).toBe('agenda');
            expect(detectTypeFromFileName('ordre_du_jour.pdf').type).toBe('agenda');
        });

        it('should detect minutes from filename', () => {
            expect(detectTypeFromFileName('PV_reunion_janvier.docx').type).toBe('minutes');
            expect(detectTypeFromFileName('proces-verbal-2024.pdf').type).toBe('minutes');
        });

        it('should detect resolution from filename', () => {
            expect(detectTypeFromFileName('Resolution_CCE-2024-15.pdf').type).toBe('resolution');
            expect(detectTypeFromFileName('CCE-2024-30.docx').type).toBe('resolution');
        });

        it('should detect report from filename', () => {
            expect(detectTypeFromFileName('Rapport_annuel_2024.pdf').type).toBe('report');
            expect(detectTypeFromFileName('bilan_activites.docx').type).toBe('report');
        });

        it('should return unknown for unrecognized filenames', () => {
            expect(detectTypeFromFileName('document.pdf').type).toBe('unknown');
            expect(detectTypeFromFileName('notes.docx').type).toBe('unknown');
        });
    });

    describe('getDocumentTypeLabel', () => {
        it('should return French labels for all types', () => {
            expect(getDocumentTypeLabel('agenda')).toBe('Ordre du jour');
            expect(getDocumentTypeLabel('minutes')).toBe('Procès-verbal');
            expect(getDocumentTypeLabel('resolution')).toBe('Résolution');
            expect(getDocumentTypeLabel('report')).toBe('Rapport');
            expect(getDocumentTypeLabel('correspondence')).toBe('Correspondance');
            expect(getDocumentTypeLabel('unknown')).toBe('Document');
        });
    });

    describe('getDocumentTypeIcon', () => {
        it('should return icon names for all types', () => {
            expect(getDocumentTypeIcon('agenda')).toBe('EventNote');
            expect(getDocumentTypeIcon('minutes')).toBe('Description');
            expect(getDocumentTypeIcon('resolution')).toBe('Gavel');
            expect(getDocumentTypeIcon('report')).toBe('Assessment');
            expect(getDocumentTypeIcon('correspondence')).toBe('Mail');
            expect(getDocumentTypeIcon('unknown')).toBe('InsertDriveFile');
        });
    });
});
