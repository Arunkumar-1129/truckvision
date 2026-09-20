"""
╔══════════════════════════════════════════════════════════════╗
║   Truck Overload + Number Plate Detection v2                ║
║   Features:                                                  ║
║     • Overload detection (overloaded / normal)              ║
║     • Indian number plate OCR (EasyOCR)                     ║
║     • CSV log of all detections                             ║
╚══════════════════════════════════════════════════════════════╝
"""

import os
import sys
import re
import csv
import time
from pathlib import Path
from datetime import datetime

# ─── Auto-install ─────────────────────────────────────────────────────────────
def pip(pkg):
    import sys, os
    os.system(f'"{sys.executable}" -m pip install {pkg} -q')

try:
    import easyocr
    EASYOCR_OK = True
except ImportError:
    pip("easyocr")
    try:
        import easyocr
        EASYOCR_OK = True
    except:
        EASYOCR_OK = False

try:
    from ultralytics import YOLO
except ImportError:
    pip("ultralytics"); from ultralytics import YOLO

try:
    import cv2
except ImportError:
    pip("opencv-python==4.10.0.84"); import cv2

try:
    import numpy as np
except ImportError:
    pip("numpy"); import numpy as np

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE       = Path(__file__).parent
V2_MODEL   = BASE / "best.pt"
V1_MODEL   = BASE / "truck_overload_model" / "truck_overload_model" / "best.pt"
LOG_CSV    = BASE / "detection_log.csv"

# ─── Config ───────────────────────────────────────────────────────────────────
CONFIG = {
    "conf":          0.20,   # Lowered for the quickly-trained V2 video model
    "plate_conf":    0.30,
    "log_enabled":   True,
}

# Indian plate regex patterns
PLATE_PATTERNS = [
    r"[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{1,4}",   # Standard: MH 12 AB 1234
    r"[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}",                  # Compact: MH12AB1234
    r"\d{2}BH\d{4}[A-Z]{1,2}",                         # BH series
]

# Colors (BGR)
COLOR_OVERLOADED = (0, 0, 220)      # Red
COLOR_NORMAL     = (0, 200, 80)     # Green
COLOR_PLATE      = (255, 160, 0)    # Blue
COLOR_TEXT_BG    = (20, 20, 20)     # Dark

# ─── Model loading ────────────────────────────────────────────────────────────
def load_overload_model():
    if V2_MODEL.exists():
        path = V2_MODEL
        label = "v2 (retrained YOLOv8s)"
        classes = ["overloaded_truck", "normal_truck"]
    elif V1_MODEL.exists():
        path = V1_MODEL
        label = "v1 (goods/truck — using geometry logic)"
        classes = ["goods", "truck"]
    else:
        print("[ERROR] No model found! Run train_v2.py first.")
        sys.exit(1)

    print(f"[+] Loading overload model: {label}")
    model = YOLO(str(path))
    return model, classes

def load_plate_reader():
    """Load EasyOCR reader for Indian plates."""
    if not EASYOCR_OK:
        print("[!] easyocr not available. Plate reading disabled.")
        return None
    print("[+] Loading EasyOCR (first run downloads models ~100MB)...")
    try:
        # Load English with detail=0 for faster extraction
        reader = easyocr.Reader(['en'], gpu=False, verbose=False)
        print("[+] EasyOCR ready.")
        return reader
    except Exception as e:
        print(f"[!] EasyOCR failed to load: {e}")
        return None

# ─── CSV Logging ──────────────────────────────────────────────────────────────
def init_csv():
    if not LOG_CSV.exists():
        with open(LOG_CSV, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["timestamp", "source", "plate_number", "overload_status", "confidence", "frame_no"])
        print(f"[+] CSV log created: {LOG_CSV}")

LAST_LOGGED = {}

def log_detection(source, plate, status, conf, frame_no=0):
    if not CONFIG["log_enabled"]:
        return
        
    # Debounce: avoid spamming log for the same truck every frame (10 second cooldown)
    now = time.time()
    log_key = (plate, status)
    if log_key in LAST_LOGGED:
        if now - LAST_LOGGED[log_key] < 10.0:  # 10 second cooldown
            return
    LAST_LOGGED[log_key] = now
    
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_CSV, "a", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([ts, source, plate, status, f"{conf:.3f}", frame_no])

# ─── OCR helpers ──────────────────────────────────────────────────────────────
def is_indian_plate(text):
    """Check if text matches Indian plate format."""
    clean = text.upper().replace(" ", "").replace("-", "")
    for pattern in PLATE_PATTERNS:
        if re.search(pattern, clean):
            return True
    # Loose match: 2 letters + digits + letters + digits ≥ 8 chars
    if re.search(r"[A-Z]{2}\d+[A-Z]+\d+", clean) and len(clean) >= 7:
        return True
    return False

def read_plate_from_region(reader, frame, x1, y1, x2, y2):
    """Extract yellow regions from the truck and read plate text with EasyOCR."""
    if reader is None:
        return "N/A"
    # Add padding
    h, w = frame.shape[:2]
    pad = 10
    rx1 = max(0, x1 - pad)
    ry1 = max(0, y1 - pad)
    rx2 = min(w, x2 + pad)
    ry2 = min(h, y2 + pad)
    crop = frame[ry1:ry2, rx1:rx2]
    if crop.size == 0:
        return "N/A"

    # Filter for yellow (Indian commercial plates)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    lower_yellow = np.array([15, 50, 50])
    upper_yellow = np.array([45, 255, 255])
    yellow_mask = cv2.inRange(hsv, lower_yellow, upper_yellow)

    # Use yellow mask to extract potential plate regions
    contours, _ = cv2.findContours(yellow_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    candidates = []
    
    # Helper to run EasyOCR
    def ocr_img(img):
        res = reader.readtext(img, detail=0, allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
        return "".join(res) if res else None

    # Test full crop as fallback
    gray_full = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    full_text = ocr_img(gray_full)
    if full_text:
        candidates.append(full_text)

    if contours:
        for c in contours:
            if cv2.contourArea(c) > 300:  # Ignore tiny yellow specks
                px, py, pw, ph = cv2.boundingRect(c)
                # Expand bounding box slightly
                px = max(0, px - 5)
                py = max(0, py - 5)
                pw = min(crop.shape[1] - px, pw + 10)
                ph = min(crop.shape[0] - py, ph + 10)
                
                plate_roi = crop[py:py+ph, px:px+pw]
                if plate_roi.size > 0:
                    plate_roi = cv2.resize(plate_roi, (plate_roi.shape[1]*2, plate_roi.shape[0]*2), interpolation=cv2.INTER_CUBIC)
                    text = ocr_img(plate_roi)
                    if text:
                        candidates.append(text)

    # Clean up and check candidates
    valid_texts = []
    for text in candidates:
        text = text.upper().replace(" ", "").replace("-", "").replace(".", "").replace("\n", "")
        # Remove non-alphanumeric chars
        text = re.sub(r'[^A-Z0-9]', '', text)
        if len(text) >= 6:
            valid_texts.append(text)
            
    if not valid_texts:
        return "N/A"
        
    # Prefer Indian plate format
    for text in valid_texts:
        if is_indian_plate(text):
            return text
            
    return valid_texts[0]  # First candidate if no format match

def scan_frame_for_plates(reader, frame, truck_boxes):
    """
    For each truck bounding box, scan the lower 35% for a plate.
    Returns dict: {truck_idx: plate_text}
    """
    results = {}
    for i, (x1, y1, x2, y2) in enumerate(truck_boxes):
        height = y2 - y1
        # Plate is typically in the lower 35% of the truck bbox
        plate_y1 = y2 - int(height * 0.40)
        plate_y2 = y2
        plate_x1 = x1
        plate_x2 = x2
        plate_text = read_plate_from_region(reader, frame, plate_x1, plate_y1, plate_x2, plate_y2)
        results[i] = plate_text
    return results

# ─── Draw helpers ─────────────────────────────────────────────────────────────
COLOR_CONTOUR = (0, 255, 255)   # Yellow (BGR) – matches snapshot style

def draw_label(frame, text, x1, y1, color, text_color=(255,255,255), scale=0.45, thickness=1):
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
    # Keep label inside frame
    lx1 = max(0, x1)
    ly1 = max(th + 10, y1)
    cv2.rectangle(frame, (lx1, ly1 - th - 6), (lx1 + tw + 6, ly1), color, -1)
    cv2.putText(frame, text, (lx1 + 3, ly1 - 3),
                cv2.FONT_HERSHEY_SIMPLEX, scale, text_color, thickness)

def draw_truck_contour(frame, x1, y1, x2, y2):
    """
    Draw a yellow polygon contour hugging the truck silhouette inside the
    bounding box – mimics the snapshot_001.jpg style for Indian dump trucks
    loaded with rocks / mine material.
    """
    h, w = frame.shape[:2]
    # Clamp bbox to frame
    rx1, ry1 = max(0, x1), max(0, y1)
    rx2, ry2 = min(w, x2), min(h, y2)
    if rx2 <= rx1 or ry2 <= ry1:
        return

    roi = frame[ry1:ry2, rx1:rx2]

    # Edge detection on the ROI
    gray  = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur  = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 40, 120)

    # Dilate edges slightly so contour closes over the truck body
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges  = cv2.dilate(edges, kernel, iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        # Fallback: draw plain yellow rectangle
        cv2.rectangle(frame, (x1, y1), (x2, y2), COLOR_CONTOUR, 3)
        return

    # Pick the largest contour (truck body)
    largest = max(contours, key=cv2.contourArea)

    # Shift contour coords back to full-frame space
    largest = largest + np.array([[[rx1, ry1]]])

    # Smooth the contour slightly so it looks like the snapshot outline
    epsilon  = 0.008 * cv2.arcLength(largest, True)
    approx   = cv2.approxPolyDP(largest, epsilon, True)

    cv2.drawContours(frame, [approx], -1, COLOR_CONTOUR, 3)

def draw_truck(frame, x1, y1, x2, y2, status, conf, plate, color):
    # Yellow contour outline (snapshot style)
    draw_truck_contour(frame, x1, y1, x2, y2)

    # Colored status label above the truck
    label_top   = f"{'OVERLOADED!' if status == 'OVERLOADED' else 'NORMAL'}  {conf:.0%}"
    label_plate = f"PLATE: {plate}"
    draw_label(frame, label_top,  x1, y1, color)
    draw_label(frame, label_plate, x1, y2 + 18, COLOR_PLATE, scale=0.40)

def draw_status_bar(frame, status, plate, conf):
    """Overlay status bar at top of frame."""
    h, w = frame.shape[:2]
    bar_h = 32
    overlay = frame.copy()
    if status == "OVERLOADED":
        bar_color = (0, 0, 180)
    elif status == "NORMAL":
        bar_color = (0, 130, 50)
    else:
        bar_color = (50, 50, 50)
    cv2.rectangle(overlay, (0, 0), (w, bar_h), bar_color, -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
    ts = datetime.now().strftime("%H:%M:%S")
    status_txt = f"  {status}  |  Plate: {plate}  |  Conf: {conf:.0%}  |  {ts}"
    cv2.putText(frame, status_txt, (10, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.50, (255,255,255), 1)

# ─── Detection logic ──────────────────────────────────────────────────────────
def determine_overload_v2(cls_name, conf):
    """For v2 model with overloaded_truck/normal_truck classes."""
    if cls_name == "overloaded_truck":
        return "OVERLOADED", COLOR_OVERLOADED
    else:
        return "NORMAL", COLOR_NORMAL

def determine_overload_v1(detections, frame=None):
    """
    For v1 model (goods + truck classes).
    A truck is considered OVERLOADED if a 'goods' bounding box overlaps it horizontally.
    """
    trucks = [(x1,y1,x2,y2,c) for cls,x1,y1,x2,y2,c in detections if cls == "truck"]
    goods  = [(x1,y1,x2,y2,c) for cls,x1,y1,x2,y2,c in detections if cls == "goods"]

    results = []
    for tx1,ty1,tx2,ty2,tc in trucks:
        overloaded = False
        tcx = (tx1 + tx2) / 2
        tcy = (ty1 + ty2) / 2
        truck_w = tx2 - tx1

        if goods:
            for gx1,gy1,gx2,gy2,_ in goods:
                gcx = (gx1 + gx2) / 2
                gcy = (gy1 + gy2) / 2
                # Calculate distance between truck center and goods center
                dist = ((tcx - gcx)**2 + (tcy - gcy)**2)**0.5
                
                # If goods are within 3 truck-widths, they belong to this truck
                if dist < truck_w * 3.0:
                    overloaded = True
                    break

        status = "OVERLOADED" if overloaded else "NORMAL"
        color  = COLOR_OVERLOADED if overloaded else COLOR_NORMAL
        results.append((tx1,ty1,tx2,ty2, status, color))
    return results

def process_frame(frame, model, classes, reader, source_name, frame_no, use_v2):
    results      = model.predict(source=frame, conf=CONFIG["conf"], verbose=False)
    any_status   = "NO TRUCK"
    best_conf    = 0.0
    best_plate   = "N/A"

    if use_v2:
        # V2: direct overload classification
        truck_boxes = []
        statuses    = []
        confs       = []

        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls_id   = int(box.cls[0])
                cls_name = classes[cls_id] if cls_id < len(classes) else "unknown"
                conf     = float(box.conf[0])
                x1,y1,x2,y2 = map(int, box.xyxy[0].tolist())
                status, color = determine_overload_v2(cls_name, conf)
                truck_boxes.append((x1,y1,x2,y2))
                statuses.append((status, color, conf))
                if conf > best_conf:
                    best_conf  = conf
                    any_status = status

        # Read plates
        plate_map = scan_frame_for_plates(reader, frame, truck_boxes)

        for i, (x1,y1,x2,y2) in enumerate(truck_boxes):
            status, color, conf = statuses[i]
            plate = plate_map.get(i, "N/A")
            draw_truck(frame, x1,y1,x2,y2, status, conf, plate, color)
            if conf > 0:
                log_detection(source_name, plate, status, conf, frame_no)
            if conf == best_conf:
                best_plate = plate

    else:
        # V1: geometry-based overload logic (with fallback cases)
        detections = []
        truck_boxes = []
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls_id   = int(box.cls[0])
                cls_name = classes[cls_id] if cls_id < len(classes) else "unknown"
                conf     = float(box.conf[0])
                x1,y1,x2,y2 = map(int, box.xyxy[0].tolist())
                detections.append((cls_name,x1,y1,x2,y2,conf))
                if cls_name == "truck":
                    truck_boxes.append((x1,y1,x2,y2))
                # goods bbox: treat as truck box too for plate scanning
                if cls_name == "goods":
                    truck_boxes.append((x1,y1,x2,y2))

        # Pass frame so truck-only case can use fill-ratio heuristic
        overload_results = determine_overload_v1(detections, frame=frame)
        plate_map = scan_frame_for_plates(reader, frame, truck_boxes)

        for i, (tx1,ty1,tx2,ty2,status,color) in enumerate(overload_results):
            plate = plate_map.get(i, "N/A")
            # Best conf from truck OR goods detection
            conf = max(
                (c for cls,x1,y1,x2,y2,c in detections if cls in ("truck","goods")),
                default=0.0
            )
            draw_truck(frame, tx1,ty1,tx2,ty2, status, conf, plate, color)
            log_detection(source_name, plate, status, conf, frame_no)
            if conf > best_conf:
                best_conf  = conf
                any_status = status
                best_plate = plate

    draw_status_bar(frame, any_status, best_plate, best_conf)
    return frame, any_status, best_plate, best_conf

# ─── Prediction modes ─────────────────────────────────────────────────────────
def predict_image(model, classes, reader, img_path, use_v2):
    img_path = Path(img_path.strip().strip('"'))
    if not img_path.exists():
        print(f"[ERROR] Not found: {img_path}")
        return

    print(f"\n[→] Processing image: {img_path.name}")
    frame = cv2.imread(str(img_path))
    if frame is None:
        print("[ERROR] Cannot read image.")
        return

    t0 = time.time()
    frame, status, plate, conf = process_frame(
        frame, model, classes, reader, img_path.name, 0, use_v2)
    ms = (time.time()-t0)*1000

    # Terminal output
    print(f"  Status   : {status}")
    print(f"  Plate    : {plate}")
    print(f"  Conf     : {conf:.2%}")
    print(f"  Time     : {ms:.1f} ms")

    # Save
    out = img_path.parent / f"predicted_{img_path.name}"
    cv2.imwrite(str(out), frame)
    print(f"  Saved    : {out}")

    cv2.imshow(f"Result - {img_path.name}  (press any key)", frame)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


def predict_webcam(model, classes, reader, use_v2):
    print("\n[→] Starting webcam... Press Q=quit, S=snapshot\n")
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERROR] No webcam found.")
        return

    snap_n = 0
    frame_n = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame, status, plate, conf = process_frame(
            frame, model, classes, reader, "webcam", frame_n, use_v2)
        frame_n += 1
        cv2.imshow("Truck Overload Detection v2 - Live  (Q=quit)", frame)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), ord('Q')):
            break
        elif key in (ord('s'), ord('S')):
            snap_n += 1
            p = BASE / f"snapshot_{snap_n:03d}.jpg"
            cv2.imwrite(str(p), frame)
            print(f"[✓] Snapshot saved: {p}")

    cap.release()
    cv2.destroyAllWindows()


def predict_video(model, classes, reader, video_path, use_v2):
    video_path = Path(video_path.strip().strip('"'))
    if not video_path.exists():
        print(f"[ERROR] Not found: {video_path}")
        return

    cap    = cv2.VideoCapture(str(video_path))
    w      = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h      = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps    = cap.get(cv2.CAP_PROP_FPS) or 30
    total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    out_p  = video_path.parent / f"predicted_{video_path.name}"
    writer = cv2.VideoWriter(str(out_p), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    print(f"\n[→] Processing: {video_path.name}  ({total} frames)  Q=stop\n")
    fn = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame, status, plate, conf = process_frame(
            frame, model, classes, reader, video_path.name, fn, use_v2)
        writer.write(frame)
        fn += 1
        pct = fn/total*100 if total > 0 else 0
        print(f"\r  Frame {fn}/{total}  ({pct:.1f}%)  {status}  {plate}", end="", flush=True)
        cv2.imshow(f"Video: {video_path.name}  (Q=stop)", frame)
        if cv2.waitKey(1) & 0xFF in (ord('q'), ord('Q')):
            break

    cap.release()
    writer.release()
    cv2.destroyAllWindows()
    print(f"\n[✓] Saved: {out_p}")


# ─── Menu ─────────────────────────────────────────────────────────────────────
BANNER = """
╔══════════════════════════════════════════════════════════════╗
║   Truck Overload + Number Plate Detection  v2               ║
║   Features: Overload AI  |  Indian Plate OCR  |  CSV Log   ║
╚══════════════════════════════════════════════════════════════╝"""

def menu():
    print(BANNER)

    model, classes = load_overload_model()
    use_v2 = (classes == ["overloaded_truck", "normal_truck"])
    reader = load_plate_reader()
    init_csv()

    print(f"\n  Model version : {'v2 (direct overload classes)' if use_v2 else 'v1 (geometry-based)'}")
    print(f"  Classes       : {classes}")
    print(f"  Plate OCR     : {'EasyOCR (Indian EN)' if reader else 'Disabled'}")
    print(f"  CSV log       : {LOG_CSV}")
    print(f"  Confidence    : {CONFIG['conf']}\n")

    if not use_v2:
        print("  [NOTE] v2 model not found. Using v1 with geometry logic.")
        print("         Run train_v2.py to get direct overload prediction.\n")

    while True:
        print("┌──────────────────────────────────────────┐")
        print("│  Prediction source:                      │")
        print("│  [1] Image file                          │")
        print("│  [2] Video file                          │")
        print("│  [3] Webcam (live)                       │")
        print("│  [4] Change confidence threshold         │")
        print("│  [5] Open CSV log                        │")
        print("│  [Q] Quit                                │")
        print("└──────────────────────────────────────────┘")

        choice = input("  → Choice: ").strip().upper()

        if choice == "1":
            p = input("  → Image path: ").strip()
            predict_image(model, classes, reader, p, use_v2)

        elif choice == "2":
            p = input("  → Video path: ").strip()
            predict_video(model, classes, reader, p, use_v2)

        elif choice == "3":
            predict_webcam(model, classes, reader, use_v2)

        elif choice == "4":
            try:
                val = float(input("  → Confidence (0.0-1.0): ").strip())
                if 0.0 <= val <= 1.0:
                    CONFIG["conf"] = val
                    print(f"  [✓] Set to {val}")
                else:
                    print("  [!] Must be 0.0-1.0")
            except ValueError:
                print("  [!] Invalid number")

        elif choice == "5":
            os.startfile(str(LOG_CSV)) if LOG_CSV.exists() else print("  [!] No log yet.")

        elif choice == "Q":
            print("\n[+] Bye!\n")
            break
        else:
            print("  [!] Invalid choice\n")

if __name__ == "__main__":
    menu()
