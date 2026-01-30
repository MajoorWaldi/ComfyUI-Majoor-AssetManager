import pytest
from backend.features.metadata.extractors import _looks_like_comfyui_prompt_graph


@pytest.mark.asyncio
async def test_prompt_graph_accepts_colon_ids():
    prompt_graph = {
        "91:1": {"class_type": "LoadImage", "inputs": {}},
        "92:2": {"class_type": "TextEncode", "inputs": {}},
        "93:3": {"class_type": "KSampler", "inputs": {}},
        "94:4": {"class_type": "SaveImage", "inputs": {}},
    }

    assert _looks_like_comfyui_prompt_graph(prompt_graph)
