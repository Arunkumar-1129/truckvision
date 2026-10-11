/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  server.js — Express Backend + Supabase Polling          ║
 * ║  Polls truck-images bucket every N seconds               ║
 * ║  Classifies new images via local YOLO best.pt            ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const axios    = require("axios");
const fs       = require("fs");
const path     = require("path");
const os       = require("os");
const { createClient } = require("@supabase/supabase-js");
const { classifyTruckImage } = require("./ai_service");

// ── Validation ──────────────────────────────────────────────────────────────
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
const missing = REQUIRED_ENV.filter(
  (k) => !process.env[k] || process.env[k].includes("your-")
);
if (missing.length > 0) {
  console.error(`\n[ERROR] Missing env variables: ${missing.join(", ")}`);
  console.error(`        Please fill in your .env file.\n`);
  process.exit(1);
}

// ── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Admin client uses service role key to bypass RLS (for server-side listing)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const BUCKET        = process.env.SUPABASE_BUCKET   || "truck-images";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "5000");
const PORT          = parseInt(process.env.PORT          || "3001");
const TMP_DIR       = path.join(os.tmpdir(), "truck_vision");

// Ensure temp dir exists
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── In-memory store ───────────────────────────────────────────────────────────
let detectionHistory = [];
let latestDetection  = null;
let lastSeenFile     = null;
let isPolling        = false;
let pollingError     = null;
let connectedClients = [];

// ── SSE ───────────────────────────────────────────────────────────────────────
function broadcastToClients(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  connectedClients = connectedClients.filter((res) => !res.writableEnded);
  connectedClients.forEach((res) => {
    try { res.write(payload); } catch (_) {}
  });
}

// ── Core polling ──────────────────────────────────────────────────────────────
async function detectAndClassify() {
  try {
    // 1. List bucket contents, newest first
    const { data: files, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list("", { limit: 20, sortBy: { column: "created_at", order: "desc" } });

    if (error) {
      pollingError = error.message;
      console.error("[Supabase] List error:", error.message);
      broadcastToClients("status_update", { isPolling, pollingError, totalDetections: detectionHistory.length });
      return;
    }

    pollingError = null;

    if (!files || files.length === 0) {
      console.log("[Supabase] Bucket empty.");
      return;
    }

    // Filter images only
    const imageFiles = files.filter((f) =>
      /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(f.name)
    );
    if (imageFiles.length === 0) return;

    const newestFile = imageFiles[0];
    if (lastSeenFile === newestFile.name) return;  // Already processed

    console.log(`\n[NEW IMAGE] ${newestFile.name}`);
    lastSeenFile = newestFile.name;

    // 2. Download image to temp file
    const { data: signedData, error: signedErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(newestFile.name, 3600);

    if (signedErr || !signedData?.signedUrl) {
      console.error("[Supabase] Signed URL error:", signedErr?.message);
      pollingError = signedErr?.message || "Could not generate signed URL";
      return;
    }

    const signedUrl = signedData.signedUrl;
    const ext       = path.extname(newestFile.name) || ".jpg";
    const tmpPath   = path.join(TMP_DIR, `latest${ext}`);

    let mimeType = "image/jpeg";
    let fileSize = 0;
    try {
      const imgResp = await axios.get(signedUrl, {
        responseType: "arraybuffer",
        timeout: 20000,
      });
      fs.writeFileSync(tmpPath, Buffer.from(imgResp.data));
      fileSize = imgResp.data.byteLength;
      mimeType = (imgResp.headers["content-type"] || "image/jpeg").split(";")[0].trim();
      console.log(`[Download] ${(fileSize / 1024).toFixed(1)} KB  →  ${tmpPath}`);
    } catch (dlErr) {
      console.error("[Download] Error:", dlErr.message);
      pollingError = "Failed to download image: " + dlErr.message;
      return;
    }

    // 3. Get public URL for display
    const { data: publicData } = supabaseAdmin.storage
      .from(BUCKET)
      .getPublicUrl(newestFile.name);
    const displayUrl = publicData?.publicUrl || signedUrl;

    // 4. Run AI classification
    console.log("[YOLO] Classifying image...");
    const aiResult = await classifyTruckImage(tmpPath);
    console.log(`[YOLO] → ${aiResult.classification}  (${(aiResult.confidence * 100).toFixed(1)}%)  raw: ${aiResult.raw_class}`);

    // 5. Build detection record
    const detection = {
      id:             Date.now(),
      timestamp:      new Date().toISOString(),
      filename:       newestFile.name,
      imageUrl:       displayUrl,
      signedUrl,
      classification: aiResult.classification,
      confidence:     aiResult.confidence,
      reason:         aiResult.reason,
      raw_class:      aiResult.raw_class,
      error:          aiResult.error,
      fileSize,
      model:          "YOLOv8 (best.pt)",
    };

    latestDetection = detection;
    detectionHistory.unshift(detection);
    if (detectionHistory.length > 50) detectionHistory.pop();

    // 6. Push to SSE clients
    broadcastToClients("new_detection", detection);
    broadcastToClients("status_update", {
      isPolling,
      pollingError,
      totalDetections: detectionHistory.length,
    });

  } catch (err) {
    pollingError = err.message;
    console.error("[Polling] Unexpected error:", err.message);
  }
}

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    service: "TruckVision Backend API",
    status: "online",
    healthCheck: "/health",
    stream: "/api/stream",
    bucket: BUCKET,
  });
});

app.get("/health", (req, res) => {
  res.json({
    status:          "ok",
    isPolling,
    pollingError,
    totalDetections: detectionHistory.length,
    lastSeenFile,
    bucket:          BUCKET,
    pollInterval:    POLL_INTERVAL,
    model:           "YOLOv8 (best.pt)",
  });
});

app.get("/api/latest", (req, res) => {
  res.json({ detection: latestDetection });
});

app.get("/api/history", (req, res) => {
  const limit = parseInt(req.query.limit || "20");
  res.json({ history: detectionHistory.slice(0, limit), total: detectionHistory.length });
});

// ── All bucket images (for gallery view) ─────────────────────────────────────
app.get("/api/bucket-images", async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || "200"), 500);
    const offset = parseInt(req.query.offset || "0");

    // Use admin client to bypass RLS — listing requires service role
    const { data: files, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list("", { limit, offset, sortBy: { column: "created_at", order: "desc" } });

    if (error) return res.status(500).json({ error: error.message });

    const imageFiles = (files || []).filter((f) =>
      /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(f.name)
    );

    if (imageFiles.length === 0) {
      return res.json({ images: [], total: 0, bucket: BUCKET });
    }

    // Batch-generate signed URLs in ONE API call
    const { data: signedList } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrls(imageFiles.map((f) => f.name), 3600);

    const signedMap = {};
    if (signedList) {
      signedList.forEach((s) => { signedMap[s.path] = s.signedUrl; });
    }

    const images = imageFiles.map((f) => {
      const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(f.name);
      return {
        name:      f.name,
        id:        f.id,
        size:      f.metadata?.size || 0,
        mimeType:  f.metadata?.mimetype || "image/jpeg",
        createdAt: f.created_at,
        updatedAt: f.updated_at,
        publicUrl: pub?.publicUrl   || null,
        signedUrl: signedMap[f.name] || null,
      };
    });

    res.json({ images, total: images.length, bucket: BUCKET });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/trigger", async (req, res) => {
  res.json({ message: "Manual trigger initiated" });
  lastSeenFile = null;   // Force re-process of latest image
  await detectAndClassify();
});

// SSE — real-time stream
app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ message: "Connected to TruckVision stream", model: "YOLOv8" })}\n\n`);

  if (latestDetection) {
    res.write(`event: new_detection\ndata: ${JSON.stringify(latestDetection)}\n\n`);
  }
  res.write(`event: status_update\ndata: ${JSON.stringify({ isPolling, pollingError, totalDetections: detectionHistory.length })}\n\n`);

  connectedClients.push(res);
  console.log(`[SSE] Client connected. Total: ${connectedClients.length}`);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(`: heartbeat\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    connectedClients = connectedClients.filter((c) => c !== res);
    console.log(`[SSE] Client disconnected. Total: ${connectedClients.length}`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  TruckVision Backend — YOLO Edition                 ║`);
  console.log(`║  Server   : http://localhost:${PORT}                   ║`);
  console.log(`║  Bucket   : ${BUCKET}                         ║`);
  console.log(`║  Model    : YOLOv8 best.pt (local)                  ║`);
  console.log(`║  Polling  : every ${(POLL_INTERVAL / 1000).toFixed(0)}s                             ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);

  isPolling = true;
  detectAndClassify();
  setInterval(detectAndClassify, POLL_INTERVAL);
});
