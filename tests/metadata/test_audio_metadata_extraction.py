import json

import pytest

from backend.features.audio.metadata import extract_audio_metadata
from shared.types import classify_file


@pytest.mark.asyncio
async def test_audio_classification_supports_aiff_and_aif() -> None:
    assert classify_file("track.aiff") == "audio"
    assert classify_file("track.aif") == "audio"


@pytest.mark.asyncio
async def test_audio_extractor_reads_generation_json_from_tags(tmp_path) -> None:
    audio = tmp_path / "track.m4a"
    audio.write_bytes(b"")

    workflow = {"nodes": [{"id": 1, "type": "SaveAudio"}], "links": []}
    prompt = {
        "1": {"class_type": "LoadAudio", "inputs": {}},
        "2": {"class_type": "SaveAudio", "inputs": {"audio": ["1", 0]}},
    }
    exif = {
        "QuickTime:Workflow": json.dumps(workflow),
        "QuickTime:Prompt": json.dumps(prompt),
    }
    ffprobe = {
        "audio_stream": {"codec_name": "aac", "sample_rate": "48000", "channels": 2},
        "format": {"duration": "3.2", "bit_rate": "192000"},
    }

    res = extract_audio_metadata(str(audio), exif_data=exif, ffprobe_data=ffprobe)
    assert res.ok
    assert isinstance(res.data.get("workflow"), dict)
    assert isinstance(res.data.get("prompt"), dict)
    assert res.data.get("audio_codec") == "aac"
    assert str(res.data.get("duration")) == "3.2"
