"""
╔══════════════════════════════════════════════════════════╗
║      Truck Overload Detection - YOLOv8 Predictor        ║
║      Model: best.pt  |  Classes: goods, truck           ║
╚══════════════════════════════════════════════════════════╝
"""

import os
import sys
import time
from pathlib import Path

# ─── Auto-install ultralytics if missing ────────────────────────────────────
try:
    from ultralytics import YOLO
except ImportError:
    print("\n[!] 'ultralytics' not found. Installing now...\n")
    os.system(f"{sys.executable} -m pip install ultralytics")
    from ultralytics import YOLO

try:
    import cv2
except ImportError:
    print("\n[!] 'opencv-python' not found. Installing now...\n")
    os.system(f"{sys.executable} -m pip install opencv-python")
    import cv2

# ─── Config ─────────────────────────────────────────────────────────────────
MODEL_PATH = Path(__file__).parent / "truck_overload_model" / "truck_overload_model" / "best.pt"
CLASS_NAMES = ["goods", "truck"]
CONFIG = {"conf": 0.25}   # mutable so menu() can update without global

# Colors per class (BGR for OpenCV)
CLASS_COLORS = {
    "goods":  (0, 200, 255),   # orange-ish
    "truck":  (0, 255, 100),   # green
}
COLOR_CONTOUR = (0, 255, 255)  # Yellow (BGR) – matches snapshot_001 style

BANNER = """
╔══════════════════════════════════════════════════════════╗
║      🚛  Truck Overload Detection  -  YOLOv8            ║
║      Model mAP@0.5 : 84.91%                             ║
║      Classes       : goods, truck                       ║
╚══════════════════════════════════════════════════════════╝
"""

def print_banner():
    print(BANNER)

def load_model():
    print(f"[+] Loading model from: {MODEL_PATH}")
    if not MODEL_PATH.exists():
        print(f"[ERROR] best.pt not found at: {MODEL_PATH}")
        sys.exit(1)
    model = YOLO(str(MODEL_PATH))
    print("[+] Model loaded successfully!\n")
    return model

import numpy as np

def draw_contour_outline(frame, x1, y1, x2, y2):
    """
    Draw a yellow polygon contour hugging the detected object silhouette
    inside the bounding box – matches snapshot_001.jpg style for Indian
    dump trucks loaded with rocks / mine material.
    """
    h, w = frame.shape[:2]
    rx1, ry1 = max(0, x1), max(0, y1)
    rx2, ry2 = min(w, x2), min(h, y2)
    if rx2 <= rx1 or ry2 <= ry1:
        return

    roi   = frame[ry1:ry2, rx1:rx2]
    gray  = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur  = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 40, 120)

    # Dilate to close the truck-body outline
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges  = cv2.dilate(edges, kernel, iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        cv2.rectangle(frame, (x1, y1), (x2, y2), COLOR_CONTOUR, 3)
        return

    largest = max(contours, key=cv2.contourArea)
    largest = largest + np.array([[[rx1, ry1]]])
    epsilon = 0.008 * cv2.arcLength(largest, True)
    approx  = cv2.approxPolyDP(largest, epsilon, True)
    cv2.drawContours(frame, [approx], -1, COLOR_CONTOUR, 3)

def draw_results(frame, results):
    """Draw yellow contour outline + colored label for each detected object."""
    for result in results:
        boxes = result.boxes
        if boxes is None:
            continue
        for box in boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf     = float(box.conf[0])
            cls_id   = int(box.cls[0])
            cls_name = CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else str(cls_id)
            color    = CLASS_COLORS.get(cls_name, (255, 255, 255))
            label    = f"{cls_name}  {conf:.2f}"

            # Yellow polygon contour (snapshot style)
            draw_contour_outline(frame, x1, y1, x2, y2)

            # Colored label box above contour
            (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.4, 1)
            cv2.rectangle(frame, (x1, y1 - lh - 10), (x1 + lw + 6, y1), color, -1)
            cv2.putText(frame, label, (x1 + 3, y1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    return frame

def predict_image(model, img_path):
    """Run prediction on a single image and display result."""
    img_path = Path(img_path.strip())
    if not img_path.exists():
        print(f"[ERROR] File not found: {img_path}")
        return

    print(f"\n[→] Running prediction on: {img_path.name}")
    start = time.time()
    results = model.predict(source=str(img_path), conf=CONFIG["conf"], verbose=False)
    elapsed = time.time() - start

    frame = cv2.imread(str(img_path))
    if frame is None:
        print("[ERROR] Could not read image with OpenCV.")
        return

    frame = draw_results(frame, results)

    # Print detections in terminal
    print(f"[✓] Inference time : {elapsed*1000:.1f} ms")
    for result in results:
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            print("[✓] No objects detected.")
        else:
            print(f"[✓] Detections ({len(boxes)} found):")
            for box in boxes:
                cls_id = int(box.cls[0])
                cls_name = CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else str(cls_id)
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                print(f"     • {cls_name:<10}  conf={conf:.2f}  box=[{x1},{y1},{x2},{y2}]")

    # Save output image
    out_path = img_path.parent / f"predicted_{img_path.name}"
    cv2.imwrite(str(out_path), frame)
    print(f"[✓] Saved result image: {out_path}")

    # Show image window
    window_title = f"Prediction - {img_path.name}  (Press any key to close)"
    cv2.imshow(window_title, frame)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

def predict_webcam(model):
    """Run real-time prediction on webcam feed."""
    print("\n[→] Starting webcam... Press 'Q' to quit, 'S' to save a snapshot.\n")
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] Could not open webcam.")
        return

    snapshot_count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        results = model.predict(source=frame, conf=CONFIG["conf"], verbose=False)
        frame = draw_results(frame, results)

        # FPS overlay
        cv2.putText(frame, "Q=Quit  S=Snapshot", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 2)

        cv2.imshow("Truck Overload Detection - Live", frame)
        key = cv2.waitKey(1) & 0xFF

        if key == ord('q') or key == ord('Q'):
            break
        elif key == ord('s') or key == ord('S'):
            snapshot_count += 1
            snap_path = Path(__file__).parent / f"snapshot_{snapshot_count:03d}.jpg"
            cv2.imwrite(str(snap_path), frame)
            print(f"[✓] Snapshot saved: {snap_path}")

    cap.release()
    cv2.destroyAllWindows()

def predict_video(model, video_path):
    """Run prediction on a video file."""
    video_path = Path(video_path.strip())
    if not video_path.exists():
        print(f"[ERROR] Video file not found: {video_path}")
        return

    print(f"\n[→] Processing video: {video_path.name}  (Press 'Q' to stop)\n")
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print("[ERROR] Could not open video.")
        return

    # Setup video writer
    width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps    = cap.get(cv2.CAP_PROP_FPS) or 30
    total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    out_path = video_path.parent / f"predicted_{video_path.name}"
    writer = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        results = model.predict(source=frame, conf=CONFIG["conf"], verbose=False)
        frame = draw_results(frame, results)
        writer.write(frame)

        frame_idx += 1
        progress = (frame_idx / total * 100) if total > 0 else 0
        print(f"\r[→] Frame {frame_idx}/{total}  ({progress:.1f}%)", end="", flush=True)

        cv2.imshow(f"Video: {video_path.name}  (Q to stop)", frame)
        if cv2.waitKey(1) & 0xFF in (ord('q'), ord('Q')):
            break

    cap.release()
    writer.release()
    cv2.destroyAllWindows()
    print(f"\n[✓] Saved output video: {out_path}")

def menu(model):
    print_banner()
    print(f"  Model   : {MODEL_PATH}")
    print(f"  Classes : {CLASS_NAMES}")
    print(f"  Conf    : {CONFIG["conf"]}\n")

    while True:
        print("┌─────────────────────────────────────┐")
        print("│  Choose prediction source:          │")
        print("│  [1] Image file                     │")
        print("│  [2] Video file                     │")
        print("│  [3] Webcam (live)                  │")
        print("│  [4] Change confidence threshold    │")
        print("│  [Q] Quit                           │")
        print("└─────────────────────────────────────┘")

        choice = input("  → Enter choice: ").strip().upper()

        if choice == "1":
            path = input("  → Enter image path (or drag & drop): ").strip().strip('"')
            predict_image(model, path)

        elif choice == "2":
            path = input("  → Enter video path (or drag & drop): ").strip().strip('"')
            predict_video(model, path)

        elif choice == "3":
            predict_webcam(model)

        elif choice == "4":
            try:
                val = float(input("  → Enter confidence (0.0 - 1.0): ").strip())
                if 0.0 <= val <= 1.0:
                    CONFIG["conf"] = val
                    print(f"[✓] Confidence threshold set to {val}")
                else:
                    print("[!] Value must be between 0.0 and 1.0")
            except ValueError:
                print("[!] Invalid number.")

        elif choice == "Q":
            print("\n[+] Bye! 👋\n")
            break
        else:
            print("[!] Invalid choice. Try again.\n")

if __name__ == "__main__":
    model = load_model()
    menu(model)
