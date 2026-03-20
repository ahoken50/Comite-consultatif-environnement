import { jsPDF } from 'jspdf';
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
        }

        const allResNumbers = item.minuteEntries?.filter(e => e.type === 'resolution' && e.number).map(e => e.number).join(', ');
        const extractNumber = `EXT-${item.minuteNumber || item.id.substring(0, 4)}`;
        const extractTitle = allResNumbers ? `${item.title} (Résolutions: ${allResNumbers})` : item.title;
        const fileName = `extrait_${extractNumber.replace(/\//g, '-')}.pdf`;

        // 2. Generate HTML using the SAME template as the Recommendation PDF
        const htmlString = generateResolutionHTML(meeting, item, 'agendaItem', 'official');
        
        // 3. Use an invisible popup window to render the HTML with full CSS/fonts,
        //    then use jsPDF .html() to convert it to a vector PDF
        //    (jsPDF .html() uses html2canvas internally but its .html() pipeline 
        //    is specifically designed for multi-page flows and proper scaling)
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.left = '0px';
        iframe.style.top = '0px';
        iframe.style.width = '816px';
        iframe.style.height = '1344px';
        iframe.style.opacity = '0';
        iframe.style.pointerEvents = 'none';
        iframe.style.zIndex = '-9999';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);

        const iframeDoc = iframe.contentWindow?.document;
        if (!iframeDoc) {
            document.body.removeChild(iframe);
            throw new Error("Could not create iframe for PDF extraction");
        }

        iframeDoc.open();
        iframeDoc.write(htmlString);
        iframeDoc.close();

        // Wait for Google Fonts and images to load
        await new Promise(resolve => setTimeout(resolve, 1500));
        try {
            // @ts-ignore
            if (iframeDoc.fonts?.ready) {
                // @ts-ignore
                await iframeDoc.fonts.ready;
            }
        } catch (_) { /* fonts API not available, timeout is our fallback */ }

        // 4. Create jsPDF instance with Legal format (8.5 x 14 inches)
        const pdf = new jsPDF({
            unit: 'in',
            format: 'legal',
            orientation: 'portrait'
        });
        
        // Use jsPDF's .html() method for vector-quality rendering
        const pageBody = iframeDoc.body;
        
        await new Promise<void>((resolve) => {
            pdf.html(pageBody, {
                callback: function () {
                    resolve();
                },
                x: 0,
                y: 0,
                width: 8.5, // Full legal page width in inches
                windowWidth: 816, // Match the 816px width of the HTML template
                autoPaging: 'text'
            });
        });
        
        // Clean up iframe
        if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
        }

        // 5. Get PDF as blob
        const pdfBlob = pdf.output('blob');
        const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

        // 6. Upload to Firebase Storage
        const storagePath = `extracts/${meeting.id}/${Date.now()}_${fileName}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        // 7. Save metadata to Firestore 'extracts' collection
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
