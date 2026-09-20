import sys
import json
import os
from inference_sdk import InferenceHTTPClient, InferenceConfiguration

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No image path provided"}))
        sys.exit(1)

    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(json.dumps({"error": f"File not found: {image_path}"}))
        sys.exit(1)

    # Use the API key provided or fall back to env var
    api_key = os.environ.get("ROBOFLOW_API_KEY", "XqNmpHgIL0PjdJOQucVY")

    try:
        client = InferenceHTTPClient(
            api_url="https://serverless.roboflow.com",
            api_key=api_key
        ).configure(InferenceConfiguration(
            api_key_transport="header"
        ))

        result = client.run_workflow(
            workspace_name="aruns-workspace-6uoks",
            workflow_id="truck-load-astra-detection",
            images={
                "image": image_path
            },
            parameters={
                "confidence": 0.4,
                "iou_threshold": 0.3,
                "class_agnostic_nms": False,
                "max_detections": 1000
            },
            use_cache=True
        )

        # Parse results
        best_class = None
        best_conf = 0.0

        if isinstance(result, list) and len(result) > 0:
            res_dict = result[0]
            if "predictions" in res_dict and "predictions" in res_dict["predictions"]:
                preds = res_dict["predictions"]["predictions"]
                for p in preds:
                    conf = p.get("confidence", 0)
                    cls_name = p.get("class", "unknown")
                    if conf > best_conf:
                        best_conf = conf
                        best_class = cls_name

        # Map to dashboard labels
        if best_class is None or best_conf < 0.20:
            classification = "Mining Truck"
            reason = "No truck or load detected with sufficient confidence. Truck may be a generic mining vehicle."
        elif "overload" in best_class.lower() or "full" in best_class.lower():
            classification = "Overloaded"
            reason = f"Truck bed detected as overloaded ({best_conf:.1%} confidence). Load exceeds safe limits."
        elif "normal" in best_class.lower() or "empty" in best_class.lower():
            classification = "Empty Load"
            reason = f"Truck bed detected as empty ({best_conf:.1%} confidence). No material in dump bed."
        else:
            classification = "Mining Truck"
            reason = f"Detected class '{best_class}' at {best_conf:.1%} — classified as general mining truck."

        output = {
            "classification": classification,
            "confidence": round(best_conf, 4),
            "reason": reason,
            "raw_class": best_class or "none",
            "error": None
        }

        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({
            "classification": "Mining Truck",
            "confidence": 0.0,
            "reason": "Roboflow API error: " + str(e),
            "raw_class": "error",
            "error": str(e)
        }))

if __name__ == "__main__":
    main()
