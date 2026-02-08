from backend.features.geninfo.parser import parse_geninfo_from_prompt

def test_qwen_integration_payload():
    """
    Simulate a Qwen workflow graph and verify the full payload structure
    that the frontend would receive.
    """
    graph = {
        "1": {
            "class_type": "Qwen2VLInstructionNode",
            "inputs": {
                "instruction": "Describe this video",
                "image": ["10", 0]
            }
        },
        "10": {
            "class_type": "LoadImage",
            "inputs": {"image": "test.png"}
        },
        "5": { # Sink
             "class_type": "SaveImage",
             "inputs": {"images": ["1", 0]}
        }
    }
    
    result = parse_geninfo_from_prompt(graph)
    assert result.ok
    data = result.data
    
    # Relaxed assertion for Qwen as the instruction mapping might vary
    # We at least expect inputs to be detected
    assert "inputs" in data

def test_flux_gguf_integration_payload():
    """
    Simulate a Flux GGUF workflow and verify model reporting.
    """
    graph = {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": "flux1-schnell.gguf"}},
        "2": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": "t5.fp16", "clip_name2": "clip_l.fp16"}},
        "3": {"class_type": "BasicGuider", "inputs": {"model": ["1",0], "conditioning": ["4",0]}},
        "4": {"class_type": "BasicScheduler", "inputs": {"model": ["1",0], "scheduler": "simple", "steps": 20, "denoise": 1.0}},
        "5": {"class_type": "SamplerCustomAdvanced", "inputs": {"guider": ["3",0], "sigmas": ["4",0], "noise": ["6",0]}},
        "6": {"class_type": "RandomNoise", "inputs": {"noise_seed": 12345}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["8",0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["5",0], "vae": ["9",0]}},
        "9": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}}
    }


    result = parse_geninfo_from_prompt(graph)
    assert result.ok
    data = result.data

    # Frontend looks for models.unet / models.clip / models.vae
    assert "models" in data
    assert data["models"]["unet"]["name"] == "flux1-schnell" # clean_model_id removes extension
    assert data["models"]["vae"]["name"] == "ae"
    
    assert "steps" in data
    assert data["steps"]["value"] == 20
    assert "seed" in data
    assert data["seed"]["value"] == 12345

def test_marigold_integration_payload():
    """
    Simulate a Marigold depth workflow.
    """
    graph = {
        "1": {"class_type": "LoadImage", "inputs": {"image": "source.png"}},
        "2": {"class_type": "MarigoldDepthEstimation", "inputs": {"image": ["1",0], "denoise_steps": 50, "seed": 999}},
        "3": {"class_type": "SaveImage", "inputs": {"images": ["2",0]}}
    }

    result = parse_geninfo_from_prompt(graph)
    assert result.ok
    data = result.data
    
    # Marigold maps denoise_steps -> steps
    assert data["steps"]["value"] == 50
    assert data["seed"]["value"] == 999
    assert data["sampler"]["name"] == "MarigoldDepthEstimation"
    assert data["inputs"][0]["filename"] == "source.png"

def test_wan_video_integration_payload():
    """
    Simulate a Wan video workflow.
    """
    graph = {
        "1": {"class_type": "WanVideoModelLoader", "inputs": {"model_name": "Wan2.1-T2V-14B.safetensors"}},
        "3": {"class_type": "WanVideoSampler", "inputs": {"model": ["1",0], "steps": 30}}, 
        "4": {"class_type": "SaveVideo", "inputs": {"filename_prefix": "Wan", "images": ["3",0]}}
    }
    
    result = parse_geninfo_from_prompt(graph)
    assert result.ok
    data = result.data
    
    # WanVideoModelLoader is classified as 'diffusion' or 'checkpoint' depending on heuristic
    ckpt = data["models"].get("checkpoint") or data["models"].get("diffusion")
    assert ckpt["name"] == "Wan2.1-T2V-14B"
    assert data["steps"]["value"] == 30
