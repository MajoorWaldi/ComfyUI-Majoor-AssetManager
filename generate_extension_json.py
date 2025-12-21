#!/usr/bin/env python3
"""
Generate comfyui_extension.json from version.py to ensure single source of truth.
Run this script when updating the version.
"""
import json
import sys
from pathlib import Path

# Import version from server module
sys.path.insert(0, str(Path(__file__).parent / "server"))
from version import VERSION

# Extension metadata
extension_data = {
    "name": "Majoor-AssetsManager",
    "version": VERSION,
    "author": "Ewald ALOEBOETOE (Majoor)",
    "frontend": "js/",
    "backend": "server/"
}

# Write to comfyui_extension.json
output_path = Path(__file__).parent / "comfyui_extension.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(extension_data, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"Generated {output_path} with version {VERSION}")
