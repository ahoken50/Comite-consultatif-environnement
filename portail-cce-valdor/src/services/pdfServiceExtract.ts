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

export const generateExtractAndUpload = async (
    meeting: Meeting,
    item: AgendaItem,
    uploadedBy: string
): Promise<MinuteExtract> => {
    try {
        // 1. Check if an extract already exists for this item to avoid duplicates
        const extractsRef = collection(db, 'extracts');
        const q = query(extractsRef, where('agendaItemId', '==', item.id));
        const snapshot = await getDocs(q);
        
        let existingExtract: MinuteExtract | null = null;
        if (!snapshot.empty) {
            existingExtract = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as MinuteExtract;
            // Optionally, we could delete the old one or just overwrite. Overwriting the record is easier:
            // But let's just create a new one and delete the old record to keep it clean.
        }

        const allResNumbers = item.minuteEntries?.filter(e => e.type === 'resolution' && e.number).map(e => e.number).join(', ');
        const extractNumber = `EXT-${item.minuteNumber || item.id.substring(0, 4)}`;
        const extractTitle = allResNumbers ? `${item.title} (Résolutions: ${allResNumbers})` : item.title;

        // 2. Generate HTML
        const htmlString = generateResolutionHTML(meeting, item, 'agendaItem', 'official');
        
        // Use an iframe to safely render the FULL document (including <head> and <style>) 
        // without destroying the main React DOM, which happens when using innerHTML on a div.
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.top = '0px';
        iframe.style.left = '0px';
        iframe.style.width = '816px'; // 8.5 inches at 96dpi
        iframe.style.height = '1344px'; // 14 inches at 96dpi (Legal format)
        iframe.style.opacity = '0.01'; // Practically invisible but html2canvas will still render it
        iframe.style.pointerEvents = 'none';
        iframe.style.zIndex = '-9999';
        iframe.style.border = 'none';
        iframe.style.backgroundColor = '#ffffff';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow?.document;
        if (!doc) {
            document.body.removeChild(iframe);
            throw new Error("Could not create iframe document for PDF extraction");
        }

        doc.open();
        doc.write(htmlString);
        doc.close();

        // 3. Configure html2pdf (Optimized for 1:1 pixel-perfect mapping matching browser window.print)
        const opt = {
            margin:       0, // Zero margin at the PDF level; relying entirely on the HTML's internal padding (60px 80px)
            filename:     `extrait_${extractNumber.replace(/\//g, '-')}.pdf`,
            image:        { type: 'jpeg' as const, quality: 1 },
            html2canvas:  { 
                scale: 2, // High DPI rendering
                useCORS: true, 
                logging: false, 
                backgroundColor: '#ffffff',
                windowWidth: 816 // Force EXACT 8.5" pixel width for the canvas snapshot to prevent text wrapping/squishing
            },
            jsPDF:        { 
                unit: 'in', 
                format: 'legal', 
                orientation: 'portrait' as const 
            }
        };

        let pdfBlob: Blob;
        try {
            // Wait for fonts and images to load inside the iframe
            await new Promise(resolve => setTimeout(resolve, 800));
            // @ts-ignore
            if (doc.fonts && doc.fonts.ready) {
                // @ts-ignore
                await doc.fonts.ready;
            }
            // 4. Generate PDF Blob
            pdfBlob = await html2pdf().set(opt).from(doc.body).outputPdf('blob');
        } finally {
            // ALWAYS clean up the DOM element to prevent exponential GC/DOM slowdowns
            if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
            }
        }
        
        // Convert Blob to File
        const file = new File([pdfBlob], opt.filename, { type: 'application/pdf' });

        // 5. Upload to Firebase Storage
        const storagePath = `extracts/${meeting.id}/${Date.now()}_${opt.filename}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        // 6. Save metadata to Firestore 'extracts' collection
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
            // Update existing record rather than creating duplicates
            // We use raw import from firestore
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
