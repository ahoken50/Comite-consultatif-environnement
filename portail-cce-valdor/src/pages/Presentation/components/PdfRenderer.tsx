import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker?url';

// Set worker source using Vite's ?url import
// This ensures the worker is bundled correctly and available at runtime
if (typeof window !== 'undefined' && (pdfjsLib as any).GlobalWorkerOptions) {
    (pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;
}

interface PdfRendererProps {
    url: string;
    onLoadComplete?: (totalPages: number) => void;
}

export const PdfRenderer: React.FC<PdfRendererProps> = ({ url, onLoadComplete }) => {
    const [pdf, setPdf] = useState<any | null>(null);
    const [pages, setPages] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadPdf = async () => {
            if (!url) return;

            setLoading(true);
            setError(null);
            try {
                // Fetch valid PDF data first to avoid "bs" (bad structure) errors from pdfjs
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();

                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const _pdf = await loadingTask.promise;
                setPdf(_pdf);

                const pageCount = _pdf.numPages;
                setPages(Array.from({ length: pageCount }, (_, i) => i + 1));

                if (onLoadComplete) onLoadComplete(pageCount);
            } catch (err: any) {
                console.error("Error loading PDF:", err);
                setError(err.message || "Erreur de chargement du PDF");
            } finally {
                setLoading(false);
            }
        };

        loadPdf();
    }, [url]);

    if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;
    if (error) return <Typography color="error">{error}</Typography>;

    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            pb: 4,
            width: '100%',
            bgcolor: '#f1f5f9' // Light gray background for contrast
        }}>
            {pages.map(pageNum => (
                <PdfPage key={pageNum} pdf={pdf} pageNum={pageNum} />
            ))}
        </Box>
    );
};

interface PdfPageProps {
    pdf: any | null;
    pageNum: number;
}

const PdfPage: React.FC<PdfPageProps> = ({ pdf, pageNum }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [rendered, setRendered] = useState(false);

    useEffect(() => {
        if (!pdf || !canvasRef.current || rendered) return;

        const renderPage = async () => {
            try {
                const page = await pdf.getPage(pageNum);

                // Calculate scale to fit width (max 1000px roughly or container width)
                // For 'Presentation Mode' we generally want high quality and readable text.
                // A scale of 2.0 ensures crisp text on high DPI screens.
                // Responsiveness is handled by CSS max-width.
                const scale = 2.0;
                const viewport = page.getViewport({ scale });

                const canvas = canvasRef.current;
                if (!canvas) return;

                const context = canvas.getContext('2d');
                if (!context) return;

                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const renderContext = {
                    canvasContext: context,
                    viewport: viewport,
                };

                await page.render(renderContext).promise;
                setRendered(true);
            } catch (err) {
                console.error(`Error rendering page ${pageNum}:`, err);
            }
        };

        renderPage();
    }, [pdf, pageNum, rendered]);

    // If pdf changes, reset rendered state
    useEffect(() => {
        setRendered(false);
    }, [pdf, pageNum]);

    return (
        <Box sx={{
            boxShadow: 4,
            bgcolor: 'white',
            maxWidth: '1000px', // Restrict max width to readable A4-like size
            width: '95%',
            borderRadius: 1,
            overflow: 'hidden'
        }}>
            {/* Aspect ratio placeholder or min-height could be added here */}
            <canvas
                ref={canvasRef}
                style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block'
                }}
            />
        </Box>
    );
};
