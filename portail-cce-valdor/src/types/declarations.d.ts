declare module 'mammoth';
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
