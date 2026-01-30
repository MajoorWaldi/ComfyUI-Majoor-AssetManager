import pytest


from backend.features.geninfo.parser import parse_geninfo_from_prompt


@pytest.mark.asyncio
async def test_geninfo_parser_extracts_basic_fields():
    # Minimal Comfy prompt graph: Checkpoint -> CLIPTextEncode -> KSampler -> SaveImage
    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sdxl.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "a cat", "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry", "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "seed": 123,
                "steps": 25,
                "cfg": 6.5,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "denoise": 1.0,
            },
        },
        "6": {"class_type": "SaveImage", "inputs": {"images": ["5", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None

    gi = res.data
    assert gi["positive"]["value"] == "a cat"
    assert gi["negative"]["value"] == "blurry"
    assert gi["checkpoint"]["name"] == "sdxl"
    assert gi["sampler"]["name"] == "dpmpp_2m"
    assert gi["scheduler"]["name"] == "karras"
    assert gi["steps"]["value"] == 25
    assert gi["cfg"]["value"] == 6.5
    assert gi["seed"]["value"] == 123
    assert gi["denoise"]["value"] == 1.0
    assert gi["size"]["width"] == 1024
    assert gi["size"]["height"] == 1024


@pytest.mark.asyncio
async def test_geninfo_parser_returns_none_when_no_sink():
    prompt = {"1": {"class_type": "KSampler", "inputs": {"seed": 1}}}
    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is None


@pytest.mark.asyncio
async def test_geninfo_parser_video_sink_and_sdxl_text_fields():
    # Typical video pipelines use VHS_* sinks and SDXL text encode nodes.
    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "video_model.safetensors"}},
        "2": {"class_type": "CLIPTextEncodeSDXL", "inputs": {"text_g": "a running fox", "text_l": "cinematic", "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncodeSDXL", "inputs": {"text_g": "low quality", "text_l": "", "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 768, "height": 432}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "seed": 42,
                "steps": 18,
                "cfg": 5.0,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
            },
        },
        "6": {"class_type": "VHS_SaveVideo", "inputs": {"video": ["5", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    gi = res.data
    assert "running fox" in gi["positive"]["value"]
    assert "cinematic" in gi["positive"]["value"]
    assert "low quality" in gi["negative"]["value"]
    assert gi["checkpoint"]["name"] == "video_model"
    assert gi["sampler"]["name"] == "euler"
    assert gi["steps"]["value"] == 18
    assert gi["size"]["width"] == 768


@pytest.mark.asyncio
async def test_geninfo_parser_collects_prompts_through_conditioning_nodes():
    # Positive/negative passed through Conditioning* composition nodes should still extract texts.
    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sdxl.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "pos a", "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "pos b", "clip": ["1", 1]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "neg a", "clip": ["1", 1]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "neg b", "clip": ["1", 1]}},
        "6": {"class_type": "ConditioningCombine", "inputs": {"conditioning_1": ["2", 0], "conditioning_2": ["3", 0]}},
        "7": {"class_type": "ConditioningConcat", "inputs": {"conditioning_1": ["4", 0], "conditioning_2": ["5", 0]}},
        "8": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512}},
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["8", 0],
                "seed": 1,
                "steps": 5,
                "cfg": 2.0,
                "sampler_name": "euler",
                "scheduler": "normal",
            },
        },
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    gi = res.data
    assert "pos a" in gi["positive"]["value"]
    assert "pos b" in gi["positive"]["value"]
    assert "neg a" in gi["negative"]["value"]
    assert "neg b" in gi["negative"]["value"]
    assert gi["positive"]["value"].strip() != gi["negative"]["value"].strip()


@pytest.mark.asyncio
async def test_geninfo_parser_keeps_positive_negative_separate_through_passthrough_nodes():
    # Some video pipelines route conditioning through non-Conditioning nodes that expose
    # `positive`/`negative` inputs (ex: Wan/VHS helper nodes). We must not mix branches.
    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "wan_model.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "POS ONLY", "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "NEG ONLY", "clip": ["1", 1]}},
        "20": {"class_type": "WanPhantomSubjectToVideo", "inputs": {"positive": ["2", 0], "negative": ["3", 0]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["20", 0],
                "negative": ["20", 1],
                "latent_image": ["4", 0],
                "seed": 1,
                "steps": 5,
                "cfg": 2.0,
                "sampler_name": "euler",
                "scheduler": "normal",
            },
        },
        "6": {"class_type": "VHS_SaveVideo", "inputs": {"video": ["5", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    gi = res.data
    assert gi["positive"]["value"].strip() == "POS ONLY"
    assert gi["negative"]["value"].strip() == "NEG ONLY"


@pytest.mark.asyncio
async def test_geninfo_parser_prefers_savevideo_over_previewimage():
    # Some video graphs include both PreviewImage and SaveVideo sinks; prefer SaveVideo.
    prompt = {
        "10": {"class_type": "CLIPLoader", "inputs": {"clip_name": "clip.safetensors"}},
        "11": {"class_type": "VAELoader", "inputs": {"vae_name": "vae.safetensors"}},
        "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "POS", "clip": ["10", 0]}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "NEG", "clip": ["10", 0]}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["20", 0],
                "positive": ["1", 0],
                "negative": ["2", 0],
                "steps": 10,
                "cfg": 2,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "seed": 123,
            },
        },
        "4": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["11", 0]}},
        "5": {"class_type": "CreateVideo", "inputs": {"fps": 16, "images": ["4", 0]}},
        "6": {"class_type": "SaveVideo", "inputs": {"video": ["5", 0], "filename_prefix": "x"}},
        "7": {"class_type": "PreviewImage", "inputs": {"images": ["4", 0]}},
        "20": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    assert res.data.get("positive", {}).get("value") == "POS"
    assert res.data.get("negative", {}).get("value") == "NEG"


@pytest.mark.asyncio
async def test_geninfo_parser_handles_wan_video_text_embeds_and_sampler():
    # Wan stacks: sampler is WanVideoSampler; prompts live in WanVideoTextEncode and flow via `text_embeds`.
    prompt = {
        "10": {"class_type": "WanVideoModelLoader", "inputs": {"model_name": "WanVideo\\Wan2_1-T2V-14B-Phantom_fp8_e4m3fn_scaled_KJ.safetensors"}},
        "11": {"class_type": "WanVideoTextEncode", "inputs": {"positive": "a fox running", "negative": "low quality"}},
        "12": {"class_type": "WanVideoSampler", "inputs": {"model": ["10", 0], "text_embeds": ["11", 0], "steps": 12, "cfg": 3.0, "seed": 1234}},
        "13": {"class_type": "WanVideoDecode", "inputs": {"samples": ["12", 0]}},
        "14": {"class_type": "VHS_VideoCombine", "inputs": {"images": ["13", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    gi = res.data
    assert "fox" in gi["positive"]["value"]
    assert "low quality" in gi["negative"]["value"]
    assert gi["checkpoint"]["name"].lower().startswith("wan2_1-t2v-14b-phantom")
    assert gi["steps"]["value"] == 12
    assert gi["cfg"]["value"] == 3.0
    assert gi["seed"]["value"] == 1234


@pytest.mark.asyncio
async def test_geninfo_parser_follows_rgthree_switch_nodes_for_model_chain_and_power_lora_loader():
    # Some real graphs (rgthree) insert switch/select nodes between the sampler model input
    # and the actual model loader. Ensure we traverse these to recover a checkpoint/unet name.
    prompt = {
        "125": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": "WAN\\Phantom_Wan_14B-Q4_K_S.gguf"}},
        "124": {"class_type": "Any Switch (rgthree)", "inputs": {"any_01": ["125", 0]}},
        "111": {"class_type": "ModelPatchTorchSettings", "inputs": {"model": ["124", 0]}},
        "109": {
            "class_type": "Power Lora Loader (rgthree)",
            "inputs": {
                "lora_1": {"on": True, "lora": "WAN\\my_lora_v1.safetensors", "strength": 1},
                "model": ["111", 0],
            },
        },
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "POS", "clip": ["10", 0]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "NEG", "clip": ["10", 0]}},
        "10": {"class_type": "CLIPLoader", "inputs": {"clip_name": "clip.safetensors"}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["109", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "steps": 8,
                "cfg": 1.0,
                "sampler_name": "uni_pc",
                "scheduler": "simple",
                "seed": 451,
            },
        },
        "6": {"class_type": "VHS_VideoCombine", "inputs": {"images": ["5", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    gi = res.data
    assert gi["checkpoint"]["name"] == "Phantom_Wan_14B-Q4_K_S"
    assert gi.get("models", {}).get("unet", {}).get("name") == "Phantom_Wan_14B-Q4_K_S"
    assert isinstance(gi.get("loras"), list)
    assert gi["loras"][0]["name"] == "my_lora_v1"


@pytest.mark.asyncio
async def test_geninfo_parser_supports_non_numeric_node_ids_in_links():
    # Some exporters encode prompt node ids like "57:35". Links should still resolve.
    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sdxl.safetensors"}},
        "10": {"class_type": "CLIPLoader", "inputs": {"clip_name": "clip.safetensors"}},
        "57:35": {"class_type": "CLIPTextEncode", "inputs": {"text": "POS", "clip": ["10", 0]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "NEG", "clip": ["10", 0]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["57:35", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "seed": 1,
                "steps": 5,
                "cfg": 2.0,
                "sampler_name": "euler",
                "scheduler": "normal",
            },
        },
        "6": {"class_type": "SaveImage", "inputs": {"images": ["5", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    assert res.data.get("positive", {}).get("value") == "POS"
    assert res.data.get("negative", {}).get("value") == "NEG"


@pytest.mark.asyncio
async def test_geninfo_parser_resolves_linked_text_inputs_for_clip_text_encode():
    # Some nodes provide the prompt text through a linked "string" node.
    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
        "10": {"class_type": "CLIPLoader", "inputs": {"clip_name": "clip.safetensors"}},
        "75": {"class_type": "StringLiteral", "inputs": {"text": "a prompt from link"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": ["75", 0], "clip": ["10", 0]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["10", 0]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "seed": 1,
                "steps": 5,
                "cfg": 2.0,
                "sampler_name": "euler",
                "scheduler": "normal",
            },
        },
        "6": {"class_type": "SaveImage", "inputs": {"images": ["5", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    assert "prompt from link" in res.data.get("positive", {}).get("value", "")

@pytest.mark.asyncio
async def test_geninfo_parser_handles_sampler_custom_advanced_flux_pipeline():
    # Flux pipelines can use SamplerCustomAdvanced + BasicScheduler + KSamplerSelect + RandomNoise.
    prompt = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux1-dev.safetensors"}},
        "2": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "t5xxl_fp16.safetensors", "clip_name2": "clip_l.safetensors"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "a fox", "clip": ["2", 0]}},
        "5": {"class_type": "FluxGuidance", "inputs": {"guidance": 3.5, "conditioning": ["4", 0]}},
        "6": {"class_type": "BasicGuider", "inputs": {"model": ["9", 0], "conditioning": ["5", 0]}},
        "7": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "8": {"class_type": "BasicScheduler", "inputs": {"scheduler": "simple", "steps": 20, "denoise": 1.0, "model": ["9", 0]}},
        "9": {"class_type": "ModelSamplingFlux", "inputs": {"model": ["1", 0]}},
        "10": {"class_type": "RandomNoise", "inputs": {"noise_seed": 123}},
        "11": {"class_type": "EmptySD3LatentImage", "inputs": {"width": 1024, "height": 1024}},
        "12": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["10", 0], "guider": ["6", 0], "sampler": ["7", 0], "sigmas": ["8", 0], "latent_image": ["11", 0]}},
        "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["3", 0]}},
        "14": {"class_type": "SaveImage", "inputs": {"images": ["13", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    gi = res.data
    assert gi["engine"]["sampler_mode"] == "advanced"
    assert gi["positive"]["value"] == "a fox"
    assert gi["sampler"]["name"] == "euler"
    assert gi["steps"]["value"] == 20
    assert gi["cfg"]["value"] == 3.5
    assert gi["seed"]["value"] == 123
    assert gi["size"]["width"] == 1024
    assert gi["models"]["unet"]["name"] == "flux1-dev"
    assert "t5xxl_fp16" in gi["models"]["clip"]["name"]
    assert "clip_l" in gi["models"]["clip"]["name"]


@pytest.mark.asyncio
async def test_geninfo_parser_falls_back_to_global_sampler_when_sink_unlinked():
    # Some graphs embed a full prompt graph but the saved output branch may be a different node chain.
    # We still want a best-effort extraction from the sampler node present in the graph.
    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "pos", "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "neg", "clip": ["1", 1]}},
        "4": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "seed": 42,
                "steps": 10,
                "cfg": 2.0,
                "sampler_name": "euler",
                "scheduler": "normal",
            },
        },
        # Unrelated SaveImage branch
        "10": {"class_type": "LoadImage", "inputs": {"image": "x.png"}},
        "11": {"class_type": "SaveImage", "inputs": {"images": ["10", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    assert res.data["engine"]["sampler_mode"] == "global"
    assert res.data["positive"]["value"] == "pos"
    assert res.data["negative"]["value"] == "neg"
    assert res.data["checkpoint"]["name"] == "model"


@pytest.mark.asyncio
async def test_geninfo_parser_extracts_prompts_from_conditioning_text_nodes():
    # Custom nodes can output CONDITIONING directly with a `text` field but no `clip` link.
    prompt = {
        "10": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "m.safetensors"}},
        "1": {"class_type": "ConditioningText", "inputs": {"text": "POS PROMPT"}},
        "2": {"class_type": "ConditioningText", "inputs": {"text": "NEG PROMPT"}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["10", 0],
                "positive": ["1", 0],
                "negative": ["2", 0],
                "steps": 10,
                "cfg": 2.0,
                "sampler_name": "euler",
                "scheduler": "normal",
            },
        },
        "4": {"class_type": "SaveImage", "inputs": {"images": ["3", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    assert res.data["positive"]["value"] == "POS PROMPT"
    assert res.data["negative"]["value"] == "NEG PROMPT"


@pytest.mark.asyncio
async def test_geninfo_parser_extracts_prompts_from_sampler_string_inputs():
    # Some custom sampler nodes keep prompts as direct string fields.
    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "m.safetensors"}},
        "2": {
            "class_type": "MyCustomSampler",
            "inputs": {
                "model": ["1", 0],
                "positive_prompt": "a cinematic fox portrait",
                "negative_prompt": "blurry, low quality",
                "steps": 12,
                "cfg": 3.0,
                "sampler_name": "euler",
            },
        },
        "3": {"class_type": "SaveImage", "inputs": {"images": ["2", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    assert "cinematic fox" in res.data["positive"]["value"]
    assert "low quality" in res.data["negative"]["value"]


@pytest.mark.asyncio
async def test_geninfo_parser_handles_loadcheckpoint_nodes():
    # Some graphs use "LoadCheckpoint" naming rather than CheckpointLoaderSimple.
    prompt = {
        "1": {"class_type": "LoadCheckpoint", "inputs": {"ckpt_name": "my_ckpt.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "a cat", "clip": ["1", 1]}},
        "3": {"class_type": "EmptyLatentImage", "inputs": {"width": 256, "height": 256}},
        "4": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "latent_image": ["3", 0],
                "seed": 123,
                "steps": 10,
                "cfg": 3.5,
                "sampler_name": "euler",
                "scheduler": "normal",
            },
        },
        "5": {"class_type": "SaveImage", "inputs": {"images": ["4", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    gi = res.data
    assert gi["checkpoint"]["name"] == "my_ckpt"


@pytest.mark.asyncio
async def test_geninfo_parser_traces_checkpoint_through_model_sampling_nodes():
    # Video stacks often insert ModelSampling* nodes between LoRA and the sampler.
    prompt = {
        "1": {"class_type": "LoadCheckpoint", "inputs": {"ckpt_name": "base_model.safetensors"}},
        "2": {
            "class_type": "LoRALoaderModelOnly",
            "inputs": {"model": ["1", 0], "lora_name": "my_lora.safetensors", "strength_model": 0.8},
        },
        "3": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["2", 0], "shift": 5.0}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "pos", "clip": ["1", 1]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "neg", "clip": ["1", 1]}},
        "6": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512}},
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["3", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
                "seed": 1,
                "steps": 5,
                "cfg": 2.0,
                "sampler_name": "euler",
                "scheduler": "normal",
            },
        },
        "8": {"class_type": "SaveImage", "inputs": {"images": ["7", 0]}},
    }

    res = parse_geninfo_from_prompt(prompt)
    assert res.ok
    assert res.data is not None
    gi = res.data
    assert gi["checkpoint"]["name"] == "base_model"
    assert gi["models"]["checkpoint"]["name"] == "base_model"
    assert gi["loras"][0]["name"] == "my_lora"
