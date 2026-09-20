"""
╔══════════════════════════════════════════════════════════════╗
║   Truck Overload Detection v2 — Training Script             ║
║   Downloads multiple Roboflow datasets + trains YOLOv8s     ║
╚══════════════════════════════════════════════════════════════╝
"""
import os
# Fix OpenBLAS memory crash on Windows before any imports
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"

import sys
import shutil
import re
from pathlib import Path

# Redirect Temp and YOLO config directories to D drive since C is full
os.environ["TMP"] = "D:\\truckmodel\\tmp"
os.environ["TEMP"] = "D:\\truckmodel\\tmp"
os.environ["YOLO_CONFIG_DIR"] = "D:\\truckmodel\\ultralytics_config"
Path("D:\\truckmodel\\tmp").mkdir(exist_ok=True)
Path("D:\\truckmodel\\ultralytics_config").mkdir(exist_ok=True)

# ─── Auto-install ────────────────────────────────────────────────────────────
def pip(pkg):
    os.system(f"{sys.executable} -m pip install {pkg} -q")

try:
    import yaml
except ImportError:
    pip("pyyaml"); import yaml

try:
    from roboflow import Roboflow
except ImportError:
    pip("roboflow"); from roboflow import Roboflow

try:
    from ultralytics import YOLO
except ImportError:
    pip("ultralytics"); from ultralytics import YOLO

# ─── Config ──────────────────────────────────────────────────────────────────
API_KEY    = "XqNmpHgIL0PjdJOQucVY"
OUTPUT_DIR = Path("d:/truckmodel/v2")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

CLASS_NAMES = ["overloaded_truck", "normal_truck"]

# Datasets to try (workspace, project, version)
DATASETS = [
    ("overloaded-vehicle",  "overloaded-detection",      1),
    ("sam-lm8mn",           "overload-indian-truck",      1),
    ("project-xpjpo",       "detect-overload-tcepi",      1),
]

# Map any dataset's class names → our unified classes
CLASS_MAP = {
    # → overloaded_truck
    "overloaded":         0,
    "Roda":               0,
    "overloaded_truck":   0,
    "overloaded-truck":   0,
    "goods":              0,
    "overload":           0,
    "Overloaded":         0,
    # → normal_truck
    "Normal_truck":       1,
    "notoverloaded":      1,
    "normal_truck":       1,
    "truck":              1,
    "Truck":              1,
    "normal":             1,
    "vehicle":            1,
}

# ─── Helpers ─────────────────────────────────────────────────────────────────

def download_dataset(workspace, project, version):
    loc = str(OUTPUT_DIR / f"{project}")
    try:
        rf  = Roboflow(api_key=API_KEY)
        ver = rf.workspace(workspace).project(project).version(version)
        ver.download("yolov8", location=loc)
        print(f"  [✓] Downloaded: {project}")
        return Path(loc)
    except Exception as e:
        print(f"  [!] Skipped {project}: {e}")
        return None


def remap_labels(dataset_path, src_names):
    """Rewrite all .txt label files so class IDs match CLASS_NAMES."""
    idx_map = {}
    for old_idx, name in enumerate(src_names):
        new_idx = CLASS_MAP.get(name)
        if new_idx is not None:
            idx_map[old_idx] = new_idx

    for split in ["train", "valid", "test"]:
        lbl_dir = dataset_path / split / "labels"
        if not lbl_dir.exists():
            continue
        for f in lbl_dir.glob("*.txt"):
            lines = []
            for line in f.read_text().splitlines():
                if not line.strip():
                    continue
                parts = line.split()
                old = int(parts[0])
                if old in idx_map:
                    parts[0] = str(idx_map[old])
                    lines.append(" ".join(parts))
                # else: skip unknown class
            f.write_text("\n".join(lines))


def get_src_names(dataset_path):
    yaml_file = dataset_path / "data.yaml"
    if not yaml_file.exists():
        return []
    with open(yaml_file) as f:
        d = yaml.safe_load(f)
    return d.get("names", [])


def merge_datasets(paths, merged_dir):
    """Copy images+labels from multiple datasets into one merged folder."""
    for split in ["train", "valid", "test"]:
        (merged_dir / split / "images").mkdir(parents=True, exist_ok=True)
        (merged_dir / split / "labels").mkdir(parents=True, exist_ok=True)

    total_imgs = 0
    for ds in paths:
        prefix = ds.name.replace("-", "_")
        for split in ["train", "valid", "test"]:
            src_i = ds / split / "images"
            src_l = ds / split / "labels"
            dst_i = merged_dir / split / "images"
            dst_l = merged_dir / split / "labels"
            if src_i.exists():
                for img in src_i.iterdir():
                    shutil.copy2(img, dst_i / f"{prefix}_{img.name}")
                    total_imgs += 1
            if src_l.exists():
                for lbl in src_l.glob("*.txt"):
                    shutil.copy2(lbl, dst_l / f"{prefix}_{lbl.name}")

    # Write merged data.yaml
    data_yaml = {
        "path":  str(merged_dir.resolve()),
        "train": "train/images",
        "val":   "valid/images",
        "test":  "test/images",
        "nc":    len(CLASS_NAMES),
        "names": CLASS_NAMES,
    }
    with open(merged_dir / "data.yaml", "w") as f:
        yaml.dump(data_yaml, f, default_flow_style=False)

    print(f"  [✓] Merged {total_imgs} images from {len(paths)} dataset(s)")
    return merged_dir / "data.yaml"


def count_images(merged_dir):
    counts = {}
    for split in ["train", "valid", "test"]:
        d = merged_dir / split / "images"
        counts[split] = len(list(d.glob("*"))) if d.exists() else 0
    return counts


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print("\n" + "="*60)
    print("  Truck Overload Detection v2 — Training (Auto-Dataset)")
    print("="*60)
    print(f"  Classes     : {CLASS_NAMES}")
    print(f"  Model       : YOLOv8n")
    print(f"  Epochs      : 10")
    print(f"  Output      : {OUTPUT_DIR}")
    print("="*60 + "\n")

    data_yaml = Path("d:/truckmodel/dataset/dataset.yaml")
    if not data_yaml.exists():
        print("[ERROR] Auto-generated dataset not found! Please run create_dataset.py first.")
        sys.exit(1)

    print(f"\n[+] Using auto-generated dataset: {data_yaml}")

    # Train
    print("\n[+] Starting YOLOv8n training (10 epochs)...")
    print("    This will take just a few minutes.\n")

    model = YOLO("yolov8n.pt")
    results = model.train(
        data=str(data_yaml),
        epochs=10,
        imgsz=320,        # Reduced from 640 to avoid OOM
        batch=2,          # Reduced from 4 to avoid OOM
        project=str(OUTPUT_DIR),
        name="overload_v2_video",
        exist_ok=True,
        plots=False,      # Disabled — OpenBLAS crash on Windows
        verbose=True,
        workers=0,        # No multiprocessing — avoids Windows RAM issues
    )

    # Report
    best_model = OUTPUT_DIR / "overload_v2_video" / "weights" / "best.pt"
    print("\n" + "="*60)
    print("  TRAINING COMPLETE!")
    print("="*60)
    if best_model.exists():
        print(f"  [✓] Best model : {best_model}")
        
        # Automatically copy the new model to best.pt so predict_v2.py uses it!
        import shutil
        target = Path("d:/truckmodel/best.pt")
        shutil.copy2(best_model, target)
        print(f"  [✓] Installed new model to: {target}")
        print(f"\n  Run predict_v2.py to use the new model!")
    else:
        print("  [!] Training may have had issues. Check logs above.")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
