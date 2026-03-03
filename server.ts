import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import https from "https";

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 303) {
        downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
      } else {
        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
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
  if (!fs.existsSync(pdfPath)) {
    console.log("Downloading manuscript.pdf in the background...");
    downloadFile('https://drive.google.com/uc?export=download&id=1zEAkR7xd1iob5tuwTgazfFg6bcL7Pt_e', pdfPath)
      .then(() => console.log("Download complete."))
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
  } else if (!isProd) {
    // Try to load from project root if in dev, or if /tmp is empty
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
