import pytest
import json

from backend.features.metadata.extractors import extract_png_metadata, extract_webp_metadata


def _dummy_workflow():
    return {
        "nodes": [
            {"id": 1, "type": "CheckpointLoaderSimple", "pos": [0, 0], "size": [100, 60]},
            {"id": 2, "type": "KSampler", "pos": [200, 0], "size": [120, 60]},
        ],
        "links": [[1, 1, 0, 2, 0, "MODEL"]],
    }


def _dummy_prompt_graph():
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "a.safetensors"}},
        "2": {"class_type": "KSampler", "inputs": {"model": ["1", 0]}},
    }


@pytest.mark.asyncio
async def test_png_extractor_does_not_misclassify_prompt_graph_as_workflow(tmp_path):
    img = tmp_path / "test.png"
    img.write_bytes(b"")

    # Some tools/extensions may store prompt-graph JSON under a key containing "workflow".
    exif = {"PNG:Workflow": json.dumps(_dummy_prompt_graph())}
    res = extract_png_metadata(str(img), exif_data=exif)
    assert res.ok
    assert res.data.get("workflow") is None
    assert isinstance(res.data.get("prompt"), dict)


@pytest.mark.asyncio
async def test_webp_extractor_does_not_misclassify_prompt_graph_as_workflow(tmp_path):
    img = tmp_path / "test.webp"
    img.write_bytes(b"")

    exif = {"EXIF:Make": "workflow: " + json.dumps(_dummy_prompt_graph())}
    res = extract_webp_metadata(str(img), exif_data=exif)
    assert res.ok
    assert res.data.get("workflow") is None
    assert isinstance(res.data.get("prompt"), dict)


@pytest.mark.asyncio
async def test_png_extractor_accepts_real_workflow_export(tmp_path):
    img = tmp_path / "test.png"
    img.write_bytes(b"")

    exif = {"PNG:workflow": json.dumps(_dummy_workflow())}
    res = extract_png_metadata(str(img), exif_data=exif)
    assert res.ok
    assert isinstance(res.data.get("workflow"), dict)
    assert res.data["workflow"].get("nodes")

