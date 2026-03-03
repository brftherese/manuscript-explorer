import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import https from "https";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config({ path: '.env.local' });

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303) {
        downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
      } else if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
      } else {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const data = Buffer.concat(chunks);
          // Google Drive returns HTML for virus scan confirmation pages
          const text = data.toString('utf-8', 0, Math.min(data.length, 500));
          if (text.includes('confirm=') || text.includes('virus scan') || text.includes('too large')) {
            // Extract confirmation URL from the HTML
            const match = text.match(/href="(\/uc\?export=download[^"]+)"/);
            if (match) {
              const confirmUrl = 'https://drive.google.com' + match[1].replace(/&amp;/g, '&');
              downloadFile(confirmUrl, dest).then(resolve).catch(reject);
              return;
            }
          }
          // Check that it's actually a PDF (starts with %PDF)
          if (data.length > 100 && (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46)) {
            fs.writeFileSync(dest, data);
            resolve();
          } else if (data.length > 1000) {
            // Might be a valid file even without PDF header in some cases, save it
            fs.writeFileSync(dest, data);
            resolve();
          } else {
            reject(new Error('Downloaded file appears invalid (too small or not a PDF)'));
          }
        });
        response.on('error', reject);
      }
    }).on('error', reject);
  });
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);
  const isProd = process.env.NODE_ENV === "production";

  // Use /tmp in production to avoid read-only filesystem crashes
  const dataDir = isProd ? "/tmp" : process.cwd();
  const publicDir = isProd ? "/tmp" : path.resolve(process.cwd(), "public");

  try {
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
  } catch (e) {
    console.error("Failed to create public directory:", e);
  }

  const pdfPath = path.resolve(publicDir, "manuscript.pdf");
  const needsDownload = !fs.existsSync(pdfPath) || fs.statSync(pdfPath).size < 1000;
  if (needsDownload) {
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    console.log("Downloading manuscript.pdf in the background...");
    downloadFile('https://drive.google.com/uc?export=download&id=1zEAkR7xd1iob5tuwTgazfFg6bcL7Pt_e', pdfPath)
      .then(() => console.log("Download complete:", fs.statSync(pdfPath).size, "bytes"))
      .catch(err => console.error("Failed to download manuscript.pdf:", err));
  }

  app.use(express.json({ limit: '50mb' }));

  const dataFile = path.resolve(dataDir, "data.json");
  let pageData: Record<string, any> = {};
  if (fs.existsSync(dataFile)) {
    try {
      pageData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    } catch (e) {
      console.error("Failed to parse data.json", e);
    }
  }
  // In production, also try to load from bundled data.json if /tmp is empty
  if (Object.keys(pageData).length === 0) {
    const rootDataFile = path.resolve(process.cwd(), "data.json");
    if (fs.existsSync(rootDataFile)) {
      try {
        pageData = JSON.parse(fs.readFileSync(rootDataFile, 'utf-8'));
      } catch (e) {
        console.error("Failed to parse root data.json", e);
      }
    }
  }

  app.get('/api/pages/:pageNumber', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const pageNumber = req.params.pageNumber;
    if (pageData[pageNumber]) {
      res.json(pageData[pageNumber]);
    } else {
      res.status(404).json({ error: "Not found" });
    }
  });

  app.post('/api/pages/:pageNumber', (req, res) => {
    const pageNumber = req.params.pageNumber;
    pageData[pageNumber] = req.body;
    try {
      fs.writeFileSync(dataFile, JSON.stringify(pageData, null, 2));
    } catch (e) {
      console.error("Failed to save data.json", e);
    }
    res.json({ success: true });
  });

  // Server-side Gemini API endpoint
  const MODELS = ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
  
  app.post('/api/process', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }
    try {
      const { imageDataUrl } = req.body;
      if (!imageDataUrl) {
        return res.status(400).json({ error: 'imageDataUrl is required' });
      }
      const base64Data = imageDataUrl.split(',')[1];
      const mimeType = imageDataUrl.split(';')[0].split(':')[1];

      const ai = new GoogleGenAI({ apiKey });
      const config = {
        responseMimeType: 'application/json' as const,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            originalText: { type: Type.STRING, description: 'The extracted original text from the page.' },
            englishTranslation: { type: Type.STRING, description: 'The English translation of the extracted text.' },
          },
          required: ['originalText', 'englishTranslation'],
        },
      };
      const contents = {
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: 'Extract the original text (likely Latin) from this page, and provide an English translation of it. Return the result as JSON with "originalText" and "englishTranslation" fields. If the page is blank or contains no text, return empty strings.' },
        ],
      };

      let lastError: any;
      for (const model of MODELS) {
        try {
          console.log(`Trying model: ${model}`);
          const response = await ai.models.generateContent({ model, contents, config });
          const jsonStr = response.text?.trim() || '{}';
          return res.json(JSON.parse(jsonStr));
        } catch (e: any) {
          lastError = e;
          if (e?.status === 429 || e?.message?.includes('RESOURCE_EXHAUSTED')) {
            console.log(`${model} rate limited, trying next...`);
            continue;
          }
          throw e; // non-rate-limit error, don't retry
        }
      }
      // All models exhausted
      throw lastError;
    } catch (error: any) {
      console.error('Gemini API Error:', error);
      if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
        return res.status(429).json({
          originalText: 'API Rate Limit Exceeded. Please wait a moment and try again.',
          englishTranslation: 'API Rate Limit Exceeded. Please wait a moment and try again.',
        });
      }
      res.status(500).json({
        originalText: `Error processing page: ${error.message || 'Unknown error'}`,
        englishTranslation: `Error processing page: ${error.message || 'Unknown error'}`,
      });
    }
  });

  // Serve the large PDF file with proper streaming and range support
  app.get("/manuscript.pdf", (req, res) => {
    console.log(`[${req.method}] /manuscript.pdf - Range: ${req.headers.range}`);
    let filePath = path.resolve(publicDir, "manuscript.pdf");
    if (!fs.existsSync(filePath)) {
      filePath = path.resolve(process.cwd(), "dist/manuscript.pdf");
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.resolve(process.cwd(), "public/manuscript.pdf");
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }

    res.setHeader("X-Accel-Buffering", "no");
    res.sendFile(filePath);
  });

  // Vite middleware for development
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist", {
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    
    // SPA Fallback for any unknown routes
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.resolve(process.cwd(), 'dist/index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Fatal error during server startup:", err);
  process.exit(1);
});
