import mammoth from 'mammoth';
import { type AgendaItem } from '../types/meeting.types';

interface ParsedMeetingData {
    title?: string;
    date?: string;
    agendaItems?: AgendaItem[];
    meetingNumber?: string; // e.g., "09" from PV 9
}

export const parseAgendaDOCX = async (file: File): Promise<ParsedMeetingData> => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;

    if (result.messages.length > 0) {
        console.warn('Mammoth messages:', result.messages);
    }

    const parsedResult: ParsedMeetingData = {
        agendaItems: []
    };

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Helper to extract text with proper newlines from HTML
    const extractTextWithNewlines = (element: Element): string => {
        let text = '';
        const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BR'];

        element.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as Element;
                if (blockTags.includes(el.tagName)) {
                    text += '\n';
                }
                text += extractTextWithNewlines(el);
                if (blockTags.includes(el.tagName) && !text.endsWith('\n')) {
                    text += '\n';
                }
            }
        });
        return text;
    };

    const fullText = extractTextWithNewlines(doc.body);
    const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // ============================================================
    // 1. Extract Date (Look for patterns like "10 octobre 2023")
    // ============================================================
    const dateRegex = /(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i;
    const dateMatch = fullText.match(dateRegex);
    if (dateMatch) {
        const months: { [key: string]: string } = {
            'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04', 'mai': '05', 'juin': '06',
            'juillet': '07', 'août': '08', 'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
        };
        const day = dateMatch[1].padStart(2, '0');
        const monthStr = dateMatch[2].toLowerCase();
        const year = dateMatch[3];
        const month = months[monthStr];

        if (month) {
            parsedResult.date = `${year}-${month}-${day}T19:00`;
        }
    }

    // ============================================================
    // 2. Extract Title and Meeting Number
    // ============================================================
    const titleLine = lines.find(line => line.toUpperCase().includes('ASSEMBLÉE'));
    if (titleLine) {
        parsedResult.title = titleLine;

        // Extract meeting number (e.g., "9e ASSEMBLÉE" -> "09")
        const meetingNumMatch = titleLine.match(/(\d+)\s*[eè]/i);
        if (meetingNumMatch) {
            parsedResult.meetingNumber = meetingNumMatch[1].padStart(2, '0');
        }
    }

    // ============================================================
    // 3. Parse RÉSOLUTION and COMMENTAIRE items from PV structure
    // ============================================================
    // Patterns to detect:
    // - "RÉSOLUTION XX-NN" (e.g., "RÉSOLUTION 09-35")
    // - "COMMENTAIRE XX-A" (e.g., "COMMENTAIRE 09-A")

    const resolutionRegex = /^R[ÉE]SOLUTION\s+(\d{2})-(\d+)/i;
    const commentaireRegex = /^COMMENTAIRE\s+(\d{2})-([A-Za-z])/i;
    const considerantRegex = /^CONSID[ÉE]RANT/i;
    const ilEstResoluRegex = /^IL EST R[ÉE]SOLU/i;

    let currentItem: Partial<AgendaItem> | null = null;
    let currentContent: string[] = [];
    let itemOrder = 0;
    let lastTitleLine = '';

    // Track titles that appear before RÉSOLUTION/COMMENTAIRE
    const titlesBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for RÉSOLUTION
        const resMatch = line.match(resolutionRegex);
        if (resMatch) {
            // Save previous item if exists
            if (currentItem && (currentItem.title || currentContent.length > 0)) {
                currentItem.decision = currentContent.join('\n').trim();
                if (!currentItem.title && titlesBuffer.length > 0) {
                    currentItem.title = titlesBuffer[titlesBuffer.length - 1];
                }
                parsedResult.agendaItems?.push(currentItem as AgendaItem);
            }

            currentItem = {
                id: `imported-pv-${Date.now()}-${itemOrder}`,
                order: itemOrder,
                title: lastTitleLine || titlesBuffer[titlesBuffer.length - 1] || '',
                duration: 15,
                presenter: 'Coordonnateur',
                objective: 'Décision',
                minuteType: 'resolution',
                minuteNumber: `${resMatch[1]}-${resMatch[2]}`,
                description: '',
                decision: '',
                proposer: '',
                seconder: ''
            };
            currentContent = [];
            itemOrder++;
            titlesBuffer.length = 0;
            continue;
        }

        // Check for COMMENTAIRE
        const comMatch = line.match(commentaireRegex);
        if (comMatch) {
            // Save previous item if exists
            if (currentItem && (currentItem.title || currentContent.length > 0)) {
                currentItem.decision = currentContent.join('\n').trim();
                if (!currentItem.title && titlesBuffer.length > 0) {
                    currentItem.title = titlesBuffer[titlesBuffer.length - 1];
                }
                parsedResult.agendaItems?.push(currentItem as AgendaItem);
            }

            currentItem = {
                id: `imported-pv-${Date.now()}-${itemOrder}`,
                order: itemOrder,
                title: lastTitleLine || titlesBuffer[titlesBuffer.length - 1] || '',
                duration: 15,
                presenter: 'Coordonnateur',
                objective: 'Information',
                minuteType: 'comment',
                minuteNumber: `${comMatch[1]}-${comMatch[2].toUpperCase()}`,
                description: '',
                decision: '',
                proposer: '',
                seconder: ''
            };
            currentContent = [];
            itemOrder++;
            titlesBuffer.length = 0;
            continue;
        }

        // If we're in an item, collect content
        if (currentItem) {
            // Check for CONSIDÉRANT (part of resolution content)
            if (considerantRegex.test(line)) {
                currentContent.push(line);
                continue;
            }

            // Check for IL EST RÉSOLU
            if (ilEstResoluRegex.test(line)) {
                currentContent.push('\n' + line);
                continue;
            }

            // Regular content line
            if (!line.toUpperCase().includes('PROCÈS-VERBAL') &&
                !line.toUpperCase().includes('ASSEMBLÉE') &&
                !line.match(/^_{3,}/) && // Skip signature lines
                !line.match(/^PATRICIA BOUTIN/i) &&
                !line.match(/^MICHA[EË]L ROSS/i)) {
                currentContent.push(line);
            }
        } else {
            // Before any item, track potential titles (lines that are short and might be section headers)
            if (line.length < 200 && !line.match(/^(ÉTAIENT|PROCÈS|COMITÉ|^\d{1,2}\s+(janvier|février))/i)) {
                // Check if this looks like a title (often ends with semicolon or is a short sentence)
                if (line.endsWith(';') || (line.length > 10 && line.length < 150)) {
                    lastTitleLine = line;
                    titlesBuffer.push(line);
                }
            }
        }
    }

    // Don't forget the last item
    if (currentItem && (currentItem.title || currentContent.length > 0)) {
        currentItem.decision = currentContent.join('\n').trim();
        if (!currentItem.title && titlesBuffer.length > 0) {
            currentItem.title = titlesBuffer[titlesBuffer.length - 1];
        }
        parsedResult.agendaItems?.push(currentItem as AgendaItem);
    }

    // ============================================================
    // 4. Fallback: If no RÉSOLUTION/COMMENTAIRE found, try auto-numbered lists
    // ============================================================
    if (!parsedResult.agendaItems || parsedResult.agendaItems.length === 0) {
        const orderedLists = doc.querySelectorAll('ol');
        let mainList: HTMLOListElement | null = null;
        let maxItems = 0;

        orderedLists.forEach((ol: HTMLOListElement) => {
            const items = ol.querySelectorAll('li');
            if (items.length > maxItems) {
                maxItems = items.length;
                mainList = ol;
            }
        });

        if (mainList && maxItems >= 3) {
            const listItems = (mainList as HTMLOListElement).querySelectorAll('li');
            listItems.forEach((li: HTMLLIElement, index: number) => {
                const text = li.textContent?.trim() || "";
                if (text) {
                    parsedResult.agendaItems?.push({
                        id: `imported-docx-auto-${Date.now()}-${index}`,
                        order: index,
                        title: text,
                        duration: 15,
                        presenter: 'Coordonnateur',
                        objective: 'Information',
                        decision: '',
                        description: ''
                    });
                }
            });
        }
    }

    // ============================================================
    // 5. Fallback: Try table parsing
    // ============================================================
    if (!parsedResult.agendaItems || parsedResult.agendaItems.length === 0) {
        const tables = doc.querySelectorAll('table');

        tables.forEach((table) => {
            if (parsedResult.agendaItems && parsedResult.agendaItems.length > 0) return;

            const rows = table.querySelectorAll('tr');
            if (rows.length < 2) return;

            const headerRow = rows[0];
            const headers = Array.from(headerRow.querySelectorAll('td, th')).map(cell => cell.textContent?.trim().toUpperCase() || '');
            const sujetIndex = headers.findIndex(h => h.includes('SUJET'));

            if (sujetIndex !== -1) {
                parsedResult.agendaItems = [];
                for (let i = 1; i < rows.length; i++) {
                    const cells = rows[i].querySelectorAll('td');
                    if (cells.length <= sujetIndex) continue;

                    const rawTitle = cells[sujetIndex]?.textContent?.trim() || '';
                    if (!rawTitle) continue;

                    parsedResult.agendaItems.push({
                        id: `imported-docx-table-${Date.now()}-${i}`,
                        order: i - 1,
                        title: rawTitle,
                        duration: 15,
                        presenter: 'Coordonnateur',
                        objective: 'Information',
                        decision: '',
                        description: ''
                    });
                }
            }
        });
    }

    console.log('[docxParserService] Parsed result:', parsedResult);
    return parsedResult;
};
