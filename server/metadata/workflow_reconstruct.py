from typing import Any, Dict, List


def prompt_graph_to_workflow(prompt_graph: Dict[str, Any]) -> Dict[str, Any]:
    """
    Rebuild a minimal workflow (nodes: [...]) from the prompt_graph map id->node.
    - Adds numeric version expected by ComfyUI.
    - Normalizes ids to int when possible to avoid "expected number" errors.
    - Always provides last_node_id / last_link_id / links for the loader.
    """
    nodes: List[Dict[str, Any]] = []
    links: List[List[Any]] = []
    max_id: int = -1
    last_link_id: int = 0

    for nid, node in (prompt_graph or {}).items():
        if not isinstance(node, dict):
            continue

        try:
            nid_int: Any = int(nid)
        except Exception:
            nid_int = nid
        if isinstance(nid_int, int):
            max_id = max(max_id, nid_int)

        inputs_dict = node.get("inputs", {}) if isinstance(node.get("inputs"), dict) else {}
        inputs_arr: List[Dict[str, Any]] = []

        for idx, (iname, ival) in enumerate(inputs_dict.items()):
            inp_entry: Dict[str, Any] = {"name": iname, "type": "ANY"}
            if isinstance(ival, (list, tuple)) and len(ival) >= 2 and isinstance(ival[0], (str, int)):
                try:
                    src_id = int(ival[0])
                except Exception:
                    src_id = ival[0] if ival[0] is not None else 0
                try:
                    src_slot = int(ival[1])
                except Exception:
                    src_slot = 0
                last_link_id += 1
                link_id = last_link_id
                dest_id = nid_int if isinstance(nid_int, int) else (nid if nid is not None else 0)
                links.append([link_id, src_id, src_slot, dest_id, idx, "ANY"])
                inp_entry["link"] = link_id
            else:
                inp_entry["value"] = ival
            inputs_arr.append(inp_entry)

        entry: Dict[str, Any] = {
            "id": nid_int,
            "class_type": node.get("class_type"),
            "type": node.get("class_type") or node.get("title") or "Unknown",
            "inputs": inputs_arr,
            "outputs": [],
        }
        if node.get("title"):
            entry["title"] = node.get("title")
        if node.get("widgets_values") is not None:
            entry["widgets_values"] = node.get("widgets_values")

        nodes.append(entry)

    return {
        "last_node_id": max_id if max_id >= 0 else 0,
        "last_link_id": last_link_id,
        "links": links,
        "nodes": nodes,
        "version": 1,
    }


__all__ = ["prompt_graph_to_workflow"]

