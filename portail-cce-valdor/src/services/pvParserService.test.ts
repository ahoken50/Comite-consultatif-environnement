import { describe, it, expect, vi } from 'vitest';

// Mock the dependencies
vi.mock('./ocrService', () => ({
    extractTextFromPDF: vi.fn()
}));

vi.mock('mammoth', () => ({
    default: {
        extractRawText: vi.fn()
    }
}));

// Helper to create mock file with arrayBuffer
const createMockFile = (content: string, name: string = 'test.docx', type: string = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') => {
    const file = new File([content], name, { type });
    // Mock arrayBuffer since jsdom/vitest might not implement it fully on the File prototype for created instances
    file.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    return file;
};

// We need to test the parseRawTextToPV logic indirectly or export it
// For now, let's test the exported functions with mocked dependencies

describe('pvParserService', () => {
    describe('parseRawTextToPV (via exports)', () => {
        // Since parseRawTextToPV is not exported, we test it through the DOCX parser
        // which uses it internally. We'll mock mammoth to provide test content.

        it('should parse basic agenda items from raw text', async () => {
            // Import after mock
            const mammoth = await import('mammoth');
            const { parseMinutesDOCX } = await import('./pvParserService');

            // Mock mammoth to return our test text
            (mammoth.default.extractRawText as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `1. Ouverture de la séance
                RÉSOLUTION 24-01
                Il est proposé d'ouvrir la séance.
                
                2. Approbation de l'ordre du jour
                RÉSOLUTION 24-02
                L'ordre du jour est approuvé.
                Proposé par M. Dupont
                Appuyé par Mme Martin`
            });

            const mockFile = createMockFile('', 'test.docx');
            const result = await parseMinutesDOCX(mockFile);

            expect(result.agendaItems).toHaveLength(2);
            expect(result.agendaItems[0].title).toBe('Ouverture de la séance');
            expect(result.agendaItems[1].title).toBe("Approbation de l'ordre du jour");
        });

        it('should extract resolution numbers', async () => {
            const mammoth = await import('mammoth');
            const { parseMinutesDOCX } = await import('./pvParserService');

            (mammoth.default.extractRawText as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `3. Point important
                RÉSOLUTION 24-15
                CONSIDÉRANT que le comité a délibéré;
                IL EST RÉSOLU de procéder.`
            });

            const mockFile = createMockFile('', 'test.docx');
            const result = await parseMinutesDOCX(mockFile);

            expect(result.agendaItems).toHaveLength(1);
            expect(result.agendaItems[0].minuteEntries).toHaveLength(1);
            expect(result.agendaItems[0].minuteEntries![0].type).toBe('resolution');
            expect(result.agendaItems[0].minuteEntries![0].number).toBe('24-15');
        });

        it('should extract proposer and seconder', async () => {
            const mammoth = await import('mammoth');
            const { parseMinutesDOCX } = await import('./pvParserService');

            (mammoth.default.extractRawText as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `4. Dossier environnemental
                RÉSOLUTION 24-20
                Il est résolu d'approuver.
                Proposé par Jean Dupont
                Appuyé par Marie Martin`
            });

            const mockFile = createMockFile('', 'test.docx');
            const result = await parseMinutesDOCX(mockFile);

            expect(result.agendaItems[0].proposer).toBe('Jean Dupont');
            expect(result.agendaItems[0].seconder).toBe('Marie Martin');
        });

        it('should handle "Levée de l\'assemblée" as special item', async () => {
            const mammoth = await import('mammoth');
            const { parseMinutesDOCX } = await import('./pvParserService');

            (mammoth.default.extractRawText as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `1. Ouverture
                RÉSOLUTION 24-01
                Ouverture à 17h.
                
                Levée de l'assemblée
                RÉSOLUTION 24-99
                La séance est levée à 19h.`
            });

            const mockFile = createMockFile('', 'test.docx');
            const result = await parseMinutesDOCX(mockFile);

            expect(result.agendaItems).toHaveLength(2);
            expect(result.agendaItems[1].title).toContain('Levée');
        });

        it('should handle multiple resolutions in one item', async () => {
            const mammoth = await import('mammoth');
            const { parseMinutesDOCX } = await import('./pvParserService');

            (mammoth.default.extractRawText as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `5. Dossiers multiples
                RÉSOLUTION 24-30
                Première décision.
                RÉSOLUTION 24-31
                Deuxième décision.`
            });

            const mockFile = createMockFile('', 'test.docx');
            const result = await parseMinutesDOCX(mockFile);

            expect(result.agendaItems).toHaveLength(1);
            expect(result.agendaItems[0].minuteEntries).toHaveLength(2);
            expect(result.agendaItems[0].minuteEntries![0].number).toBe('24-30');
            expect(result.agendaItems[0].minuteEntries![1].number).toBe('24-31');
        });

        it('should ignore date-like lines as agenda items', async () => {
            const mammoth = await import('mammoth');
            const { parseMinutesDOCX } = await import('./pvParserService');

            (mammoth.default.extractRawText as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `15 janvier 2024
                Salle de conférence
                
                1. Ouverture
                Discussion générale.`
            });

            const mockFile = createMockFile('', 'test.docx');
            const result = await parseMinutesDOCX(mockFile);

            expect(result.agendaItems).toHaveLength(1);
            expect(result.agendaItems[0].title).toBe('Ouverture');
        });

        it('should handle nested numbering (4.1, 4.2)', async () => {
            const mammoth = await import('mammoth');
            const { parseMinutesDOCX } = await import('./pvParserService');

            (mammoth.default.extractRawText as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `4.1 Premier sous-point
                Contenu du premier sous-point.
                
                4.2 Deuxième sous-point
                Contenu du deuxième sous-point.`
            });

            const mockFile = createMockFile('', 'test.docx');
            const result = await parseMinutesDOCX(mockFile);

            expect(result.agendaItems).toHaveLength(2);
            expect(result.agendaItems[0].title).toBe('Premier sous-point');
            expect(result.agendaItems[1].title).toBe('Deuxième sous-point');
        });
    });

    describe('New Robust Regex Patterns', () => {
        it('should handle bullet points before Resolution/Comment', async () => {
            const mammoth = await import('mammoth');
            const { parseMinutesDOCX } = await import('./pvParserService');

            (mammoth.default.extractRawText as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `6. Affaires nouvelles
                • RÉSOLUTION 24-40
                Décision prise.
                - COMMENTAIRE 24-A
                Discussion sur le point.`
            });

            const mockFile = createMockFile('', 'test.docx');
            const result = await parseMinutesDOCX(mockFile);

            expect(result.agendaItems).toHaveLength(1);
            expect(result.agendaItems[0].minuteEntries).toHaveLength(2);
            expect(result.agendaItems[0].minuteEntries![0].number).toBe('24-40');
            expect(result.agendaItems[0].minuteEntries![1].type).toBe('comment');
            expect(result.agendaItems[0].minuteEntries![1].number).toBe('24-A');
        });

        it('should handle weird spacing in numbers (PDF artifacts)', async () => {
            const mammoth = await import('mammoth');
            const { parseMinutesDOCX } = await import('./pvParserService');

            // The parser has a pre-cleaning step for this
            (mammoth.default.extractRawText as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `7. Artifacts
                RÉSOLUTION 2 4 - 4 1
                Texte.`
            });

            const mockFile = createMockFile('', 'test.docx');
            const result = await parseMinutesDOCX(mockFile);

            expect(result.agendaItems[0].minuteEntries![0].number).toBe('24-41');
        });

        it('should be case insensitive', async () => {
            const mammoth = await import('mammoth');
            const { parseMinutesDOCX } = await import('./pvParserService');

            (mammoth.default.extractRawText as ReturnType<typeof vi.fn>).mockResolvedValue({
                value: `8. Case Test
                résolution 24-50
                Texte min.
                commentaire 24-b
                Texte maj.`
            });

            const mockFile = createMockFile('', 'test.docx');
            const result = await parseMinutesDOCX(mockFile);

            expect(result.agendaItems[0].minuteEntries![0].number).toBe('24-50');
            expect(result.agendaItems[0].minuteEntries![1].number).toBe('24-B');
        });
    });
});
