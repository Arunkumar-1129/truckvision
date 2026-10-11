/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  ai_service.js — YOLO Truck Classification (Local)       ║
 * ║  Calls yolo_infer.py via child_process                   ║
 * ║  Classes: Mining Truck | Full Load | Empty Load           ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

const { spawn } = require("child_process");
const path = require("path");

const PYTHON      = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
const INFER_SCRIPT = path.join(__dirname, "yolo_infer.py");

/**
 * Classify a truck image using the local YOLO best.pt model.
 * @param {string} imagePath - Absolute path to the downloaded image on disk
 * @returns {Promise<{classification, confidence, reason, raw_class, error}>}
 */
function classifyTruckImage(imagePath) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn(PYTHON, [INFER_SCRIPT, imagePath], {
      cwd: __dirname,
      timeout: 60000,  // 60s max
    });

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("error", (err) => {
      console.error("[YOLO] Spawn error:", err.message);
      resolve({
        classification: "Mining Truck",
        confidence: 0,
        reason: "Python process failed to start: " + err.message,
        raw_class: "error",
        error: err.message,
      });
    });

    proc.on("close", (code) => {
      if (stderr) {
        // Filter out ultralytics progress noise but show real errors
        const realErrors = stderr.split("\n").filter(
          (l) => l.trim() && !l.includes("Ultralytics") && !l.includes("YOLO") && !l.includes("speed:")
        );
        if (realErrors.length > 0) {
          console.error("[YOLO] stderr:", realErrors.join("\n"));
        }
      }

      try {
        // Find the last JSON line in stdout (YOLO may print extra lines)
        const lines = stdout.trim().split("\n").filter((l) => l.trim().startsWith("{"));
        if (lines.length === 0) throw new Error("No JSON output from yolo_infer.py");
        const parsed = JSON.parse(lines[lines.length - 1]);

        if (parsed.error) {
          console.error("[YOLO] Inference error:", parsed.error);
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
            confidence:     parseFloat(parsed.confidence) || 0,
            reason:         parsed.reason,
            raw_class:      parsed.raw_class || "unknown",
            error:          null,
          });
        }
      } catch (parseErr) {
        console.error("[YOLO] JSON parse error:", parseErr.message, "\nOutput was:", stdout);
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

module.exports = { classifyTruckImage };
