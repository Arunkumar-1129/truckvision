/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  ai_service.js — YOLO Truck Classification               ║
 * ║  1. Direct Roboflow Workflow API via HTTP (fast & cloud)  ║
 * ║  2. Local Python fallback via yolo_infer.py               ║
 * ║  Classes: Mining Truck | Full Load | Empty Load           ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROBOFLOW_URL = "https://serverless.roboflow.com/aruns-workspace-6uoks/workflows/truck-load-astra-detection";
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY || "XqNmpHgIL0PjdJOQucVY";

const PYTHON = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
const INFER_SCRIPT = path.join(__dirname, "yolo_infer.py");

/**
 * Format raw class and confidence into dashboard-ready response
 */
function formatDetectionResult(bestClass, bestConf) {
  let classification = "Mining Truck";
  let reason = "";

  if (!bestClass || bestConf < 0.20) {
    classification = "Mining Truck";
    reason = "No truck or load detected with sufficient confidence. Truck may be a generic mining vehicle.";
  } else if (bestClass.toLowerCase().includes("overload") || bestClass.toLowerCase().includes("full")) {
    classification = "Overloaded";
    reason = `Truck bed detected as overloaded (${(bestConf * 100).toFixed(1)}% confidence). Load exceeds safe limits.`;
  } else if (bestClass.toLowerCase().includes("normal") || bestClass.toLowerCase().includes("empty")) {
    classification = "Empty Load";
    reason = `Truck bed detected as empty (${(bestConf * 100).toFixed(1)}% confidence). No material in dump bed.`;
  } else {
    classification = "Mining Truck";
    reason = `Detected class '${bestClass}' at ${(bestConf * 100).toFixed(1)}% — classified as general mining truck.`;
  }

  return {
    classification,
    confidence: parseFloat(bestConf.toFixed(4)),
    reason,
    raw_class: bestClass || "none",
    error: null,
  };
}

/**
 * Direct HTTP call to Roboflow Serverless API (no Python dependency needed).
 */
async function classifyViaHttp(imagePath) {
  const imageBase64 = fs.readFileSync(imagePath).toString("base64");
  const response = await axios.post(
    ROBOFLOW_URL,
    {
      inputs: {
        image: { type: "base64", value: imageBase64 },
        confidence: 0.4,
        iou_threshold: 0.3,
        class_agnostic_nms: false,
        max_detections: 1000,
      },
      use_cache: true,
    },
    {
      headers: {
        Authorization: `Bearer ${ROBOFLOW_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  const result = response.data;
  let bestClass = null;
  let bestConf = 0.0;

  if (Array.isArray(result.outputs) && result.outputs.length > 0) {
    const resDict = result.outputs[0];
    const preds = resDict?.predictions?.predictions;
    if (Array.isArray(preds)) {
      for (const p of preds) {
        const conf = p.confidence || 0;
        const clsName = p.class || "unknown";
        if (conf > bestConf) {
          bestConf = conf;
          bestClass = clsName;
        }
      }
    }
  }

  return formatDetectionResult(bestClass, bestConf);
}

/**
 * Local Python fallback using yolo_infer.py
 */
function classifyViaPython(imagePath) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn(PYTHON, [INFER_SCRIPT, imagePath], {
      cwd: __dirname,
      timeout: 60000,
    });

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("error", (err) => {
      console.error("[YOLO Python] Spawn error:", err.message);
      resolve({
        classification: "Mining Truck",
        confidence: 0,
        reason: "Python process failed to start: " + err.message,
        raw_class: "error",
        error: err.message,
      });
    });

    proc.on("close", (code) => {
      try {
        const lines = stdout.trim().split("\n").filter((l) => l.trim().startsWith("{"));
        if (lines.length === 0) throw new Error("No JSON output from yolo_infer.py");
        const parsed = JSON.parse(lines[lines.length - 1]);

        if (parsed.error) {
          resolve({
            classification: "Mining Truck",
            confidence: 0,
            reason: "YOLO error: " + parsed.error,
            raw_class: "error",
            error: parsed.error,
          });
        } else {
          resolve({
            classification: parsed.classification,
            confidence: parseFloat(parsed.confidence) || 0,
            reason: parsed.reason,
            raw_class: parsed.raw_class || "unknown",
            error: null,
          });
        }
      } catch (parseErr) {
        resolve({
          classification: "Mining Truck",
          confidence: 0,
          reason: "Failed to parse YOLO output: " + parseErr.message,
          raw_class: "error",
          error: parseErr.message,
        });
      }
    });
  });
}

/**
 * Primary entry point: tries direct HTTP first (fast, pure Node.js), falls back to Python.
 */
async function classifyTruckImage(imagePath) {
  try {
    return await classifyViaHttp(imagePath);
  } catch (httpErr) {
    console.warn("[AI Service] HTTP call failed, trying local Python fallback:", httpErr.message);
    try {
      return await classifyViaPython(imagePath);
    } catch (pyErr) {
      return {
        classification: "Mining Truck",
        confidence: 0,
        reason: "Inference failed: " + (httpErr.message || pyErr.message),
        raw_class: "error",
        error: httpErr.message,
      };
    }
  }
}

module.exports = { classifyTruckImage };
