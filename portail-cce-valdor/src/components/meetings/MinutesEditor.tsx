import React, { useState } from 'react';
import { arrayUnion, deleteField } from 'firebase/firestore';
import {
    Box,
    Typography,
    TextField,
    Button,
    Paper,
    Divider,
    Grid,
    Alert,
    Snackbar,
    Drawer
} from '@mui/material';
import { Save, PictureAsPdf, UploadFile, DeleteSweep, Shield, Send, AutoAwesome, SmartToy, Description, Download } from '@mui/icons-material';
import type { Meeting, AgendaItem, AudioRecording, MinutesDraft } from '../../types/meeting.types';
// import { sanitizeMinutes } from '../../services/geminiService'; // Removed in favor of Claude
import MinutesImportDialog from './MinutesImportDialog';
import ApprovalRequestDialog from './ApprovalRequestDialog';
import AudioUpload from './AudioUpload';
import TranscriptionViewer from './TranscriptionViewer';
import AgendaItemEditor from './AgendaItemEditor';
import CrossValidationPanel from './CrossValidationPanel';
import PVModeSelector from './PVModeSelector';
import PVAgentWizard from './PVAgentWizard';
import JurisprudenceAssistant from './JurisprudenceAssistant';
import { useMinutesFile } from '../../hooks/useMinutesFile';
import { useToast } from '../../hooks/useToast';
import { useTranscriptionProcessor } from '../../hooks/useTranscriptionProcessor';
import { useMinutesState } from '../../hooks/useMinutesState';
import { usePVAgent } from '../../hooks/usePVAgent';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
// Note: parseAgendaDOCX is imported dynamically when needed
import { parseAgendaDOCXWithAI, matchPVToAgenda } from '../../services/docxParserService';
import { parseMinutesPDF } from '../../services/pvParserService';

interface MinutesEditorProps {
    meeting: Meeting;
    onUpdate: (updates: Partial<Meeting>) => void;
    readOnly?: boolean;
    members?: any[];
    documents?: any[]; // Documents linked to agenda items
}

/**
 * MinutesEditor Component
 * 
 * A comprehensive editor for meeting minutes (Procès-Verbaux).
 * 
 * Features:
 * - Real-time editing of global notes and agenda items.
 * - Supports "Legacy" simple mode (decision text only) and "Structured" mode (resolutions/comments).
 * - Auto-save functionality via useMinutesState hook.
 * - Integration with audio transcription (Smart Planning).
 * - File attachment management (upload/delete/preview).
 * - Versioning support (manual save creates historical versions).
 * 
 * @param meeting - The meeting object to edit.
 * @param onUpdate - Callback to update the meeting in Firestore/State.
 * @param readOnly - If true, disables editing (defaults to false).
 */
const MinutesEditor: React.FC<MinutesEditorProps> = ({ meeting, onUpdate, readOnly = false, members = [], documents = [] }) => {
    const { showSuccess, showError } = useToast();
    const {
        globalNotes,
        setGlobalNotes,
        localAgendaItems,
        setLocalAgendaItems,
        hasUnsavedChanges,
        setHasUnsavedChanges,
        lastSaved,
        isSaving,
        handleGlobalNotesChange,
        handleAgendaItemChange,
        handleMinuteEntryChange,
        handleAddMinuteEntry,
        handleDeleteMinuteEntry,
        handleSave,
        handleClearAll,
        setItemDecisions,
        itemDecisions,
        showSaveSuccess,
        setShowSaveSuccess,
        handleDecisionChange,
        userRole
    } = useMinutesState({ meeting, onUpdate });

    const [isImportOpen, setIsImportOpen] = useState(false);
    const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false);
    const [isModeSelectorOpen, setIsModeSelectorOpen] = useState(false);
    const [isAgentWizardOpen, setIsAgentWizardOpen] = useState(false);
    const [isJurisprudenceOpen, setIsJurisprudenceOpen] = useState(false);

    // Progressive Rendering State for Agenda Items
    // Prevents massive DOM layout thrashing and thread blocking on mount
const BATCH_SIZE = 5; // Ou une constante importée d'un fichier de configuration
    const [visibleCount, setVisibleCount] = useState(Math.min(BATCH_SIZE, localAgendaItems.length));

    React.useEffect(() => {
        setVisibleCount(Math.min(BATCH_SIZE, localAgendaItems.length));
    }, [localAgendaItems.length]);

    React.useEffect(() => {
        if (visibleCount < localAgendaItems.length) {
            const frame = requestAnimationFrame(() => {
                setVisibleCount(prev => Math.min(prev + BATCH_SIZE, localAgendaItems.length));
            });
            return () => cancelAnimationFrame(frame);
        }
    }, [visibleCount, localAgendaItems.length]);

    const [savedAgentSession, setSavedAgentSession] = React.useState<any | null>(null);

    React.useEffect(() => {
        const saved = localStorage.getItem(`pv_agent_session_${meeting.id}`);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setSavedAgentSession(parsed);
            } catch (err) {
                console.error("Failed to parse saved agent session:", err);
            }
        }
    }, [meeting.id]);

    // SmartPV Agent hook
    const pvAgent = usePVAgent({
        meeting,
        members,
        onComplete: (_finalState) => {
            showSuccess('🎉 PV généré avec succès par l\'agent SmartPV!');
        },
        onError: (error) => {
            showError(`Erreur agent: ${error.message}`);
        },
    });

    // Use custom hook for file management
    const { localFile, handleFileUpload: uploadFile, handleDeleteFile } = useMinutesFile({
        meeting,
        onUpdate
    });

    // Use custom hook for transcription processing
    const { handleApplyTranscription } = useTranscriptionProcessor({
        localAgendaItems,
        meetingNumber: meeting.meetingNumber,
        setGlobalNotes,
        setLocalAgendaItems,
        setItemDecisions,
        setHasUnsavedChanges
    });

    const handleApplyTranscriptionAndClearDraft = React.useCallback(async (content: string) => {
        await handleApplyTranscription(content);
        onUpdate({ minutesDraft: deleteField() as unknown as MinutesDraft });
    }, [handleApplyTranscription, onUpdate]);

    const handleGeneratePDF = async () => {
        // Create a temporary meeting object with current state
        // Use localAgendaItems directly without overwriting decision
        const meetingForPdf: Meeting = {
            ...meeting,
            minutes: globalNotes,
            agendaItems: localAgendaItems
        };
        const { generateMinutesPDF } = await import('../../services/pdfServiceMinutes');
        generateMinutesPDF(meetingForPdf, globalNotes, null, members);
    };

    const handleExportDOCX = () => {
        // Construct clean HTML for Word export with rich styling
        let html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><title>Procès-verbal - ${meeting.title}</title>
<style>
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333333; }
h1 { text-align: center; color: #1e4e3d; font-size: 24px; margin-bottom: 5px; }
h2 { color: #2d3748; font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; margin-top: 20px; }
h3 { color: #1e4e3d; font-size: 15px; margin-top: 15px; margin-bottom: 5px; }
.meta { margin-bottom: 20px; font-size: 14px; color: #4a5568; background: #f7fafc; padding: 10px; border-left: 4px solid #1e4e3d; }
.attendees { margin-bottom: 20px; }
.agenda-item { margin-bottom: 25px; padding: 15px; border: 1px solid #e2e8f0; border-radius: 4px; }
.resolution { background-color: #f0fdf4; border-left: 3px solid #16a34a; padding: 10px; margin-top: 10px; }
.comment { background-color: #f8fafc; border-left: 3px solid #64748b; padding: 10px; margin-top: 10px; }
table { border-collapse: collapse; width: 100%; margin-top: 10px; }
th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
th { background-color: #edf2f7; font-weight: bold; }
</style>
</head>
<body>
<h1>PROCÈS-VERBAL</h1>
<h3 style="text-align: center; margin-top: 0; color: #64748b;">${meeting.title}</h3>

<div class="meta">
  <strong>Date :</strong> ${new Date(meeting.date).toLocaleDateString('fr-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}<br/>
  <strong>Lieu :</strong> ${meeting.location || 'Non spécifié'}<br/>
  <strong>Type :</strong> ${meeting.type === 'regular' ? 'Ordinaire' : 'Extraordinaire'}<br/>
  <strong>Statut :</strong> ${meeting.status}
</div>

<h2>Présences & Quorum</h2>
<div class="attendees">
  <table>
    <thead>
      <tr>
        <th>Nom</th>
        <th>Rôle</th>
        <th>Présence</th>
      </tr>
    </thead>
    <tbody>
      ${(meeting.attendees || []).map(att => `
        <tr>
          <td>${att.name}</td>
          <td>${att.role}</td>
          <td>${att.isPresent ? 'Présent' : 'Absent'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</div>

${globalNotes ? `
<h2>Notes Générales / Résumé Exécutif</h2>
<div style="white-space: pre-wrap; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0;">
  ${globalNotes}
</div>
` : ''}

<h2>Délibérations & Résolutions</h2>
${(localAgendaItems || []).map((item, idx) => {
    let entriesHtml = '';
    if (item.minuteEntries && item.minuteEntries.length > 0) {
        entriesHtml = item.minuteEntries.map(entry => `
            <div class="${entry.type === 'resolution' ? 'resolution' : 'comment'}">
                <strong>[${entry.type.toUpperCase()}${entry.number ? ` ${entry.number}` : ''}]</strong>
                ${entry.proposer ? `Proposé par : ${entry.proposer}` : ''} 
                ${entry.seconder ? ` - Appuyé par : ${entry.seconder}` : ''}
                <div style="margin-top: 5px; white-space: pre-wrap;">${entry.content}</div>
            </div>
        `).join('');
    } else if (item.decision || itemDecisions[item.id]) {
        entriesHtml = `
            <div class="resolution">
                <strong>[DÉCISION]</strong>
                <div style="margin-top: 5px; white-space: pre-wrap;">${itemDecisions[item.id] || item.decision}</div>
            </div>
        `;
    }

    return `
        <div class="agenda-item">
            <h3>${idx + 1}. ${item.title}</h3>
            <p><em>Présenté par : ${item.presenter || 'Non spécifié'} | Objectif : ${item.objective || 'Information'}</em></p>
            ${item.description ? `<p>${item.description}</p>` : ''}
            ${entriesHtml}
        </div>
    `;
}).join('')}

</body>
</html>`;

        const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PV_${meeting.title.replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSuccess('Fichier DOCX (Word) généré avec succès !');
    };

    const handleExportJSON = () => {
        const payload = {
            exportVersion: "1.0",
            exportedAt: new Date().toISOString(),
            meeting: {
                id: meeting.id,
                title: meeting.title,
                date: meeting.date,
                location: meeting.location,
                type: meeting.type,
                status: meeting.status,
                meetingNumber: meeting.meetingNumber,
                isConfidential: meeting.isConfidential || false,
                attendees: meeting.attendees || [],
                globalNotes: globalNotes || "",
                agendaItems: localAgendaItems.map(item => ({
                    id: item.id,
                    order: item.order,
                    title: item.title,
                    description: item.description || "",
                    duration: item.duration,
                    actualDuration: item.actualDuration || 0,
                    presenter: item.presenter || "",
                    objective: item.objective || "Information",
                    agendaNote: item.agendaNote || "",
                    decision: itemDecisions[item.id] || item.decision || "",
                    minuteEntries: item.minuteEntries || []
                }))
            }
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PV_${meeting.title.replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSuccess('Fichier JSON structuré exporté avec succès !');
    };

    const handleDraftGenerated = React.useCallback((draft: MinutesDraft) => {
        onUpdate({ minutesDraft: draft });
    }, [onUpdate]);

    const handleTranscriptionUpdate = React.useCallback((newTranscription: string, speakerMap?: Record<string, string>) => {
        // We always update the consolidated legacy field
        let updatedLegacySpeakerMapping = meeting.audioRecording?.speakerMapping || {};
        if (speakerMap) {
            updatedLegacySpeakerMapping = { ...updatedLegacySpeakerMapping };
            Object.entries(speakerMap).forEach(([oldName, newName]) => {
                if (newName.trim()) {
                    let found = false;
                    Object.entries(updatedLegacySpeakerMapping).forEach(([key, val]) => {
                        if (val === oldName) {
                            updatedLegacySpeakerMapping[key] = newName;
                            found = true;
                        }
                    });
                    if (!found) {
                        updatedLegacySpeakerMapping[oldName] = newName;
                    }
                }
            });
        }

        const updatedLegacy = {
            ...(meeting.audioRecording || {}),
            transcription: newTranscription,
            speakerMapping: updatedLegacySpeakerMapping
        };

        // Split the new transcription by the delimiter
        const parts = newTranscription.split(/\r?\n\r?\n---\s*TRANSCRIPTION\s+SUIVANTE\s*---\r?\n\r?\n/);
        
        let updatedRecordings = meeting.audioRecordings;
        if (Array.isArray(meeting.audioRecordings) && meeting.audioRecordings.length > 0) {
            const sortedRecordings = [...meeting.audioRecordings].sort((a, b) => {
                if (a.uploadedAt && b.uploadedAt) {
                    const timeA = new Date(a.uploadedAt).getTime();
                    const timeB = new Date(b.uploadedAt).getTime();
                    if (timeA !== timeB) {
                        return timeA - timeB;
                    }
                }
                return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
            });
            updatedRecordings = sortedRecordings.map((rec, index) => {
                if (index < parts.length) {
                    // Extract transcription for this part and strip the "=== header ===" line
                    let partText = parts[index].trim();
                    const headerMatch = partText.match(/^===\s*(.*?)\s*===\s*\r?\n\r?\n?(.*)/s);
                    if (headerMatch) {
                        partText = headerMatch[2].trim();
                    }

                    let recSpeakerMapping = rec.speakerMapping || {};
                    if (speakerMap) {
                        recSpeakerMapping = { ...recSpeakerMapping };
                        Object.entries(speakerMap).forEach(([oldName, newName]) => {
                            if (newName.trim()) {
                                let found = false;
                                Object.entries(recSpeakerMapping).forEach(([key, val]) => {
                                    if (val === oldName) {
                                        recSpeakerMapping[key] = newName;
                                        found = true;
                                    }
                                });
                                if (!found) {
                                    recSpeakerMapping[oldName] = newName;
                                }
                            }
                        });
                    }

                    return {
                        ...rec,
                        transcription: partText,
                        speakerMapping: recSpeakerMapping
                    };
                }
                return rec;
            });
        }

        onUpdate({
            audioRecording: updatedLegacy as any,
            audioRecordings: updatedRecordings as any
        });
    }, [meeting.audioRecording, meeting.audioRecordings, onUpdate]);

    const handleSanitize = async () => {
        // Validation: Check if there is content to anonymize
        if (!globalNotes && (!localAgendaItems || localAgendaItems.length === 0)) {
            showError('Aucun contenu à anonymiser.');
            return;
        }

        if (!window.confirm("Cette action va générer un fichier PDF contenant une version anonymisée du procès-verbal (Noms masqués, adresses simplifiées).\n\nNOTE : Votre brouillon actuel ne sera PAS modifié. Le PDF s'ouvrira dans une nouvelle fenêtre.\n\nContinuer ?")) return;

        // Open window immediately to satisfy browser popup blockers
        const printWindow = window.open('', '_blank', 'width=816,height=1056');
        if (printWindow) {
            printWindow.document.write('<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; flex-direction: column;">' +
                '<h2>Génération du PDF Anonymisé en cours...</h2>' +
                '<p>Veuillez patienter pendant que l\'IA traite le document (15-30 secondes).</p>' +
                '<div style="width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;"></div>' +
                '<style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>' +
                '</body></html>');
            printWindow.document.close();
        } else {
            showError("Veuillez autoriser les pop-ups pour voir le PDF.");
            return;
        }

        try {
            // 1. Prepare the meeting data exactly as it would be saved (Merging local state)
            const updatedAgendaItems = localAgendaItems.map(item => {
                const isLegacyMode = !item.minuteEntries || item.minuteEntries.length === 0;
                if (isLegacyMode) {
                    return {
                        ...item,
                        decision: itemDecisions[item.id] || item.decision || '',
                        minuteEntries: []
                    };
                } else {
                    return { ...item, minuteEntries: item.minuteEntries };
                }
            });

            const meetingSnapshot: Meeting = {
                ...meeting,
                minutes: globalNotes,
                agendaItems: updatedAgendaItems
            };

            showSuccess('Anonymisation en cours via Claude...');

            // Dynamically import
            const { sanitizeMeetingClaude } = await import('../../services/claudeService');

            // 2. Call AI
            const result = await sanitizeMeetingClaude(meetingSnapshot);

            if (result.success && result.sanitizedMeeting) {
                // 3. Generate PDF with the SANITIZED object, using the existing window
                const { generateMinutesPDF } = await import('../../services/pdfServiceMinutes');
                await generateMinutesPDF(result.sanitizedMeeting, result.sanitizedMeeting.minutes, printWindow, members);
                showSuccess('PDF Anonymisé généré !');
            } else {
                if (printWindow) printWindow.close();
                showError("Erreur lors de l'anonymisation: " + (result.error || 'Inconnue'));
            }
        } catch (error) {
            console.error('Sanitization failed:', error);
            if (printWindow) printWindow.close();
            showError("Erreur technique lors de l'appel IA");
        }
    };

    const handleGenerateSummary = async () => {
        const recordings = (Array.isArray(meeting.audioRecordings) ? meeting.audioRecordings : []) || (meeting.audioRecording ? [meeting.audioRecording] : []);
        const fullTranscription = recordings
            .map(r => r.transcription)
            .filter(t => !!t)
            .join('\n\n--- TRANSCRIPTION SUIVANTE ---\n\n');

        if (!fullTranscription.trim()) {
            showError("Veuillez d'abord transcrire l'audio pour générer un résumé.");
            return;
        }

        if (globalNotes) {
            const hasFullPV = globalNotes.includes("PROCÈS-VERBAL") || globalNotes.includes("RÉSOLUTION") || globalNotes.includes("COMMENTAIRE");
            const warningMsg = hasFullPV
                ? "⚠️ Attention : Un procès-verbal complet semble déjà rédigé dans ce champ. Générer un résumé d'introduction va écraser et remplacer tout le texte existant. Voulez-vous continuer ?"
                : "Le champ 'Notes Générales' n'est pas vide. Voulez-vous remplacer son contenu par le résumé IA ?";
            
            if (!window.confirm(warningMsg)) {
                return;
            }
        }

        try {
            showSuccess("Génération du résumé exécutif en cours (via Claude)...");

            // Dynamically import service
            const { generateExecutiveSummaryClaude } = await import('../../services/claudeService');

            const result = await generateExecutiveSummaryClaude(fullTranscription);

            if (result.success && result.summary) {
                setGlobalNotes(result.summary);
                setHasUnsavedChanges(true);
                showSuccess("Résumé d'introduction généré avec succès !");
            } else {
                showError(result.error || "Erreur lors de la génération");
            }
        } catch (error) {
            console.error('Summary generation failed:', error);
            showError("Erreur technique lors de l'appel IA");
        }
    };

    const handleImport = (parsedItems: Partial<AgendaItem>[]) => {
        const newItems = [...localAgendaItems];
        let parseIndex = 0;

        // Map parsed items to agenda items sequentially
        const updatedItems = newItems.map((item) => {
            if (parseIndex < parsedItems.length) {
                const parsed = parsedItems[parseIndex];
                parseIndex++;
                // Use fallbacks to prevent undefined values (Firestore rejects undefined)
                return {
                    ...item,
                    minuteType: parsed.minuteType ?? item.minuteType,
                    minuteNumber: parsed.minuteNumber ?? item.minuteNumber ?? '',
                    decision: parsed.decision ?? item.decision ?? '',
                    description: parsed.description ?? item.description ?? '',
                    proposer: parsed.proposer ?? item.proposer ?? '',
                    seconder: parsed.seconder ?? item.seconder ?? ''
                };
            }
            return item;
        });

        // Update local state
        setLocalAgendaItems(updatedItems);
        const newDecisions = { ...itemDecisions };
        updatedItems.forEach(item => {
            if (item.decision) {
                newDecisions[item.id] = item.decision;
            }
        });
        setItemDecisions(newDecisions);
        setHasUnsavedChanges(true);
    };

    // Handler for importing transcription from JSON file
    const handleTranscriptionJsonImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const jsonData = JSON.parse(text);

            let transcriptionText: string | null = null;
            let rawSegments: any[] | null = null;

            // Check for array format with speaker segments: [{start, end, speaker, text}, ...]
            if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0].speaker && jsonData[0].text) {
                rawSegments = jsonData;
                // Format transcription with speaker labels for each segment
                transcriptionText = jsonData
                    .map((seg: { speaker?: string; text?: string; start?: number }) => {
                        const speaker = seg.speaker || 'Inconnu';
                        const segText = seg.text || '';

                        let timestamp = '';
                        if (typeof seg.start === 'number') {
                            const min = Math.floor(seg.start / 60);
                            const sec = Math.floor(seg.start % 60);
                            timestamp = `[${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}] `;
                        }

                        return `${timestamp}[${speaker}] ${segText}`;
                    })
                    .join('\n');
            } else {
                // Support other JSON formats
                transcriptionText = jsonData.transcription || jsonData.text || jsonData.content ||
                    (Array.isArray(jsonData) ? jsonData.map((seg: any) => seg.text || seg.content).join('\n') : null);
            }

            if (!transcriptionText) {
                showError('Le fichier JSON ne contient pas de transcription valide. Format attendu: tableau avec {speaker, text} ou objet avec {transcription/text/content}');
                return;
            }

            // Create or update audioRecording with imported transcription
            const newAudioRecording = {
                ...(meeting.audioRecording || {}),
                fileName: file.name,
                transcription: transcriptionText,
                transcriptionStatus: 'completed' as const,
                importedAt: new Date().toISOString(),
                isImported: true, // Flag to indicate this was imported, not transcribed
                rawSegments: rawSegments, // Store raw segments for speaker identification
            };

            onUpdate({ audioRecording: newAudioRecording as any });

            // Count unique speakers
            const uniqueSpeakers = rawSegments
                ? new Set(rawSegments.map(s => s.speaker)).size
                : 0;
            const speakerInfo = uniqueSpeakers > 0 ? ` (${uniqueSpeakers} intervenants identifiés)` : '';

            showSuccess(`✅ Transcription importée avec succès${speakerInfo}`);

        } catch (jsonError) {
            console.error('[DEBUG] Transcription JSON parsing failed:', jsonError);
            showError(`Erreur de parsing JSON: ${jsonError instanceof Error ? jsonError.message : 'Format invalide'}`);
        }

        // Reset input to allow re-importing same file
        e.target.value = '';
    };

    // Wrapper for file upload including DOCX parsing logic
    const handleFileUploadWrapper = async (e: React.ChangeEvent<HTMLInputElement>) => {
        try {
            const file = await uploadFile(e);
            if (!file) return;

            // Detect file type and parse accordingly
            const isDocx = file.name.toLowerCase().endsWith('.docx');
            const isPdf = file.name.toLowerCase().endsWith('.pdf');

            if (isDocx || isPdf) {
                try {
                    console.log(`[DEBUG] Parsing ${isDocx ? 'DOCX' : 'PDF'} file as Minutes (PV)...`);

                    // Warning if no ODJ defined for AI parsing
                    if (isDocx && localAgendaItems.length === 0) {
                        const proceed = window.confirm(
                            '⚠️ Aucun Ordre du Jour (ODJ) n\'est défini pour cette réunion.\n\n' +
                            'Pour de meilleurs résultats avec le parser IA, il est recommandé de :\n' +
                            '1. Définir d\'abord l\'ODJ dans la section "Ordre du jour"\n' +
                            '2. Puis importer le PV\n\n' +
                            'Voulez-vous continuer quand même ?\n' +
                            '(L\'IA tentera de détecter automatiquement les points)'
                        );
                        if (!proceed) {
                            return;
                        }
                    }

                    let parsedData;

                    if (isDocx) {
                        // Use AI-powered parser for DOCX (with Groq) - falls back to regex if not configured
                        parsedData = await parseAgendaDOCXWithAI(file, localAgendaItems);
                    } else if (isPdf) {
                        // Use the OCR/Text parser for PDF
                        // PDF parsing with progress callback for OCR
                        parsedData = await parseMinutesPDF(
                            file,
                            (message: string) => {
                                console.log(`[OCR Progress] ${message}`);
                                showSuccess(message); // Show progress to user
                            },
                            localAgendaItems // Pass agenda items for AI matching
                        );

                        // Notify user if OCR was used (scanned PDF)
                        if (parsedData?.wasScanned) {
                            showSuccess('✅ PDF scanné détecté et traité par OCR (IA Gemini)');
                        }
                    }

                    console.log('[DEBUG] Parsed PV data:', parsedData);

                    if (parsedData?.agendaItems && parsedData.agendaItems.length > 0) {
                        console.log('[DEBUG] Found', parsedData.agendaItems.length, 'agenda items in DOCX');

                        // If meeting has no agenda items, CREATE new ones from parsed data
                        if (localAgendaItems.length === 0) {
                            console.log('[DEBUG] Meeting has no agenda items - creating from parsed DOCX');

                            // Create new agenda items from parsed data
                            const newAgendaItems: AgendaItem[] = parsedData.agendaItems.map((parsed, index) => ({
                                id: `agenda-${Date.now()}-${index}`,
                                order: index + 1,
                                title: parsed.title || `Point ${index + 1}`,
                                description: '',
                                duration: 10,
                                presenter: '',
                                objective: 'Information',
                                decision: parsed.decision || '',
                                minuteType: parsed.minuteType,
                                minuteNumber: parsed.minuteNumber || '',
                                proposer: parsed.proposer || '',
                                seconder: parsed.seconder || '',
                                minuteEntries: parsed.minuteEntries || []
                            }));

                            setLocalAgendaItems(newAgendaItems);

                            // Update item decisions state
                            const newDecisions: Record<string, string> = {};
                            newAgendaItems.forEach(item => {
                                if (item.decision) {
                                    newDecisions[item.id] = item.decision;
                                }
                            });
                            setItemDecisions(newDecisions);
                            setHasUnsavedChanges(true);

                            // Also save to Firebase immediately
                            onUpdate({ agendaItems: newAgendaItems });

                            console.log('[DEBUG] Created', newAgendaItems.length, 'new agenda items from DOCX');
                        } else {
                            // Use title-based matching instead of just index
                            const matchMap = parsedData?.agendaItems
                                ? matchPVToAgenda(parsedData.agendaItems, localAgendaItems)
                                : new Map();
                            console.log('[DEBUG] Matched', matchMap.size, 'items by title similarity');

                            // Update items that have a match
                            const updatedItems = localAgendaItems.map((item) => {
                                const matchedPV = matchMap.get(item.id);

                                if (matchedPV) {
                                    return {
                                        ...item,
                                        // NEW: Copy all minute entries (resolutions + comments)
                                        minuteEntries: matchedPV.minuteEntries ?? item.minuteEntries,
                                        // NEW: Copy description (narratif)
                                        description: matchedPV.description ?? item.description,
                                        // Legacy fields (kept for backward compatibility)
                                        minuteType: matchedPV.minuteType ?? item.minuteType,
                                        minuteNumber: matchedPV.minuteNumber ?? item.minuteNumber ?? '',
                                        decision: matchedPV.decision ?? item.decision ?? '',
                                        proposer: matchedPV.proposer ?? item.proposer ?? '',
                                        seconder: matchedPV.seconder ?? item.seconder ?? ''
                                    };
                                }
                                return item;
                            });

                            setLocalAgendaItems(updatedItems);

                            // Update item decisions state
                            const newDecisions = { ...itemDecisions };
                            updatedItems.forEach(item => {
                                if (item.decision) {
                                    newDecisions[item.id] = item.decision;
                                }
                            });
                            setItemDecisions(newDecisions);
                            setHasUnsavedChanges(true);

                            // AUTO-SAVE: Save immediately to prevent race condition with Firestore listener
                            // overwrite local state with old data if we don't save these changes now.
                            onUpdate({ agendaItems: updatedItems });

                            console.log('[DEBUG] Updated local agenda items with parsed data');
                        }
                    }

                    // Also update attendees if parsed from DOCX/PDF
                    if (parsedData?.attendees && parsedData.attendees.length > 0) {
                        console.log('[DEBUG] Found', parsedData.attendees.length, 'attendees in parsed file');
                        // Update meeting with parsed attendees
                        // Handle both string[] (from PDF/PV parser) and Attendee[] (from DOCX parser)
                        const newAttendees = parsedData.attendees.map((item: any) => {
                            if (typeof item === 'string') {
                                return {
                                    id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                                    name: item,
                                    role: 'Participant', // Default role
                                    isPresent: true
                                };
                            }
                            // If it's already an object, return it (ensure ID exists)
                            return {
                                ...item,
                                id: item.id || `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                            };
                        });

                        onUpdate({
                            attendees: newAttendees
                        });
                        console.log('[DEBUG] Updated meeting attendees from parsed data');
                    }
                } catch (parseError) {
                    console.warn('[DEBUG] Failed to parse file content:', parseError);
                    showError(`Erreur de parsing: ${parseError instanceof Error ? parseError.message : 'Inconnue'}`);
                    // Don't fail the upload if parsing fails - file is already uploaded
                }
            }

        } catch (error) {
            console.error("Upload process failed", error);
        }
    };




    return (
        <Box>
            {savedAgentSession && (
                <Alert
                    severity="warning"
                    sx={{ mb: 3 }}
                    action={
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                                color="warning"
                                variant="contained"
                                size="small"
                                onClick={() => {
                                    setIsAgentWizardOpen(true);
                                    pvAgent.resume(savedAgentSession);
                                    setSavedAgentSession(null);
                                }}
                            >
                                Reprendre la génération
                            </Button>
                            <Button
                                color="inherit"
                                size="small"
                                onClick={() => {
                                    localStorage.removeItem(`pv_agent_session_${meeting.id}`);
                                    setSavedAgentSession(null);
                                }}
                            >
                                Ignorer
                            </Button>
                        </Box>
                    }
                >
                    <Typography variant="body2" fontWeight="bold">
                        ⚠️ Une session SmartPV s'est interrompue pour cette réunion. Vous pouvez reprendre là où elle s'était arrêtée.
                    </Typography>
                </Alert>
            )}
            <Box sx={{ 
                display: 'flex', 
                flexDirection: { xs: 'column', lg: 'row' }, 
                justifyContent: 'space-between', 
                alignItems: { xs: 'stretch', lg: 'center' }, 
                gap: 2,
                mb: 3,
                borderBottom: '1px solid #e0e0e0',
                pb: 2
            }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold', color: '#1e4e3d', minWidth: 'max-content' }}>
                    Rédaction du Procès-Verbal
                </Typography>
                <Box sx={{ 
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    gap: 1, 
                    justifyContent: { xs: 'flex-start', lg: 'flex-end' },
                    '& .MuiButton-root': {
                        textTransform: 'none',
                        borderRadius: 2,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        px: 2,
                        py: 0.75,
                        fontSize: '0.85rem',
                        boxShadow: 'none',
                        '&:hover': {
                            boxShadow: 'none'
                        }
                    }
                }}>
                    {!readOnly && (
                        <>
                            <Button
                                variant="outlined"
                                color="primary"
                                startIcon={<AutoAwesome />}
                                onClick={() => setIsJurisprudenceOpen(true)}
                                title="Consulter la jurisprudence et l'historique des résolutions par IA sémantique"
                                sx={{ color: '#1e4e3d', borderColor: '#1e4e3d', '&:hover': { borderColor: '#143529', bgcolor: 'rgba(30, 78, 61, 0.04)' } }}
                            >
                                Jurisprudence IA
                            </Button>
                            <Button
                                variant="contained"
                                color="secondary"
                                startIcon={<SmartToy />}
                                onClick={() => setIsModeSelectorOpen(true)}
                                disabled={!meeting.audioRecording?.transcription && !(Array.isArray(meeting.audioRecordings) && meeting.audioRecordings.some(r => r.transcription))}
                                title="Générer le PV automatiquement avec l'agent IA"
                            >
                                SmartPV (Agent IA)
                            </Button>
                            <Button
                                variant="outlined"
                                component="label"
                                startIcon={<UploadFile />}
                            >
                                Importer PV (PDF/DOCX)
                                <input
                                    type="file"
                                    hidden
                                    accept=".pdf,.docx"
                                    onChange={handleFileUploadWrapper}
                                />
                            </Button>
                            <Button
                                variant="outlined"
                                startIcon={<UploadFile />}
                                onClick={() => setIsImportOpen(true)}
                            >
                                Importer Texte
                            </Button>
                            <Button
                                variant="outlined"
                                color="error"
                                startIcon={<DeleteSweep />}
                                onClick={handleClearAll}
                            >
                                Réinitialiser
                            </Button>
                        </>
                    )}
                    <Button
                        variant="outlined"
                        startIcon={<PictureAsPdf />}
                        onClick={handleGeneratePDF}
                        title="Générer et télécharger la version officielle en PDF"
                    >
                        Exporter PDF
                    </Button>
                    <Button
                        variant="outlined"
                        color="primary"
                        startIcon={<Description />}
                        onClick={handleExportDOCX}
                        title="Exporter le brouillon de PV au format Word (DOCX)"
                        sx={{ color: '#1e3a8a', borderColor: '#1e3a8a', '&:hover': { borderColor: '#172554', bgcolor: 'rgba(30, 58, 138, 0.04)' } }}
                    >
                        Exporter Word (DOCX)
                    </Button>
                    <Button
                        variant="outlined"
                        color="info"
                        startIcon={<Download />}
                        onClick={handleExportJSON}
                        title="Exporter les données structurées brutes au format JSON"
                    >
                        Exporter JSON
                    </Button>
                    {!readOnly && (
                        <>
                            <Button
                                variant="outlined"
                                color="secondary"
                                startIcon={<Shield />}
                                onClick={handleSanitize}
                                disabled={!globalNotes && (!localAgendaItems || localAgendaItems.length === 0)}
                                title="Générer un PDF anonymisé via IA (ne modifie pas le brouillon)"
                            >
                                PDF Anonymisé (IA)
                            </Button>
                            <Button
                                variant="outlined"
                                color="info"
                                startIcon={<Send />}
                                onClick={() => setIsApprovalDialogOpen(true)}
                                title="Envoyer le lien d'approbation au président"
                            >
                                Approbation
                            </Button>
                            <Button
                                variant="contained"
                                startIcon={<Save />}
                                onClick={() => handleSave(true)} // True = Create Version
                                disabled={isSaving} // Only disable while saving
                                color={hasUnsavedChanges ? "primary" : "inherit"} // Highlight if changes
                            >
                                {isSaving ? 'Sauvegarde...' : 'Enregistrer (Version)'}
                            </Button>
                        </>
                    )}
                </Box>
            </Box>

            {/* [NEW] Last Saved Indicator */}
            {lastSaved && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                        {hasUnsavedChanges
                            ? "⚠️ Modifications non enregistrées..."
                            : `✅ Dernière sauvegarde automatique : ${format(lastSaved, 'HH:mm:ss', { locale: fr })}`
                        }
                    </Typography>
                </Box>
            )}

            {/* Section Transcription IA */}
            {!readOnly && (
                <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        🎤 Transcription IA (Beta)
                    </Typography>
                    <Typography variant="body2" color="text.secondary" paragraph>
                        Importez un enregistrement audio/vidéo de l'assemblée pour générer automatiquement un brouillon de procès-verbal.
                    </Typography>

                    {/* Import Transcription JSON Option */}
                    <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                        <Button
                            variant="outlined"
                            size="small"
                            component="label"
                            startIcon={<UploadFile />}
                        >
                            Importer Transcription (JSON)
                            <input
                                type="file"
                                hidden
                                accept=".json"
                                onChange={handleTranscriptionJsonImport}
                            />
                        </Button>
                    </Box>
                    <AudioUpload
                        meetingId={meeting.id}
                        audioRecording={meeting.audioRecording}
                        audioRecordings={meeting.audioRecordings}
                        onUploadComplete={(recording: AudioRecording) => {
                            // Use arrayUnion to safely add to the list without race conditions
                            // Note: arrayUnion only adds unique elements, which is what we want
                            onUpdate({
                                audioRecordings: arrayUnion(recording) as any, // Cast as any to bypass Partial<Meeting> type check on frontend
                                // Update legacy field if it's the first one (this is still subject to race condition but less critical)
                                audioRecording: !meeting.audioRecording ? recording : meeting.audioRecording
                            });
                        }}
                        onDelete={(rec?: AudioRecording) => {
                            if (rec) {
                                console.log('[AudioDelete] Deleting recording:', rec.storagePath);
                                console.log('[AudioDelete] Current audioRecordings:', meeting.audioRecordings);
                                console.log('[AudioDelete] Current audioRecording (legacy):', meeting.audioRecording?.storagePath);

                                // Manual filter to ensure deletion by path (arrayRemove requires exact object match)
                                const current = Array.isArray(meeting.audioRecordings) ? meeting.audioRecordings : [];
                                const updated = current.filter(r => r.storagePath !== rec.storagePath);

                                // Also check if the legacy field matches (compare paths)
                                const legacyPath = meeting.audioRecording?.storagePath;
                                const shouldClearLegacy = legacyPath === rec.storagePath ||
                                    // Also clear if paths partially match (handle encoding issues)
                                    (legacyPath && rec.storagePath && legacyPath.includes(rec.fileName || '___no_match___'));

                                console.log('[AudioDelete] Should clear legacy?', shouldClearLegacy);
                                console.log('[AudioDelete] Updated array length:', updated.length);
                                console.log('[AudioDelete] Using deleteField() to remove audioRecording from Firestore');

                                onUpdate({
                                    audioRecordings: updated,
                                    // Use deleteField() to actually DELETE the field from Firestore
                                    // undefined gets stripped by sanitizeForFirestore and field remains!
                                    audioRecording: shouldClearLegacy || updated.length === 0
                                        ? deleteField() as unknown as AudioRecording
                                        : meeting.audioRecording,
                                    minutesDraft: shouldClearLegacy || updated.length === 0
                                        ? deleteField() as unknown as MinutesDraft
                                        : meeting.minutesDraft
                                });
                            } else {
                                // Clear all (explicit user action)
                                console.log('[AudioDelete] Clearing ALL audio recordings with deleteField()');
                                onUpdate({ 
                                    audioRecording: deleteField() as unknown as AudioRecording, 
                                    audioRecordings: [],
                                    minutesDraft: deleteField() as unknown as MinutesDraft
                                });
                            }
                        }}
                        onTranscriptionStarted={(message) => {
                            if (message) {
                                showSuccess(message);
                            }
                            onUpdate({ minutesDraft: deleteField() as unknown as MinutesDraft });
                        }}
                    />


                    {meeting.audioRecording?.transcription && (
                        <TranscriptionViewer
                            meeting={meeting}
                            onDraftGenerated={handleDraftGenerated}
                            onApplyToMinutes={handleApplyTranscriptionAndClearDraft}
                            onTranscriptionUpdate={handleTranscriptionUpdate}
                        />
                    )}
                </Paper>
            )}

            {(localFile.url || meeting.minutesFileUrl) && (
                <Alert severity={localFile.url ? "success" : "warning"} sx={{ mb: 3 }} action={
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        {localFile.url && (
                            <Button color="inherit" size="small" href={localFile.url} target="_blank">
                                Voir le fichier
                            </Button>
                        )}
                        {!readOnly && (
                            <Button color="error" size="small" onClick={() => {
                                console.log('[DEBUG] Supprimer button clicked!');
                                handleDeleteFile();
                            }}>
                                Supprimer
                            </Button>
                        )}
                    </Box>
                }>
                    {localFile.url
                        ? `Fichier joint : ${localFile.name || 'Document'}`
                        : `Référence orpheline : ${meeting.minutesFileName || 'Document supprimé'} (cliquez Supprimer pour nettoyer)`
                    }
                </Alert>
            )}

            <Drawer
                anchor="right"
                open={isJurisprudenceOpen}
                onClose={() => setIsJurisprudenceOpen(false)}
                PaperProps={{ sx: { width: { xs: '100%', sm: 480 } } }}
            >
                <JurisprudenceAssistant
                    onClose={() => setIsJurisprudenceOpen(false)}
                />
            </Drawer>

            <MinutesImportDialog
                open={isImportOpen}
                onClose={() => setIsImportOpen(false)}
                onImport={handleImport}
            />

            <ApprovalRequestDialog
                open={isApprovalDialogOpen}
                onClose={() => setIsApprovalDialogOpen(false)}
                meetingId={meeting.id}
                meeting={meeting}
                onSuccess={() => showSuccess("Lien d'approbation envoyé avec succès !")}
            />

            {/* SmartPV Agent Mode Selector */}
            <PVModeSelector
                open={isModeSelectorOpen}
                onClose={() => setIsModeSelectorOpen(false)}
                hasTranscription={
                    (Array.isArray(meeting.audioRecordings) && meeting.audioRecordings.some(r => !!r.transcription)) ||
                    !!meeting.audioRecording?.transcription
                }
                onSelectMode={(mode) => {
                    setIsModeSelectorOpen(false);
                    if (mode === 'smartpv') {
                        setIsAgentWizardOpen(true);

                        // Aggregate transcriptions from all recordings
                        const recordings = (Array.isArray(meeting.audioRecordings) ? meeting.audioRecordings : []) || (meeting.audioRecording ? [meeting.audioRecording] : []);
                        const fullTranscription = recordings
                            .map(r => r.transcription)
                            .filter(t => !!t)
                            .join('\n\n--- TRANSCRIPTION SUIVANTE ---\n\n');

                        pvAgent.start(undefined, fullTranscription);
                    } else if (mode === 'summary') {
                        handleGenerateSummary();
                    }
                    // Classic mode just closes the dialog - user continues manually
                }}
            />

            {/* SmartPV Agent Wizard */}
            <PVAgentWizard
                open={isAgentWizardOpen}
                state={pvAgent.state}
                isRunning={pvAgent.isRunning}
                onValidate={pvAgent.validateStep}
                onCancel={() => {
                    pvAgent.cancel();
                    setIsAgentWizardOpen(false);
                }}
                onApply={() => {
                    // Apply generated PV to local state
                    const draftingResult = pvAgent.state?.results.drafting;
                    const reflectionResult = pvAgent.state?.results.reflection;
                    const comparisonResult = pvAgent.state?.results.comparison;
                    const userValidationResult = pvAgent.state?.results.user_validation;
                    const userRevisionResult = pvAgent.state?.results.user_revision;

                    // Prioritize final AI revision, then manual edits, then standard flow
                    const finalContent = userRevisionResult?.finalContent
                        || userValidationResult?.userEdits
                        || comparisonResult?.finalContent
                        || reflectionResult?.finalContent
                        || draftingResult?.pvContent;

                    if (finalContent) {
                        // Update the global notes with the full PV content
                        setGlobalNotes(finalContent);
                        setHasUnsavedChanges(true);
                        showSuccess('PV appliqué avec succès !');
                    }
                    setIsAgentWizardOpen(false);
                    pvAgent.reset();
                }}
                agendaItems={localAgendaItems}
            />

            {/* Cross Validation Panel - Compare ODJ with PV */}
            {!readOnly && meeting.agendaItems && meeting.agendaItems.length > 0 && localAgendaItems.length > 0 && (
                <CrossValidationPanel
                    odjItems={meeting.agendaItems}
                    pvItems={localAgendaItems}
                    onSync={(missingItems) => {
                        // Add missing items to local agenda
                        const newItems = [...localAgendaItems, ...missingItems];
                        setLocalAgendaItems(newItems);
                        setHasUnsavedChanges(true);
                    }}
                />
            )}

            <Paper sx={{ p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight="bold">Notes Générales / Introduction</Typography>
                    {!readOnly && (
                        <Button
                            startIcon={<AutoAwesome />}
                            size="small"
                            onClick={handleGenerateSummary}
                            disabled={!meeting.audioRecording?.transcription && !(Array.isArray(meeting.audioRecordings) && meeting.audioRecordings.some(r => r.transcription))}
                            title="Rédiger un résumé d'introduction basé sur l'audio (attention : écrase le champ)"
                        >
                            Rédiger l'introduction (IA)
                        </Button>
                    )}
                </Box>
                <TextField
                    fullWidth
                    multiline
                    rows={4}
                    placeholder="Saisir les notes d'introduction, les présences particulières, etc."
                    value={globalNotes}
                    onChange={(e) => handleGlobalNotesChange(e.target.value)}
                    sx={{ mb: 3 }}
                    disabled={readOnly}
                />

                <Divider sx={{ my: 3 }} />

                <Typography variant="subtitle1" gutterBottom fontWeight="bold" sx={{ mb: 2 }}>Points de l'Ordre du Jour</Typography>

                <Grid container spacing={3}>
                    {localAgendaItems.slice(0, visibleCount).map((item, index) => (
                        <Grid size={{ xs: 12 }} key={item.id}>
                            <AgendaItemEditor
                                item={item}
                                index={index}
                                itemDecision={itemDecisions[item.id] || ''}
                                readOnly={readOnly}
                                onAgendaItemChange={handleAgendaItemChange}
                                onMinuteEntryChange={handleMinuteEntryChange}
                                onAddMinuteEntry={handleAddMinuteEntry}
                                onDeleteMinuteEntry={handleDeleteMinuteEntry}
                                onDecisionChange={handleDecisionChange}
                                meetingId={meeting.id}
                                meetingDate={meeting.date}
                                userRole={userRole}
                                documents={documents}
                            />
                        </Grid>
                    ))}
                </Grid>
            </Paper>

            <Snackbar
                open={showSaveSuccess}
                autoHideDuration={3000}
                onClose={() => setShowSaveSuccess(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity="success" sx={{ width: '100%' }}>
                    Procès-verbal enregistré avec succès
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default React.memo(MinutesEditor, (prevProps, nextProps) => {
    // Compare the fields that MinutesEditor actually uses
    return (
        prevProps.meeting.id === nextProps.meeting.id &&
        prevProps.meeting.minutes === nextProps.meeting.minutes &&
        prevProps.meeting.meetingNumber === nextProps.meeting.meetingNumber &&
        prevProps.meeting.date === nextProps.meeting.date &&
        prevProps.meeting.audioRecording?.transcription === nextProps.meeting.audioRecording?.transcription &&
        prevProps.meeting.audioRecording?.transcriptionStatus === nextProps.meeting.audioRecording?.transcriptionStatus &&
        prevProps.meeting.audioRecording?.storagePath === nextProps.meeting.audioRecording?.storagePath &&
        prevProps.meeting.minutesDraft === nextProps.meeting.minutesDraft &&
        prevProps.meeting.minutesFileUrl === nextProps.meeting.minutesFileUrl &&
        prevProps.onUpdate === nextProps.onUpdate &&
        prevProps.readOnly === nextProps.readOnly &&
        prevProps.documents === nextProps.documents &&
        // Deep array verification for audioRecordings to bypass reference equality issues
        prevProps.meeting.audioRecordings?.length === nextProps.meeting.audioRecordings?.length &&
        (prevProps.meeting.audioRecordings || []).every((rec, idx) => {
            const nextRec = nextProps.meeting.audioRecordings?.[idx];
            return rec.fileUrl === nextRec?.fileUrl &&
                   rec.transcriptionStatus === nextRec?.transcriptionStatus &&
                   rec.transcription === nextRec?.transcription;
        }) &&
        // Deep array verification for agendaItems to bypass reference equality issues
        prevProps.meeting.agendaItems?.length === nextProps.meeting.agendaItems?.length &&
        (prevProps.meeting.agendaItems || []).every((item, idx) => {
            const nextItem = nextProps.meeting.agendaItems?.[idx];
            return item.id === nextItem?.id &&
                   item.title === nextItem?.title &&
                   item.duration === nextItem?.duration &&
                   item.objective === nextItem?.objective &&
                   item.isRecommendationToCouncil === nextItem?.isRecommendationToCouncil &&
                   JSON.stringify(item.minuteEntries) === JSON.stringify(nextItem?.minuteEntries) &&
                   JSON.stringify(item.councilIncludedEntryIndices) === JSON.stringify(nextItem?.councilIncludedEntryIndices);
        })
    );
});
