import os
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"

import cv2
from pathlib import Path
from ultralytics import YOLO
from predict_v2 import determine_overload_v1

# Setup paths
BASE_DIR = Path("d:/truckmodel")
VIDEO_PATH = BASE_DIR / "vidssave.com Tata Tipper Truck Video _ Tata Heavy Duty Tipper Off-road Truck Driving - Trucks In Road. 720P.mp4"
DATASET_DIR = BASE_DIR / "dataset"

IMG_TRAIN = DATASET_DIR / "images" / "train"
LBL_TRAIN = DATASET_DIR / "labels" / "train"

for p in [IMG_TRAIN, LBL_TRAIN]:
    p.mkdir(parents=True, exist_ok=True)

print("[+] Loading V1 model...")
V1_PATH = BASE_DIR / "truck_overload_model/truck_overload_model/best.pt"
if not V1_PATH.exists():
    print(f"[ERROR] V1 model not found at {V1_PATH}")
    exit(1)
model = YOLO(str(V1_PATH))
CLASSES = model.names

print(f"[+] Opening video: {VIDEO_PATH}")
cap = cv2.VideoCapture(str(VIDEO_PATH))

frame_count = 0
saved_count = 0

print("[+] Extracting frames and generating labels...")
while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break
        
    # Extract 1 frame every 15 frames
    if frame_count % 15 == 0:
        results = model.predict(source=frame, conf=0.30, verbose=False)
        detections = []
        for r in results:
            if r.boxes is None: continue
            for box in r.boxes:
                cls_id = int(box.cls[0])
                cls_name = CLASSES[cls_id] if cls_id < len(CLASSES) else "unknown"
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                detections.append((cls_name, x1, y1, x2, y2, conf))
        
        # Get overloaded status using our advanced V1 logic
        overload_results = determine_overload_v1(detections, frame=frame)
        
        # YOLO txt format: class_id center_x center_y width height (normalized 0-1)
        h, w = frame.shape[:2]
        labels = []
        for tx1, ty1, tx2, ty2, status, _ in overload_results:
            # Class 0 = normal_truck, Class 1 = overloaded_truck
            class_id = 1 if status == "OVERLOADED" else 0
            
            # Normalize coordinates
            cx = ((tx1 + tx2) / 2) / w
            cy = ((ty1 + ty2) / 2) / h
            bw = (tx2 - tx1) / w
            bh = (ty2 - ty1) / h
            
            # Clamp between 0 and 1
            cx, cy = max(0.0, min(1.0, cx)), max(0.0, min(1.0, cy))
            bw, bh = max(0.0, min(1.0, bw)), max(0.0, min(1.0, bh))
            
            labels.append(f"{class_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
            
        if labels:
            # Save frame and label
            base_name = f"frame_{frame_count:06d}"
            cv2.imwrite(str(IMG_TRAIN / f"{base_name}.jpg"), frame)
            with open(LBL_TRAIN / f"{base_name}.txt", "w") as f:
                f.write("\n".join(labels) + "\n")
            saved_count += 1
            
    frame_count += 1

cap.release()
print(f"\n[+] Extraction complete! Created {saved_count} labeled images.")

# Create dataset.yaml
yaml_path = DATASET_DIR / "dataset.yaml"
# Ensure paths use forward slashes for cross-platform compatibility in YAML
abs_path = str(DATASET_DIR.absolute()).replace('\\', '/')
yaml_content = f"""path: {abs_path}
train: images/train
val: images/train

names:
  0: normal_truck
  1: overloaded_truck
"""
with open(yaml_path, "w") as f:
    f.write(yaml_content)
print(f"[+] Created {yaml_path}")
