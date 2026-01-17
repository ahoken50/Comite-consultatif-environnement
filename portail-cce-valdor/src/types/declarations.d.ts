declare module 'mammoth';
declare module 'docx-preview';
declare module 'xlsx' {
    const value: any;
    export = value;
}
declare module 'turndown';
declare module 'html2pdf.js';
declare module 'react-firebase-hooks/auth';
declare module 'react-firebase-hooks/firestore';
declare module '@sentry/react';
declare module 'jspdf';
declare module 'jspdf-autotable';
declare module 'pdfjs-dist';
declare module 'pdfjs-dist/build/pdf.worker.entry';

// Firebase AI (Vertex AI) module declarations
declare module 'firebase/ai' {
    import { FirebaseApp } from 'firebase/app';

    export class VertexAIBackend {
        constructor();
    }

    export interface AIOptions {
        backend: VertexAIBackend;
    }

    export interface VertexAI {
        // Add methods as needed
    }

    export function getAI(app: FirebaseApp, options: AIOptions): VertexAI;
}
