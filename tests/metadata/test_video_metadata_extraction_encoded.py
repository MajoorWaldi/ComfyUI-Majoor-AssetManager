import base64
import json
import zlib

from backend.features.metadata.extractors import extract_video_metadata


def _prompt_graph():
    # Minimal prompt graph shape expected by heuristics:
    # {"3": {"class_type": "...", "inputs": {...}}, ...}
    return {
        "3": {"class_type": "KSampler", "inputs": {"steps": 20}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "hello"}},
    }


def test_video_extractor_parses_double_encoded_prompt(tmp_path):
    f = tmp_path / "x.mp4"
    f.write_bytes(b"\x00")

    pg = _prompt_graph()
    # Tag value is a JSON string literal containing JSON.
    double = json.dumps(json.dumps(pg))
    exif = {"QuickTime:Prompt": double}
    res = extract_video_metadata(str(f), exif_data=exif, ffprobe_data=None)
    assert res.ok
    assert isinstance(res.data.get("prompt"), dict)
    assert res.data["prompt"].get("3", {}).get("class_type") == "KSampler"


def test_video_extractor_parses_base64_prompt(tmp_path):
    # Create a tiny dummy file so extract_video_metadata passes existence check.
    f = tmp_path / "x.mp4"
    f.write_bytes(b"\x00")

    pg = _prompt_graph()
    b64 = base64.b64encode(json.dumps(pg).encode("utf-8")).decode("ascii")
    ffprobe = {"format": {"tags": {"comment": b64}}, "streams": []}

    res = extract_video_metadata(str(f), exif_data={}, ffprobe_data=ffprobe)
    assert res.ok
    assert isinstance(res.data.get("prompt"), dict)
    assert res.data["prompt"].get("3", {}).get("class_type") == "KSampler"


def test_video_extractor_parses_zlib_base64_prompt(tmp_path):
    f = tmp_path / "x.mp4"
    f.write_bytes(b"\x00")

    pg = _prompt_graph()
    compressed = zlib.compress(json.dumps(pg).encode("utf-8"))
    b64 = base64.b64encode(compressed).decode("ascii")
    ffprobe = {"format": {"tags": {"description": b64}}, "streams": []}

    res = extract_video_metadata(str(f), exif_data={}, ffprobe_data=ffprobe)
    assert res.ok
    assert isinstance(res.data.get("prompt"), dict)
    assert res.data["prompt"].get("4", {}).get("class_type") == "CLIPTextEncode"


def test_video_extractor_scans_stream_tags(tmp_path):
    f = tmp_path / "x.mp4"
    f.write_bytes(b"\x00")

    pg = _prompt_graph()
    ffprobe = {
        "format": {"tags": {}},
        "streams": [{"tags": {"comfyui:prompt": json.dumps(pg)}}],
    }
    res = extract_video_metadata(str(f), exif_data={}, ffprobe_data=ffprobe)
    assert res.ok
    assert isinstance(res.data.get("prompt"), dict)
    assert res.data["prompt"].get("3", {}).get("inputs", {}).get("steps") == 20
