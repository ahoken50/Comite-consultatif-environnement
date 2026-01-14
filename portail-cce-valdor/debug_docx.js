
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';

const files = [
    'c:\\Users\\rossm\\Documents\\Comite CCE\\Comite-consultatif-environnement\\PV\\CCE - PROCÈS-VERBAL 4.docx',
    'c:\\Users\\rossm\\Documents\\Comite CCE\\Comite-consultatif-environnement\\PV\\CCE - PROCÈS-VERBAL 6.docx',
    'c:\\Users\\rossm\\Documents\\Comite CCE\\Comite-consultatif-environnement\\PV\\CCE - PROCÈS-VERBAL 9.docx'
];

async function analyze() {
    for (const filePath of files) {
        console.log(`\n\n=== ANALYZING: ${path.basename(filePath)} ===`);
        try {
            const buffer = fs.readFileSync(filePath);

            // Extract Raw Text
            const textResult = await mammoth.extractRawText({ buffer });
            console.log('--- RAW TEXT START ---');
            console.log(textResult.value.substring(0, 2000)); // Print first 2000 chars
            console.log('--- RAW TEXT END ---');

            // Extract HTML to see structure (bolding, headers)
            const htmlResult = await mammoth.convertToHtml({ buffer });
            console.log('--- HTML STRUCTURE START ---');
            // Simplified HTML: replace simple tags to see structure better
            const simplified = htmlResult.value
                .replace(/<p>/g, '\n<p>')
                .replace(/<strong>/g, '[BOLD]')
                .replace(/<\/strong>/g, '[/BOLD]')
                .replace(/<h1>/g, '\n[H1]')
                .replace(/<\/h1>/g, '[/H1]')
                .substring(0, 2000);

            console.log(simplified);
            console.log('--- HTML STRUCTURE END ---');

        } catch (e) {
            console.error(`Error processing ${filePath}:`, e.message);
        }
    }
}

analyze();
