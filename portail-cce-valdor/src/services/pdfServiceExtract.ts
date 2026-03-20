import html2pdf from 'html2pdf.js';
import { collection, addDoc, Timestamp, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from './firebase';
import type { Meeting, AgendaItem } from '../types/meeting.types';
import { generateResolutionHTML } from './pdfServiceResolution';

export interface MinuteExtract {
    id?: string;
    meetingId: string;
    agendaItemId: string;
    extractNumber: string;
    title: string;
    meetingDate: string;
    url: string;
    uploadedAt: string;
    uploadedBy: string;
}

/**
 * Extract <style> content and <body> content from a full HTML document string.
 * This is necessary because setting innerHTML on a div strips <head>/<style> tags,
 * causing the PDF to render without any CSS styling.
 */
const parseHTMLDocument = (htmlString: string): { styles: string; body: string } => {
    // Extract all <style> blocks
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let styles = '';
    let match;
    while ((match = styleRegex.exec(htmlString)) !== null) {
        styles += match[1] + '\n';
    }

    // Extract body content
    const bodyMatch = htmlString.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : htmlString;

    // Extract any <link> tags (for Google Fonts)
    const linkRegex = /<link[^>]*href="([^"]*fonts[^"]*)"[^>]*>/gi;
    let fontLinks = '';
    while ((match = linkRegex.exec(htmlString)) !== null) {
        fontLinks += `@import url('${match[1]}');\n`;
    }

    return { styles: fontLinks + styles, body };
};

export const generateExtractAndUpload = async (
    meeting: Meeting,
    item: AgendaItem,
    uploadedBy: string,
    agendaOrderNumber: number  // 1-indexed position of the item on the agenda (Ordre du Jour)
): Promise<MinuteExtract> => {
    try {
        // 1. Check if an extract already exists for this item to avoid duplicates
        const extractsRef = collection(db, 'extracts');
        const q = query(extractsRef, where('agendaItemId', '==', item.id));
        const snapshot = await getDocs(q);
        
        let existingExtract: MinuteExtract | null = null;
        if (!snapshot.empty) {
            existingExtract = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as MinuteExtract;
        }

        const allResNumbers = item.minuteEntries?.filter(e => e.type === 'resolution' && e.number).map(e => e.number).join(', ');
        const extractNumber = `EXT-${agendaOrderNumber}`;
        const extractTitle = allResNumbers 
            ? `${agendaOrderNumber}. ${item.title} (Résolutions: ${allResNumbers})` 
            : `${agendaOrderNumber}. ${item.title}`;
        const fileName = `extrait_${extractNumber}.pdf`;

        // 2. Generate the full HTML document (same template as Recommendations)
        const htmlString = generateResolutionHTML(meeting, item, 'agendaItem', 'official');

        // 3. Parse the HTML to separate CSS styles from body content.
        //    When we inject a full <!DOCTYPE html> into a div's innerHTML, the browser 
        //    strips the <head> and <style> tags, leaving unstyled content (= ugly PDF).
        //    By extracting them separately, we inject styles into the main document
        //    and only put the body content into the rendering div.
        const { styles, body } = parseHTMLDocument(htmlString);

        // 4. Create a unique scope ID to prevent style collision with the main app
        const scopeId = `extract-scope-${Date.now()}`;

        // Inject styles into <head> with scope prefix
        const styleElement = document.createElement('style');
        styleElement.id = scopeId;
        // Scope all CSS rules under our unique container class
        const scopedStyles = styles.replace(/(^|\})\s*([^@\}][^{]*)\{/g, (match, prefix, selector) => {
            // Don't scope @-rules (like @media, @font-face, @import)
            if (selector.trim().startsWith('@')) return match;
            // Scope normal selectors
            return `${prefix} .${scopeId} ${selector.trim()} {`;
        });
        styleElement.textContent = scopedStyles;
        document.head.appendChild(styleElement);

        // 5. Create a container div with the body content
        const container = document.createElement('div');
        container.className = scopeId;
        container.style.position = 'fixed';
        container.style.left = '0px';
        container.style.top = '0px';
        container.style.width = '816px';         // 8.5" at 96dpi
        container.style.backgroundColor = '#ffffff';
        container.style.zIndex = '-9999';
        container.style.opacity = '0.01';         // Nearly invisible but renderable
        container.style.pointerEvents = 'none';
        container.innerHTML = body;
        document.body.appendChild(container);

        // 6. Wait for Google Fonts to load
        await new Promise(resolve => setTimeout(resolve, 1200));
        if (document.fonts?.ready) {
            await document.fonts.ready;
        }

        // 7. Configure html2pdf with settings matching the Recommendation PDF
        const opt = {
            margin:       0,  // HTML template already has 60px/80px padding
            filename:     fileName,
            image:        { type: 'jpeg' as const, quality: 0.98 },
            html2canvas:  { 
                scale: 2,
                useCORS: true, 
                logging: false, 
                backgroundColor: '#ffffff',
                width: 816,
                windowWidth: 816
            },
            jsPDF:        { 
                unit: 'in' as const, 
                format: 'legal' as const, 
                orientation: 'portrait' as const 
            }
        };

        // 8. Generate PDF Blob
        let pdfBlob: Blob;
        try {
            pdfBlob = await html2pdf().set(opt).from(container).outputPdf('blob');
        } finally {
            // Clean up: remove both the container and the injected styles
            if (document.body.contains(container)) {
                document.body.removeChild(container);
            }
            const styleEl = document.getElementById(scopeId);
            if (styleEl) {
                document.head.removeChild(styleEl);
            }
        }

        // 9. Upload to Firebase Storage
        const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
        const storagePath = `extracts/${meeting.id}/${Date.now()}_${fileName}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        // 10. Save metadata to Firestore
        const extractData: Omit<MinuteExtract, 'id'> = {
            meetingId: meeting.id,
            agendaItemId: item.id,
            extractNumber,
            title: extractTitle,
            meetingDate: meeting.date,
            url,
            uploadedAt: new Date().toISOString(),
            uploadedBy
        };

        let finalDocId = '';
        if (existingExtract && existingExtract.id) {
            const { doc, updateDoc } = await import('firebase/firestore');
            const docRef = doc(db, 'extracts', existingExtract.id);
            await updateDoc(docRef, extractData as any);
            finalDocId = existingExtract.id;
        } else {
            const docRef = await addDoc(collection(db, 'extracts'), {
                ...extractData,
                timestamp: Timestamp.now()
            });
            finalDocId = docRef.id;
        }

        return { id: finalDocId, ...extractData };

    } catch (error) {
        console.error("Error generating and uploading extract PDF:", error);
        throw error;
    }
};
