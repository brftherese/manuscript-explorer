import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface PdfViewerProps {
  file: File | string;
  onPageRendered: (pageNumber: number, imageDataUrl: string) => void;
}

export default function PdfViewer({ file, onPageRendered }: PdfViewerProps) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    const loadPdf = async () => {
      try {
        setIsLoadingDocument(true);
        let loadingTask;
        if (typeof file === 'string') {
          // Fetch the file size first
          const headResponse = await fetch(file, { method: 'HEAD' });
          if (!headResponse.ok) {
            throw new Error(`Failed to fetch PDF headers: ${headResponse.status} ${headResponse.statusText}`);
          }
          const contentLength = parseInt(headResponse.headers.get('Content-Length') || '0', 10);
          
          if (contentLength > 0) {
            // Fetch the file in 5MB chunks to avoid proxy size limits
            const chunkSize = 5 * 1024 * 1024; // 5MB
            const chunks: Uint8Array[] = [];
            let downloadedBytes = 0;
            
            for (let start = 0; start < contentLength; start += chunkSize) {
              const end = Math.min(start + chunkSize - 1, contentLength - 1);
              const res = await fetch(file, {
                headers: { Range: `bytes=${start}-${end}` }
              });
              
              if (!res.ok && res.status !== 206) {
                throw new Error(`Failed to fetch PDF chunk: ${res.status} ${res.statusText}`);
              }
              
              const buffer = await res.arrayBuffer();
              chunks.push(new Uint8Array(buffer));
              downloadedBytes += buffer.byteLength;
            }
            
            const typedarray = new Uint8Array(contentLength);
            let offset = 0;
            for (const chunk of chunks) {
              typedarray.set(chunk, offset);
              offset += chunk.length;
            }
            
            loadingTask = pdfjsLib.getDocument(typedarray);
          } else {
            // Fallback if Content-Length is not available
            const response = await fetch(file);
            if (!response.ok) {
              throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const typedarray = new Uint8Array(arrayBuffer);
            loadingTask = pdfjsLib.getDocument(typedarray);
          }
        } else {
          const fileReader = new FileReader();
          const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
            fileReader.onload = () => resolve(fileReader.result as ArrayBuffer);
            fileReader.onerror = reject;
            fileReader.readAsArrayBuffer(file);
          });
          const typedarray = new Uint8Array(arrayBuffer);
          loadingTask = pdfjsLib.getDocument(typedarray);
        }
        
        const loadedPdf = await loadingTask.promise;
        setPdf(loadedPdf);
        setNumPages(loadedPdf.numPages);
        setPageNumber(1);
      } catch (error) {
        console.error('Error loading PDF:', error);
      } finally {
        setIsLoadingDocument(false);
      }
    };
    if (file) {
      loadPdf();
    }
  }, [file]);

  useEffect(() => {
    let isMounted = true;
    
    const renderPage = async () => {
      if (pdf && canvasRef.current) {
        setIsRendering(true);
        try {
          if (renderTaskRef.current) {
            await renderTaskRef.current.cancel();
            renderTaskRef.current = null;
          }

          const page = await pdf.getPage(pageNumber);
          // Use a higher scale for better OCR quality
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = canvasRef.current;
          const context = canvas.getContext('2d');
          
          if (!context) return;
          
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvasContext: context,
            viewport: viewport,
          };
          
          const renderTask = page.render(renderContext);
          renderTaskRef.current = renderTask;
          
          await renderTask.promise;
          
          if (isMounted) {
            const imageData = canvas.toDataURL('image/jpeg', 0.9);
            onPageRendered(pageNumber, imageData);
          }
        } catch (error: any) {
          if (error?.name === 'RenderingCancelledException') {
            // Expected when cancelling
            console.log('Rendering cancelled');
          } else {
            console.error('Error rendering page:', error);
          }
        } finally {
          if (isMounted) {
            setIsRendering(false);
          }
        }
      }
    };
    
    renderPage();
    
    return () => {
      isMounted = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNumber, onPageRendered]);

  return (
    <div className="flex flex-col items-center w-full h-full overflow-hidden">
      <div className="relative border border-zinc-200 shadow-sm rounded-lg overflow-hidden bg-white w-full flex-1 flex items-center justify-center min-h-0">
        {isLoadingDocument && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 z-20">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-4" />
            <p className="text-zinc-600 font-medium">Loading Manuscript...</p>
            <p className="text-zinc-400 text-sm mt-1">This may take a moment for large files</p>
          </div>
        )}
        {isRendering && !isLoadingDocument && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
          </div>
        )}
        <div className="w-full h-full overflow-auto flex items-center justify-center p-2">
          <canvas ref={canvasRef} className="max-w-full h-auto object-contain" style={{ maxHeight: '100%' }} />
        </div>
      </div>
      
      {numPages > 0 && (
        <div className="flex items-center gap-4 mt-3 bg-white px-4 py-1.5 rounded-full shadow-sm border border-zinc-200 shrink-0">
          <button
            onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
            disabled={pageNumber <= 1 || isRendering}
            className="p-1.5 rounded-full hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-zinc-700 min-w-[100px] text-center">
            Page {pageNumber} of {numPages}
          </span>
          <button
            onClick={() => setPageNumber(Math.min(numPages, pageNumber + 1))}
            disabled={pageNumber >= numPages || isRendering}
            className="p-1.5 rounded-full hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}
