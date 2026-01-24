import json

from backend.features.metadata.extractors import extract_video_metadata


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


def test_video_extractor_detects_workflow_json_in_comment(tmp_path):
    video = tmp_path / "test.mp4"
    video.write_bytes(b"")

    exif = {"QuickTime:Comment": json.dumps(_dummy_workflow())}
    res = extract_video_metadata(str(video), exif_data=exif, ffprobe_data=None)
    assert res.ok
    assert res.data["workflow"] is not None
    assert isinstance(res.data["workflow"], dict)
    assert res.data["workflow"].get("nodes")


def test_video_extractor_detects_prompt_graph_json_in_comment(tmp_path):
    video = tmp_path / "test.mp4"
    video.write_bytes(b"")

    exif = {"QuickTime:Comment": json.dumps(_dummy_prompt_graph())}
    res = extract_video_metadata(str(video), exif_data=exif, ffprobe_data=None)
    assert res.ok
    assert res.data["prompt"] is not None
    assert isinstance(res.data["prompt"], dict)
    assert "1" in res.data["prompt"]


def test_video_extractor_supports_duplicate_prompt_tags(tmp_path):
    video = tmp_path / "test.mp4"
    video.write_bytes(b"")

    exif = {"QuickTime:Prompt": ["not json", json.dumps(_dummy_prompt_graph())]}
    res = extract_video_metadata(str(video), exif_data=exif, ffprobe_data=None)
    assert res.ok
    assert isinstance(res.data["prompt"], dict)


def test_video_extractor_reads_embedded_json_from_ffprobe_tags(tmp_path):
    video = tmp_path / "test.mp4"
    video.write_bytes(b"")

    # No sidecar fallback: use ffprobe container tags instead.
    ffprobe_data = {
        "format": {"tags": {"comfyui:workflow": json.dumps(_dummy_workflow()), "comfyui:prompt": json.dumps(_dummy_prompt_graph())}},
        "streams": [],
    }

    res = extract_video_metadata(str(video), exif_data=None, ffprobe_data=ffprobe_data)
    assert res.ok
    assert isinstance(res.data["workflow"], dict)
    assert isinstance(res.data["prompt"], dict)


def test_video_extractor_uses_ffprobe_tags(tmp_path):
    video = tmp_path / "test.mp4"
    video.write_bytes(b"")

    ffprobe = {"format": {"tags": {"comment": "workflow: " + json.dumps(_dummy_workflow())}}}
    res = extract_video_metadata(str(video), exif_data={}, ffprobe_data=ffprobe)
    assert res.ok
    assert isinstance(res.data["workflow"], dict)
