"""
Workflow fingerprinting for Graph ↔ Asset bridge.

Generates stable hashes of ComfyUI workflows for matching assets to graphs.
Canonicalizes workflow JSON to ensure consistent hashes regardless of:
- Node IDs (may change on copy/paste)
- Node positions (UI layout irrelevant)
- Execution order (non-deterministic)
- UI properties (colors, minimized state, etc.)
"""

import json
import hashlib
from typing import Any, Dict, Set


# Fields to exclude from canonicalization (volatile/UI-only)
EXCLUDE_KEYS: Set[str] = {
    "id",  # Node IDs may change
    "pos",  # Position irrelevant
    "size",  # Size irrelevant
    "order",  # Execution order may vary
    "mode",  # Mode (active/muted) irrelevant
    "properties",  # UI properties
    "color",  # Node color
    "bgcolor",  # Background color
    "flags",  # UI flags
    "widgets_values",  # Widget positions (use inputs instead)
}


def deep_copy_without(obj: Any, exclude_keys: Set[str]) -> Any:
    """
    Deep copy dict/list, excluding specified keys.

    Args:
        obj: Object to copy (dict, list, or primitive)
        exclude_keys: Set of keys to exclude from dicts

    Returns:
        Deep copy with excluded keys removed
    """
    if isinstance(obj, dict):
        return {
            k: deep_copy_without(v, exclude_keys)
            for k, v in obj.items()
            if k not in exclude_keys
        }
    elif isinstance(obj, list):
        return [deep_copy_without(item, exclude_keys) for item in obj]
    else:
        return obj


def canonicalize_workflow(workflow: Dict[str, Any]) -> str:
    """
    Convert workflow to canonical JSON for hashing.

    Removes volatile fields and sorts keys recursively.

    Args:
        workflow: ComfyUI workflow dict

    Returns:
        Canonical JSON string (sorted, compact)
    """
    # Remove volatile fields
    clean = deep_copy_without(workflow, EXCLUDE_KEYS)

    # Sort all dict keys recursively
    canonical = json.dumps(clean, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return canonical


def hash_workflow(workflow: Dict[str, Any]) -> str:
    """
    Generate stable SHA1 hash of workflow.

    Args:
        workflow: ComfyUI workflow dict

    Returns:
        40-character hex SHA1 hash or empty string
    """
    if not workflow:
        return ""

    try:
        canonical = canonicalize_workflow(workflow)
        # Check if canonical is empty (avoids hash of empty string)
        if not canonical or canonical in ("{}", "[]", "null"):
            return ""

        return hashlib.sha1(canonical.encode('utf-8')).hexdigest()
    except Exception as e:
        # Log error but don't crash indexing
        from .logger import get_logger
        log = get_logger(__name__)
        log.warning(f"[Majoor] Failed to hash workflow: {e}")
        return ""


def hash_workflow_robust(workflow: Any) -> str:
    """
    Robust workflow hashing with fallback for invalid data.

    Handles:
    - None/empty workflows
    - Non-dict workflows
    - Malformed JSON

    Args:
        workflow: ComfyUI workflow (dict, str, or None)

    Returns:
        Workflow hash or empty string on failure
    """
    if not workflow:
        return ""

    # If workflow is a string, try to parse it
    if isinstance(workflow, str):
        try:
            workflow = json.loads(workflow)
        except:
            return ""

    # Ensure it's a dict
    if not isinstance(workflow, dict):
        return ""

    return hash_workflow(workflow)


# ===== Client-side compatible hashing (for frontend) =====

def get_hash_algorithm_info() -> Dict[str, str]:
    """
    Get information about the hashing algorithm for client-side implementation.

    Returns:
        Dict with keys: algorithm, exclude_keys, description
    """
    return {
        "algorithm": "SHA1",
        "exclude_keys": list(EXCLUDE_KEYS),
        "description": "Canonical JSON (sorted keys, no whitespace) -> SHA1 hex",
    }


# ===== Testing/Validation =====

def _test_workflow_hashing():
    """Self-test for workflow hashing consistency."""
    # Test workflow
    workflow1 = {
        "nodes": [
            {
                "id": 1,
                "type": "KSampler",
                "pos": [100, 200],
                "size": [300, 400],
                "inputs": {"seed": 42, "steps": 20},
                "properties": {"note": "test"},
            }
        ],
        "links": [[1, 0, 2, 0, "LATENT"]],
    }

    # Same workflow, different IDs/positions
    workflow2 = {
        "nodes": [
            {
                "id": 999,  # Different ID
                "type": "KSampler",
                "pos": [500, 600],  # Different position
                "size": [100, 100],  # Different size
                "inputs": {"seed": 42, "steps": 20},  # Same inputs
                "properties": {"note": "different"},  # Different properties
            }
        ],
        "links": [[1, 0, 2, 0, "LATENT"]],
    }

    # Different workflow (different inputs)
    workflow3 = {
        "nodes": [
            {
                "id": 1,
                "type": "KSampler",
                "pos": [100, 200],
                "inputs": {"seed": 99, "steps": 30},  # Different
            }
        ],
        "links": [[1, 0, 2, 0, "LATENT"]],
    }

    hash1 = hash_workflow(workflow1)
    hash2 = hash_workflow(workflow2)
    hash3 = hash_workflow(workflow3)

    # workflow1 and workflow2 should have same hash
    assert hash1 == hash2, f"Hash mismatch: {hash1} != {hash2}"

    # workflow1 and workflow3 should have different hashes
    assert hash1 != hash3, f"Hash collision: {hash1} == {hash3}"

    # Hash should be 40 characters (SHA1)
    assert len(hash1) == 40, f"Invalid hash length: {len(hash1)}"

    print("[Majoor] Workflow hashing tests passed")


# Run self-test on import
if __name__ != "__main__":
    try:
        _test_workflow_hashing()
    except Exception as e:
        try:
            from .logger import get_logger
            log = get_logger(__name__)
            log.error(f"[Majoor] Workflow hashing self-test failed: {e}")
        except:
            pass  # Standalone mode
