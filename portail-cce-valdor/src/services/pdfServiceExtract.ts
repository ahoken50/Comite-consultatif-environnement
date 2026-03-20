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

        const extractNumber = item.minuteNumber || item.minuteEntries?.find(e => e.type === 'resolution')?.number || `ITEM-${item.id.substring(0, 4)}`;

        // 2. Generate HTML
        const htmlString = generateResolutionHTML(meeting, item, 'agendaItem', 'official');
        
        // Ensure the HTML string is properly wrapped for html2pdf
        const containerHtml = `
            <div style="background: white; padding: 20px;">
                ${htmlString}
            </div>
        `;

        // 3. Configure html2pdf
        const opt = {
            margin:       [15, 15, 15, 15] as [number, number, number, number],
            filename:     `extrait_${extractNumber.replace(/\//g, '-')}.pdf`,
            image:        { type: 'jpeg' as const, quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
            jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' as const }
        };

        // 4. Generate PDF Blob
        // html2pdf can output various formats. 'blob' is ideal for uploading.
        const pdfBlob = await html2pdf().set(opt).from(containerHtml).outputPdf('blob');
        
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
            title: item.title,
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
