import json

from backend.features.metadata.extractors import extract_video_metadata


def test_video_extractor_parses_itemlist_comment_wrapper(tmp_path):
    video = tmp_path / "phantom_00001.mp4"
    video.write_bytes(b"\x00")

    prompt_graph = {
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "pos"}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "neg"}},
    }
    workflow = {
        "nodes": [
            {"id": 1, "type": "CLIPTextEncode", "pos": [0, 0]},
            {"id": 2, "type": "CLIPTextEncode", "pos": [0, 0]},
        ],
        "links": [],
    }

    wrapped = {
        "prompt": json.dumps(prompt_graph),
        "workflow": workflow,
    }

    exif = {"ItemList:Comment": json.dumps(wrapped)}
    res = extract_video_metadata(str(video), exif_data=exif, ffprobe_data=None)
    assert res.ok
    assert isinstance(res.data.get("workflow"), dict)
    assert isinstance(res.data.get("prompt"), dict)
    assert res.data["prompt"].get("6", {}).get("class_type") == "CLIPTextEncode"
