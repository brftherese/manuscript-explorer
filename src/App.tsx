import React, { useState, useCallback, useEffect } from 'react';
import PdfViewer from './components/PdfViewer';
import { processPage } from './services/geminiService';
import { BookOpen, Languages, Loader2, Download, RefreshCw } from 'lucide-react';

export default function App() {
  const [file, setFile] = useState<File | string | null>('/manuscript.pdf');
  const [pageData, setPageData] = useState<{ [pageNumber: number]: { originalText: string; englishTranslation: string } }>({});
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [processingPages, setProcessingPages] = useState<Set<number>>(new Set());

  const processedPages = React.useRef<Set<number>>(new Set());
  const pageImages = React.useRef<Record<number, string>>({});

  const handlePageRendered = useCallback(async (pageNumber: number, imageDataUrl: string) => {
    setCurrentPage(pageNumber);
    pageImages.current[pageNumber] = imageDataUrl;
    if (!processedPages.current.has(pageNumber)) {
      processedPages.current.add(pageNumber);
      setProcessingPages(prev => new Set(prev).add(pageNumber));
      try {
        const res = await fetch(`/api/pages/${pageNumber}?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          setPageData(prev => ({ ...prev, [pageNumber]: data }));
        } else {
          const result = await processPage(imageDataUrl);
          setPageData(prev => ({ ...prev, [pageNumber]: result }));
          
          // Only cache successful results on the server
          if (!result.originalText.includes('API Rate Limit Exceeded') && !result.originalText.includes('Error extracting text') && !result.originalText.includes('An error occurred')) {
            await fetch(`/api/pages/${pageNumber}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result)
            });
          } else {
            // Allow retry on failure
            processedPages.current.delete(pageNumber);
          }
        }
      } catch (error) {
        console.error('Error processing page:', error);
        processedPages.current.delete(pageNumber); // Allow retry on failure
      } finally {
        setProcessingPages(prev => {
          const next = new Set(prev);
          next.delete(pageNumber);
          return next;
        });
      }
    }
  }, []);

  const handleRedoPage = useCallback(async () => {
    const imageDataUrl = pageImages.current[currentPage];
    if (!imageDataUrl || processingPages.has(currentPage)) return;
    processedPages.current.delete(currentPage);
    setPageData(prev => { const next = { ...prev }; delete next[currentPage]; return next; });
    setProcessingPages(prev => new Set(prev).add(currentPage));
    try {
      const result = await processPage(imageDataUrl);
      setPageData(prev => ({ ...prev, [currentPage]: result }));
      if (!result.originalText.includes('API Rate Limit Exceeded') && !result.originalText.includes('Error extracting text') && !result.originalText.includes('An error occurred')) {
        processedPages.current.add(currentPage);
        await fetch(`/api/pages/${currentPage}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result)
        });
      }
    } catch (error) {
      console.error('Error reprocessing page:', error);
    } finally {
      setProcessingPages(prev => { const next = new Set(prev); next.delete(currentPage); return next; });
    }
  }, [currentPage, processingPages]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setPageData({});
      processedPages.current.clear();
      setCurrentPage(1);
    } else {
      alert('Please upload a valid PDF file.');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans">
      <header className="bg-white border-b border-zinc-200 px-6 py-4 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
              <BookOpen className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Manuscript Explorer</h1>
          </div>
          
          <div>
            <a
              href="https://drive.google.com/uc?export=download&id=1zEAkR7xd1iob5tuwTgazfFg6bcL7Pt_e"
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              <span className="text-sm font-medium">Download Original Manuscript PDF</span>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        {!file ? (
          <div className="flex flex-col items-center justify-center h-[60vh] border-2 border-dashed border-zinc-300 rounded-2xl bg-white/50">
            <div className="p-4 bg-white rounded-full shadow-sm border border-zinc-100 mb-4">
              <BookOpen className="w-10 h-10 text-zinc-400" />
            </div>
            <h2 className="text-xl font-medium text-zinc-700 mb-2">No Document Loaded</h2>
            <p className="text-zinc-500 text-center max-w-md">
              Upload a PDF manuscript (like the Life of St. Kunegunde) to begin exploring its contents with AI-powered Latin translation.
            </p>
          </div>
        ) : (
          <div className="flex flex-col lg:grid lg:grid-cols-2 gap-4 lg:h-[calc(100vh-110px)]">
            {/* Left Column: PDF Viewer */}
            <div className="flex flex-col h-[60vh] lg:h-full overflow-hidden">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-2 shrink-0">
                <BookOpen className="w-4 h-4" /> Original Document
              </h2>
              <div className="flex-1 overflow-hidden bg-zinc-100 rounded-2xl p-2 border border-zinc-200 flex flex-col">
                <PdfViewer file={file} onPageRendered={handlePageRendered} />
              </div>
            </div>

            {/* Right Column: Extracted Text & Translation */}
            <div className="flex flex-col h-[70vh] lg:h-full overflow-hidden">
              <div className="grid grid-rows-2 gap-4 h-full">
                {/* Top Half: Original Text */}
                <div className="flex flex-col bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden h-full">
                  <div className="px-4 py-2 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between shrink-0">
                    <h2 className="text-sm font-semibold text-zinc-700 flex items-center gap-2">
                      <Languages className="w-4 h-4 text-zinc-500" /> Extracted Text (Latin)
                    </h2>
                    {processingPages.has(currentPage) && (
                      <span className="flex items-center gap-2 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
                        <Loader2 className="w-3 h-3 animate-spin" /> Processing Page...
                      </span>
                    )}
                    {!processingPages.has(currentPage) && pageData[currentPage] && (
                      <button
                        onClick={handleRedoPage}
                        className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-indigo-600 bg-zinc-100 hover:bg-indigo-50 px-2.5 py-1 rounded-full transition-colors"
                        title="Re-extract and re-translate this page"
                      >
                        <RefreshCw className="w-3 h-3" /> Redo Page
                      </button>
                    )}
                  </div>
                  <div className="p-4 overflow-y-auto flex-1 font-serif text-zinc-800 leading-relaxed text-base">
                    {pageData[currentPage]?.originalText ? (
                      <p className="whitespace-pre-wrap">{pageData[currentPage].originalText}</p>
                    ) : processingPages.has(currentPage) ? (
                      <div className="flex items-center justify-center h-full text-zinc-400 italic">
                        Extracting text...
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-zinc-400 italic">
                        No text extracted for this page.
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Half: English Translation */}
                <div className="flex flex-col bg-zinc-900 rounded-2xl border border-zinc-800 shadow-md overflow-hidden text-zinc-100 h-full">
                  <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between shrink-0">
                    <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                      English Translation
                    </h2>
                  </div>
                  <div className="p-4 overflow-y-auto flex-1 font-serif leading-relaxed text-base">
                    {pageData[currentPage]?.englishTranslation ? (
                      <p className="whitespace-pre-wrap text-zinc-300">{pageData[currentPage].englishTranslation}</p>
                    ) : processingPages.has(currentPage) ? (
                      <div className="flex items-center justify-center h-full text-zinc-600 italic">
                        Translating...
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-zinc-600 italic">
                        No translation available.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
