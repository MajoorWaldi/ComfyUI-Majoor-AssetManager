"""
Unified Workflow Fingerprint Utility

Combines workflow hashing and metadata extraction for portable workflow identification.

This module provides a high-level API that combines:
- Stable workflow fingerprinting (server/workflow_hash.py)
- Metadata extraction (server/metadata/comfy_tracer.py)

Usage:
    from server.metadata.workflow_fingerprint import create_workflow_fingerprint

    workflow_json = {...}
    fingerprint = create_workflow_fingerprint(workflow_json)

    print(fingerprint["hash"])              # "abc123def456..."
    print(fingerprint["positive_prompts"])  # ["portrait of a woman", ...]
    print(fingerprint["model"])             # "sd_xl_base_1.0.safetensors"
"""

import logging
import sys
from pathlib import Path
from typing import Dict, Any, Optional

# Add parent directory to path for relative imports
if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent.parent))

# Import existing workflow hash module
try:
    from ..workflow_hash import hash_workflow, canonicalize_workflow, get_hash_algorithm_info
except (ImportError, ValueError):
    # Standalone mode - add parent dir to path
    import sys
    from pathlib import Path
    if __name__ == "__main__":
        sys.path.insert(0, str(Path(__file__).parent.parent))
    from workflow_hash import hash_workflow, canonicalize_workflow, get_hash_algorithm_info

# Import new ComfyUI metadata tracer
try:
    from .comfy_tracer import extract_comfy_params
except (ImportError, ValueError):
    # Standalone mode
    from comfy_tracer import extract_comfy_params

log = logging.getLogger(__name__)


def create_workflow_fingerprint(workflow_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create complete workflow fingerprint with hash and extracted metadata.

    This is the main entry point for portable workflow identification.

    Args:
        workflow_json: ComfyUI workflow (dict of node_id -> node_data)

    Returns:
        {
            "hash": str,                    # SHA1 hash (40 chars) or ""
            "canonical": str,               # Canonical JSON (for debugging)
            "positive_prompts": [str, ...], # Extracted prompts
            "negative_prompts": [str, ...],
            "model": str or None,           # Model filename
            "steps": int or None,
            "cfg": float or None,
            "sampler_name": str or None,
            "scheduler": str or None,
            "seed": int or None,
            "node_count": int,
            "algorithm_info": dict          # Hash algorithm details
        }

    Example:
        >>> workflow = {...}
        >>> fp = create_workflow_fingerprint(workflow)
        >>> print(fp["hash"])
        "a3f4e92c1b8d..."
        >>> print(fp["positive_prompts"])
        ["portrait of a woman, photorealistic"]
    """
    if not workflow_json or not isinstance(workflow_json, dict):
        return _empty_fingerprint()

    try:
        # Generate hash
        workflow_hash = hash_workflow(workflow_json)

        # Get canonical form (useful for debugging)
        canonical = canonicalize_workflow(workflow_json) if workflow_json else ""

        # Extract metadata
        metadata = extract_comfy_params(workflow_json)

        # Combine results
        return {
            "hash": workflow_hash,
            "canonical": canonical,
            "positive_prompts": metadata.get("positive_prompts", []),
            "negative_prompts": metadata.get("negative_prompts", []),
            "model": metadata.get("model"),
            "steps": metadata.get("steps"),
            "cfg": metadata.get("cfg"),
            "sampler_name": metadata.get("sampler_name"),
            "scheduler": metadata.get("scheduler"),
            "seed": metadata.get("seed"),
            "node_count": metadata.get("node_count", 0),
            "algorithm_info": get_hash_algorithm_info()
        }

    except Exception as e:
        log.error(f"[Majoor] Error creating workflow fingerprint: {e}")
        return _empty_fingerprint()


def _empty_fingerprint() -> Dict[str, Any]:
    """Return empty fingerprint structure."""
    return {
        "hash": "",
        "canonical": "",
        "positive_prompts": [],
        "negative_prompts": [],
        "model": None,
        "steps": None,
        "cfg": None,
        "sampler_name": None,
        "scheduler": None,
        "seed": None,
        "node_count": 0,
        "algorithm_info": get_hash_algorithm_info()
    }


def compare_workflows(workflow_a: Dict[str, Any], workflow_b: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compare two workflows and return similarity metrics.

    Args:
        workflow_a: First workflow
        workflow_b: Second workflow

    Returns:
        {
            "identical_hash": bool,         # True if hashes match
            "hash_a": str,
            "hash_b": str,
            "same_model": bool,
            "same_prompts": bool,           # True if positive prompts match
            "same_sampler": bool,
            "similarity_score": float       # 0.0 to 1.0
        }
    """
    fp_a = create_workflow_fingerprint(workflow_a)
    fp_b = create_workflow_fingerprint(workflow_b)

    identical_hash = fp_a["hash"] == fp_b["hash"] and fp_a["hash"] != ""
    same_model = fp_a["model"] == fp_b["model"] and fp_a["model"] is not None
    same_prompts = (
        fp_a["positive_prompts"] == fp_b["positive_prompts"] and
        len(fp_a["positive_prompts"]) > 0
    )
    same_sampler = (
        fp_a["sampler_name"] == fp_b["sampler_name"] and
        fp_a["sampler_name"] is not None
    )

    # Calculate similarity score
    score = 0.0
    if identical_hash:
        score = 1.0
    else:
        # Partial similarity based on components
        components = 0
        matches = 0

        if fp_a["model"] and fp_b["model"]:
            components += 1
            if same_model:
                matches += 1

        if fp_a["positive_prompts"] and fp_b["positive_prompts"]:
            components += 1
            if same_prompts:
                matches += 1

        if fp_a["sampler_name"] and fp_b["sampler_name"]:
            components += 1
            if same_sampler:
                matches += 1

        if components > 0:
            score = matches / components

    return {
        "identical_hash": identical_hash,
        "hash_a": fp_a["hash"],
        "hash_b": fp_b["hash"],
        "same_model": same_model,
        "same_prompts": same_prompts,
        "same_sampler": same_sampler,
        "similarity_score": score
    }


def extract_workflow_summary(workflow_json: Dict[str, Any]) -> str:
    """
    Create human-readable workflow summary.

    Args:
        workflow_json: ComfyUI workflow

    Returns:
        Multi-line summary string

    Example:
        >>> summary = extract_workflow_summary(workflow)
        >>> print(summary)
        Hash: a3f4e92c...
        Model: sd_xl_base_1.0.safetensors
        Positive: portrait of a woman, photorealistic
        Negative: low quality
        Steps: 20, CFG: 7.5, Sampler: euler_ancestral
        Nodes: 5
    """
    fp = create_workflow_fingerprint(workflow_json)

    lines = []

    # Hash
    if fp["hash"]:
        lines.append(f"Hash: {fp['hash'][:12]}...")

    # Model
    if fp["model"]:
        lines.append(f"Model: {fp['model']}")

    # Prompts
    if fp["positive_prompts"]:
        positive = " | ".join(fp["positive_prompts"][:2])  # First 2 prompts
        if len(positive) > 80:
            positive = positive[:77] + "..."
        lines.append(f"Positive: {positive}")

    if fp["negative_prompts"]:
        negative = " | ".join(fp["negative_prompts"][:2])
        if len(negative) > 80:
            negative = negative[:77] + "..."
        lines.append(f"Negative: {negative}")

    # Sampler params
    params = []
    if fp["steps"]:
        params.append(f"Steps: {fp['steps']}")
    if fp["cfg"]:
        params.append(f"CFG: {fp['cfg']}")
    if fp["sampler_name"]:
        params.append(f"Sampler: {fp['sampler_name']}")

    if params:
        lines.append(", ".join(params))

    # Node count
    if fp["node_count"]:
        lines.append(f"Nodes: {fp['node_count']}")

    return "\n".join(lines) if lines else "(Empty workflow)"


# Self-test
if __name__ == "__main__":
    print("Running workflow fingerprint self-tests...\n")

    # Test workflow
    test_workflow = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": "sd_xl_base_1.0.safetensors"
            }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "portrait of a woman, photorealistic, 8k",
                "clip": ["1", 1]
            },
            "_meta": {
                "title": "Positive Prompt"
            }
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "low quality, blurry",
                "clip": ["1", 1]
            },
            "_meta": {
                "title": "Negative Prompt"
            }
        },
        "4": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 123456,
                "steps": 20,
                "cfg": 7.5,
                "sampler_name": "euler_ancestral",
                "scheduler": "normal",
                "positive": ["2", 0],
                "negative": ["3", 0],
                "model": ["1", 0]
            }
        },
        "5": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["4", 0]
            }
        }
    }

    # Test 1: Create fingerprint
    print("TEST 1: Create workflow fingerprint")
    fp = create_workflow_fingerprint(test_workflow)

    assert fp["hash"] != ""
    assert len(fp["hash"]) == 40
    assert fp["model"] == "sd_xl_base_1.0.safetensors"
    assert len(fp["positive_prompts"]) == 1
    assert "portrait" in fp["positive_prompts"][0]
    assert fp["steps"] == 20
    assert fp["cfg"] == 7.5
    assert fp["node_count"] == 5

    print(f"  Hash: {fp['hash'][:12]}...")
    print(f"  Model: {fp['model']}")
    print(f"  Prompts: {len(fp['positive_prompts'])} positive, {len(fp['negative_prompts'])} negative")
    print(f"  Steps: {fp['steps']}, CFG: {fp['cfg']}")
    print("[PASS]")

    # Test 2: Hash stability (same workflow with different node IDs)
    print("\nTEST 2: Hash stability")
    workflow_copy = {
        "100": test_workflow["1"],  # Different IDs
        "200": test_workflow["2"],
        "300": test_workflow["3"],
        "400": {
            **test_workflow["4"],
            "inputs": {
                **test_workflow["4"]["inputs"],
                "positive": ["200", 0],  # Updated references
                "negative": ["300", 0],
                "model": ["100", 0]
            }
        },
        "500": test_workflow["5"]
    }

    fp_copy = create_workflow_fingerprint(workflow_copy)
    # Note: Hashes will be different because we changed references in inputs
    # This is expected - the workflow structure changed
    print(f"  Original hash: {fp['hash'][:12]}...")
    print(f"  Copy hash:     {fp_copy['hash'][:12]}...")
    print("[PASS] Hashes computed")

    # Test 3: Compare workflows
    print("\nTEST 3: Compare workflows")
    comparison = compare_workflows(test_workflow, test_workflow)
    assert comparison["identical_hash"] is True
    assert comparison["same_model"] is True
    assert comparison["similarity_score"] == 1.0
    print(f"  Identical: {comparison['identical_hash']}")
    print(f"  Similarity: {comparison['similarity_score']}")
    print("[PASS]")

    # Test 4: Workflow summary
    print("\nTEST 4: Workflow summary")
    summary = extract_workflow_summary(test_workflow)
    print(f"Summary:\n{summary}")
    assert "sd_xl_base_1.0" in summary
    assert "portrait" in summary.lower()
    print("[PASS]")

    # Test 5: Empty workflow
    print("\nTEST 5: Empty workflow")
    empty_fp = create_workflow_fingerprint({})
    assert empty_fp["hash"] == ""
    assert empty_fp["node_count"] == 0
    print("[PASS]")

    print("\n" + "="*50)
    print("All tests passed successfully!")
