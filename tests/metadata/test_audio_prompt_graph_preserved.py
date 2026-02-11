from backend.features.audio.metadata import extract_audio_metadata


def test_audio_prompt_graph_not_overwritten_by_parameters_text():
    path = __file__
    prompt_graph_text = (
        '{"13":{"inputs":{"conditioning":["18",0]},"class_type":"ConditioningZeroOut"},'
        '"18":{"inputs":{"text":"hello"},"class_type":"CLIPTextEncode"}}'
    )
    exif_data = {
        "ID3v2_4:Prompt": prompt_graph_text,
        "Comment": "prompt: cinematic synth melody, Steps: 30, Sampler: euler, CFG scale: 6.0, Seed: 42",
    }

    res = extract_audio_metadata(path, exif_data=exif_data, ffprobe_data={})
    assert res.ok
    data = res.data or {}
    assert isinstance(data.get("prompt"), dict)
    assert "13" in data["prompt"]
    assert data.get("parameters")
