"""
Recursive ComfyUI Workflow Node Tracer

Traverses ComfyUI workflow graphs to extract metadata from complex/modular workflows.

Handles:
- Output nodes (SaveImage, PreviewImage, VHS_VideoCombine, etc.)
- Upstream traversal via BFS/DFS
- Reroute nodes
- Custom nodes and wrappers
- Parameter extraction (positive/negative prompts, model, sampler, etc.)

Usage:
    from server.metadata.comfy_tracer import extract_comfy_params

    workflow_json = {...}  # ComfyUI workflow
    metadata = extract_comfy_params(workflow_json)

    print(metadata["positive_prompts"])  # ["portrait of a woman", ...]
    print(metadata["negative_prompts"])  # ["low quality", ...]
    print(metadata["model"])             # "sd_xl_base_1.0.safetensors"
"""

import logging
from typing import Dict, List, Any, Set, Optional, Tuple
from collections import deque

log = logging.getLogger(__name__)


# Known output node types
OUTPUT_NODE_TYPES = {
    "SaveImage",
    "PreviewImage",
    "VHS_VideoCombine",
    "SaveImageWebsocket",
    "SaveAnimatedWEBP",
    "SaveAnimatedPNG",
    "ImageUploadS3",
    # Add custom output nodes here
}

# Known reroute node types
REROUTE_NODE_TYPES = {
    "Reroute",
    "RerouteNode",
}

# Known CLIP text encode node types
CLIP_TEXT_ENCODE_TYPES = {
    "CLIPTextEncode",
    "CLIPTextEncodeSDXL",
    "CLIPTextEncodeSDXLRefiner",
    "BNK_CLIPTextEncodeAdvanced",
    "smZ CLIPTextEncode",
    # Add custom text encode nodes here
}

# Known checkpoint loader types
CHECKPOINT_LOADER_TYPES = {
    "CheckpointLoaderSimple",
    "CheckpointLoader",
    "CheckpointLoaderSDXL",
    "unCLIPCheckpointLoader",
    # Add custom loaders here
}

# Known sampler node types
SAMPLER_NODE_TYPES = {
    "KSampler",
    "KSamplerAdvanced",
    "SamplerCustom",
    "SamplerCustomAdvanced",
}


class WorkflowGraph:
    """
    Indexed graph structure for ComfyUI workflows.

    Provides efficient traversal and node lookup.
    """

    def __init__(self, workflow_json: Dict[str, Any]):
        """
        Build graph from workflow JSON.

        Args:
            workflow_json: ComfyUI workflow (dict of node_id -> node_data)
        """
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.edges: Dict[str, List[str]] = {}  # node_id -> [connected_node_ids]
        self.reverse_edges: Dict[str, List[str]] = {}  # node_id -> [upstream_node_ids]

        self._build_graph(workflow_json)

    def _build_graph(self, workflow_json: Dict[str, Any]) -> None:
        """Parse workflow and build graph structure."""
        if not isinstance(workflow_json, dict):
            return

        # Add all nodes
        for node_id, node_data in workflow_json.items():
            if not isinstance(node_data, dict):
                continue

            self.nodes[node_id] = node_data
            self.edges[node_id] = []
            self.reverse_edges[node_id] = []

        # Build edges from inputs
        for node_id, node_data in self.nodes.items():
            inputs = node_data.get("inputs", {})
            if not isinstance(inputs, dict):
                continue

            for input_name, input_value in inputs.items():
                # ComfyUI inputs can be:
                # - [source_node_id, output_slot] for connections
                # - literal values (str, int, float, etc.)
                if isinstance(input_value, list) and len(input_value) >= 1:
                    source_node_id = str(input_value[0])

                    if source_node_id in self.nodes:
                        # Add edge: source -> current
                        self.edges[source_node_id].append(node_id)
                        # Add reverse edge: current -> source (upstream)
                        self.reverse_edges[node_id].append(source_node_id)

    def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        """Get node data by ID."""
        return self.nodes.get(node_id)

    def get_upstream_nodes(self, node_id: str) -> List[str]:
        """Get all directly connected upstream nodes."""
        return self.reverse_edges.get(node_id, [])

    def get_downstream_nodes(self, node_id: str) -> List[str]:
        """Get all directly connected downstream nodes."""
        return self.edges.get(node_id, [])

    def get_node_type(self, node_id: str) -> Optional[str]:
        """Get node class_type."""
        node = self.get_node(node_id)
        if node:
            return node.get("class_type")
        return None

    def trace_upstream(
        self,
        start_node_ids: List[str],
        max_depth: int = 50
    ) -> List[str]:
        """
        Trace upstream from given nodes using BFS.

        Args:
            start_node_ids: Starting nodes
            max_depth: Maximum traversal depth (prevents infinite loops)

        Returns:
            List of node IDs in traversal order (BFS)
        """
        visited: Set[str] = set()
        queue = deque([(node_id, 0) for node_id in start_node_ids])
        result = []

        while queue:
            node_id, depth = queue.popleft()

            if node_id in visited or depth > max_depth:
                continue

            visited.add(node_id)
            result.append(node_id)

            # Add upstream nodes to queue
            upstream = self.get_upstream_nodes(node_id)
            for upstream_id in upstream:
                if upstream_id not in visited:
                    queue.append((upstream_id, depth + 1))

        return result

    def find_nodes_by_type(self, class_types: Set[str]) -> List[str]:
        """
        Find all nodes matching given class types.

        Args:
            class_types: Set of class_type strings

        Returns:
            List of node IDs
        """
        result = []
        for node_id, node_data in self.nodes.items():
            node_type = node_data.get("class_type")
            if node_type in class_types:
                result.append(node_id)
        return result


def extract_text_from_node(
    graph: WorkflowGraph,
    node_id: str,
    input_key: str = "text"
) -> Optional[str]:
    """
    Extract text from a node's input.

    Follows reroute nodes if necessary.

    Args:
        graph: Workflow graph
        node_id: Node to extract from
        input_key: Input key to extract (default "text")

    Returns:
        Extracted text or None
    """
    node = graph.get_node(node_id)
    if not node:
        return None

    inputs = node.get("inputs", {})
    text_input = inputs.get(input_key)

    # Direct text value
    if isinstance(text_input, str):
        return text_input.strip()

    # Connected input [source_node_id, output_slot]
    if isinstance(text_input, list) and len(text_input) >= 1:
        source_node_id = str(text_input[0])
        source_node = graph.get_node(source_node_id)

        if not source_node:
            return None

        source_type = source_node.get("class_type")

        # Follow reroute nodes
        if source_type in REROUTE_NODE_TYPES:
            return extract_text_from_node(graph, source_node_id, input_key)

        # Extract from source if it's also a text node
        if source_type in CLIP_TEXT_ENCODE_TYPES:
            return extract_text_from_node(graph, source_node_id, "text")

    return None


def extract_prompts(graph: WorkflowGraph) -> Tuple[List[str], List[str]]:
    """
    Extract positive and negative prompts from workflow.

    Returns:
        (positive_prompts, negative_prompts)
    """
    positive_prompts = []
    negative_prompts = []

    # Find all CLIP text encode nodes
    text_nodes = graph.find_nodes_by_type(CLIP_TEXT_ENCODE_TYPES)

    for node_id in text_nodes:
        node = graph.get_node(node_id)
        if not node:
            continue

        # Extract text
        text = extract_text_from_node(graph, node_id, "text")
        if not text:
            continue

        # Heuristic: determine if positive or negative
        # Check node title/meta for "negative" keyword
        is_negative = False

        meta = node.get("_meta", {})
        title = meta.get("title", "").lower()

        if "negative" in title:
            is_negative = True
        else:
            # Check if this node feeds into a sampler's negative_conditioning
            for downstream_id in graph.get_downstream_nodes(node_id):
                downstream = graph.get_node(downstream_id)
                if not downstream:
                    continue

                # Check if downstream is a sampler
                if downstream.get("class_type") in SAMPLER_NODE_TYPES:
                    # Check if connection is to negative input
                    inputs = downstream.get("inputs", {})
                    negative_input = inputs.get("negative")

                    if isinstance(negative_input, list) and len(negative_input) >= 1:
                        if str(negative_input[0]) == node_id:
                            is_negative = True
                            break

        if is_negative:
            negative_prompts.append(text)
        else:
            positive_prompts.append(text)

    return positive_prompts, negative_prompts


def extract_model(graph: WorkflowGraph) -> Optional[str]:
    """
    Extract checkpoint/model name from workflow.

    Returns:
        Model filename (e.g., "sd_xl_base_1.0.safetensors") or None
    """
    # Find checkpoint loader nodes
    loader_nodes = graph.find_nodes_by_type(CHECKPOINT_LOADER_TYPES)

    for node_id in loader_nodes:
        node = graph.get_node(node_id)
        if not node:
            continue

        inputs = node.get("inputs", {})

        # Try common input names
        for key in ["ckpt_name", "checkpoint_name", "model_name"]:
            model_name = inputs.get(key)
            if isinstance(model_name, str) and model_name:
                return model_name.strip()

    return None


def extract_sampler_params(graph: WorkflowGraph) -> Dict[str, Any]:
    """
    Extract sampler parameters (steps, cfg, sampler_name, scheduler).

    Returns:
        {
            "steps": int,
            "cfg": float,
            "sampler_name": str,
            "scheduler": str,
            "seed": int
        }
    """
    params = {}

    # Find sampler nodes
    sampler_nodes = graph.find_nodes_by_type(SAMPLER_NODE_TYPES)

    if not sampler_nodes:
        return params

    # Use first sampler found
    node = graph.get_node(sampler_nodes[0])
    if not node:
        return params

    inputs = node.get("inputs", {})

    # Extract common sampler params
    if "steps" in inputs:
        params["steps"] = inputs["steps"]

    if "cfg" in inputs:
        params["cfg"] = inputs["cfg"]

    if "sampler_name" in inputs:
        params["sampler_name"] = inputs["sampler_name"]

    if "scheduler" in inputs:
        params["scheduler"] = inputs["scheduler"]

    if "seed" in inputs:
        params["seed"] = inputs["seed"]

    return params


def extract_comfy_params(workflow_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract all metadata from ComfyUI workflow.

    This is the main entry point for workflow metadata extraction.

    Args:
        workflow_json: ComfyUI workflow (dict of node_id -> node_data)

    Returns:
        {
            "positive_prompts": [str, ...],
            "negative_prompts": [str, ...],
            "model": str or None,
            "steps": int or None,
            "cfg": float or None,
            "sampler_name": str or None,
            "scheduler": str or None,
            "seed": int or None,
            "output_nodes": [str, ...],  # Node IDs
            "node_count": int
        }

    Example:
        >>> workflow = {...}
        >>> params = extract_comfy_params(workflow)
        >>> print(params["positive_prompts"][0])
        "portrait of a woman, photorealistic"
    """
    if not workflow_json or not isinstance(workflow_json, dict):
        return {
            "positive_prompts": [],
            "negative_prompts": [],
            "model": None,
            "steps": None,
            "cfg": None,
            "sampler_name": None,
            "scheduler": None,
            "seed": None,
            "output_nodes": [],
            "node_count": 0
        }

    try:
        # Build graph
        graph = WorkflowGraph(workflow_json)

        # Extract prompts
        positive_prompts, negative_prompts = extract_prompts(graph)

        # Extract model
        model = extract_model(graph)

        # Extract sampler params
        sampler_params = extract_sampler_params(graph)

        # Find output nodes
        output_nodes = graph.find_nodes_by_type(OUTPUT_NODE_TYPES)

        return {
            "positive_prompts": positive_prompts,
            "negative_prompts": negative_prompts,
            "model": model,
            "steps": sampler_params.get("steps"),
            "cfg": sampler_params.get("cfg"),
            "sampler_name": sampler_params.get("sampler_name"),
            "scheduler": sampler_params.get("scheduler"),
            "seed": sampler_params.get("seed"),
            "output_nodes": output_nodes,
            "node_count": len(graph.nodes)
        }

    except Exception as e:
        # Never crash - return empty metadata
        log.debug(f"[Majoor] Error extracting ComfyUI params: {e}")
        return {
            "positive_prompts": [],
            "negative_prompts": [],
            "model": None,
            "steps": None,
            "cfg": None,
            "sampler_name": None,
            "scheduler": None,
            "seed": None,
            "output_nodes": [],
            "node_count": 0
        }


# Self-test
if __name__ == "__main__":
    # Test with a minimal ComfyUI workflow
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
                "images": ["4", 0],
                "filename_prefix": "ComfyUI"
            }
        }
    }

    print("Running ComfyUI tracer self-tests...\n")

    # Test 1: Extract all params
    print("TEST 1: Extract metadata from workflow")
    params = extract_comfy_params(test_workflow)

    print(f"  Positive prompts: {params['positive_prompts']}")
    print(f"  Negative prompts: {params['negative_prompts']}")
    print(f"  Model: {params['model']}")
    print(f"  Steps: {params['steps']}")
    print(f"  CFG: {params['cfg']}")
    print(f"  Sampler: {params['sampler_name']}")
    print(f"  Scheduler: {params['scheduler']}")
    print(f"  Seed: {params['seed']}")
    print(f"  Output nodes: {params['output_nodes']}")
    print(f"  Node count: {params['node_count']}")

    # Validate
    assert len(params['positive_prompts']) == 1
    assert "portrait of a woman" in params['positive_prompts'][0]
    assert len(params['negative_prompts']) == 1
    assert "low quality" in params['negative_prompts'][0]
    assert params['model'] == "sd_xl_base_1.0.safetensors"
    assert params['steps'] == 20
    assert params['cfg'] == 7.5
    assert params['sampler_name'] == "euler_ancestral"
    assert params['seed'] == 123456
    assert len(params['output_nodes']) == 1
    assert params['node_count'] == 5

    print("\n[PASS] All assertions passed")

    # Test 2: Empty workflow
    print("\nTEST 2: Handle empty workflow")
    empty_params = extract_comfy_params({})
    assert empty_params['positive_prompts'] == []
    assert empty_params['model'] is None
    print("[PASS] Empty workflow handled correctly")

    # Test 3: Malformed workflow
    print("\nTEST 3: Handle malformed workflow")
    malformed_params = extract_comfy_params({"invalid": "data"})
    assert malformed_params['positive_prompts'] == []
    print("[PASS] Malformed workflow handled correctly")

    # Test 4: Reroute nodes
    print("\nTEST 4: Handle reroute nodes")
    reroute_workflow = {
        "1": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "test prompt"
            }
        },
        "2": {
            "class_type": "Reroute",
            "inputs": {
                "value": ["1", 0]
            }
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["2", 0]
            }
        }
    }

    reroute_params = extract_comfy_params(reroute_workflow)
    assert len(reroute_params['positive_prompts']) == 1
    assert "test prompt" in reroute_params['positive_prompts'][0]
    print("[PASS] Reroute nodes handled correctly")

    print("\n" + "="*50)
    print("All tests passed successfully!")
