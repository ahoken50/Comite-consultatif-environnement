
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import path from 'path';

// Mock worker since we are in node
// We might not need worker for basic text extraction in Node with legacy build

const files = [
    'c:\\Users\\rossm\\Documents\\Comite CCE\\Comite-consultatif-environnement\\PV\\CCE - PROCÈS-VERBAL 7.pdf',
    'c:\\Users\\rossm\\Documents\\Comite CCE\\Comite-consultatif-environnement\\PV\\CCE - PROCÈS-VERBAL 4.pdf'
];

async function analyze() {
    for (const filePath of files) {
        console.log(`\n\n=== ANALYZING: ${path.basename(filePath)} ===`);
        try {
            const buffer = fs.readFileSync(filePath);
            const data = new Uint8Array(buffer);

            const loadingTask = pdfjsLib.getDocument({ data });
            const pdf = await loadingTask.promise;

            console.log(`Pages: ${pdf.numPages}`);

            let fullText = '';

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();

                // Simulate how we join text in the app
                const pageText = textContent.items.map((item) => item.str).join(' ');
                fullText += pageText + '\n\n';

                // Also print raw items to see if we can detect structure (like headers based on font height?? pdfjs is tricky)
                // For now just raw text
            }

            console.log('--- EXTRACTED TEXT START ---');
            console.log(fullText.substring(0, 3000));
            console.log('--- EXTRACTED TEXT END ---');

        } catch (e) {
            console.error(`Error processing ${filePath}:`, e);
        }
    }
}

analyze();
