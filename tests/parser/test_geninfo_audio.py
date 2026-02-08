import pytest

from backend.features.geninfo.parser import parse_geninfo_from_prompt


@pytest.mark.asyncio
async def test_geninfo_detects_t2a_workflow_type() -> None:
    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": "cinematic synth melody"}},
        "3": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["2", 0]}},
        "4": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "seed": 42,
                "steps": 30,
                "cfg": 6.0,
                "sampler_name": "euler",
                "scheduler": "normal",
            },
        },
        "5": {"class_type": "SaveAudio", "inputs": {"audio": ["4", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert isinstance(res.data, dict)
    assert res.data.get("engine", {}).get("type") == "T2A"
    assert res.data.get("steps", {}).get("value") == 30


@pytest.mark.asyncio
async def test_geninfo_acestep_extracts_lyrics_and_sampler_widgets() -> None:
    prompt = {
        "40": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "ace_step_v1.safetensors"}},
        "14": {
            "class_type": "TextEncodeAceStepAudio",
            "inputs": {"clip": ["40", 1], "text": "kawaii, techno"},
            "widgets_values": ["kawaii, techno", "[verse]\\nhello world lyrics", 1.0],
        },
        "47": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["14", 0]}},
        "17": {"class_type": "EmptyAceStepLatentAudio", "inputs": {}, "widgets_values": [150, 1]},
        "3": {
            "class_type": "KSampler",
            "inputs": {"model": ["40", 0], "positive": ["14", 0], "negative": ["47", 0], "latent_image": ["17", 0]},
            "widgets_values": [611659002332535, "randomize", 50, 5.0, "euler", "simple", 1.0],
        },
        "18": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["3", 0], "vae": ["40", 2]}},
        "19": {"class_type": "SaveAudio", "inputs": {"audio": ["18", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert isinstance(res.data, dict)
    assert res.data.get("engine", {}).get("type") == "T2A"
    assert res.data.get("sampler", {}).get("name") == "euler"
    assert res.data.get("scheduler", {}).get("name") == "simple"
    assert res.data.get("steps", {}).get("value") == 50
    assert res.data.get("cfg", {}).get("value") == 5.0
    assert res.data.get("seed", {}).get("value") == 611659002332535
    assert "hello world lyrics" in str(res.data.get("lyrics", {}).get("value") or "")


@pytest.mark.asyncio
async def test_geninfo_detects_a2a_workflow_type() -> None:
    prompt = {
        "1": {"class_type": "LoadAudio", "inputs": {"audio": "input.wav"}},
        "2": {"class_type": "SaveAudio", "inputs": {"audio": ["1", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert isinstance(res.data, dict)
    inputs = res.data.get("inputs") or []
    assert isinstance(inputs, list) and inputs
    assert any(str(i.get("type")) == "audio" for i in inputs if isinstance(i, dict))
