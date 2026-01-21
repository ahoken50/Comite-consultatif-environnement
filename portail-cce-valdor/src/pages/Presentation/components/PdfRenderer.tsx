import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import * as pdfjsLib from 'pdfjs-dist';

// Use a fixed version matching package.json or a reliable CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface PdfRendererProps {
    url: string;
    onLoadComplete?: (totalPages: number) => void;
}

export const PdfRenderer: React.FC<PdfRendererProps> = ({ url, onLoadComplete }) => {
    // Use 'any' type to avoid TS errors with pdfjs-dist types in this setup
    const [pdf, setPdf] = useState<any | null>(null);
    const [pages, setPages] = useState<number[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadPdf = async () => {
            setLoading(true);
            setError(null);
            try {
                const loadingTask = pdfjsLib.getDocument(url);
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

        if (url) loadPdf();
    }, [url]);

    if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;
    if (error) return <Typography color="error">{error}</Typography>;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, pb: 4, width: '100%' }}>
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
                // Scale 1.5 for better quality
                const scale = 1.5;
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
    }, [pdf, pageNum]);

    return (
        <Box sx={{ boxShadow: 3, bgcolor: 'white' }}>
            <canvas ref={canvasRef} style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
        </Box>
    );
};
