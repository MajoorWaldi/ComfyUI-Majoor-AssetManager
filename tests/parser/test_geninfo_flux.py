from backend.features.geninfo.parser import parse_geninfo_from_prompt

def test_geninfo_flux_standard_advanced_sampler():
    """
    Simulate a standard Flux workflow with SamplerCustomAdvanced, BasicGuider, BasicScheduler, FluxGuidance.
    """
    prompt_graph = {
        # 1. Output Sink
        "100": {
            "class_type": "SaveImage",
            "inputs": {"images": [90, 0]} 
        },
        # 2. VAE Decode
        "90": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": [80, 0],
                "vae": [10, 0]
            }
        },
        # 3. SamplerCustomAdvanced
        "80": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": [70, 0],
                "guider": [60, 0],   # Link to BasicGuider
                "sampler": [50, 0],  # Link to KSamplerSelect
                "sigmas": [40, 0],   # Link to BasicScheduler
                "latent_image": [15, 0]
            }
        },
        # 4. RandomNoise
        "70": {
            "class_type": "RandomNoise",
            "inputs": {"noise_seed": 99999} # Seed source
        },
        # 5. BasicGuider
        "60": {
            "class_type": "BasicGuider",
            "inputs": {
                "conditioning": [55, 0], # FluxGuidance
                "model": [20, 0]
            }
        },
        # 5b. FluxGuidance (often used for guidance value)
        "55": {
            "class_type": "FluxGuidance",
            "inputs": {
                "conditioning": [30, 0], # CLIP Text Encode
                "guidance": 3.5
            }
        },
        # 6. KSamplerSelect
        "50": {
            "class_type": "KSamplerSelect",
            "inputs": {"sampler_name": "euler"}
        },
        # 7. BasicScheduler
        "40": {
            "class_type": "BasicScheduler",
            "inputs": {
                "steps": 25,
                "denoise": 1.0,
                "scheduler": "simple",
                "model": [20, 0]
            }
        },
        # 8. Loaders
        "10": { "class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "20": { "class_type": "LoadDiffusionModel", "inputs": {"unet_name": "flux1-dev.safetensors"} },
        "25": { "class_type": "DualCLIPLoader", "inputs": {"clip_name1": "t5XXL.fp16.safetensors", "clip_name2": "clip_l.safetensors"} },
        
        # 9. Prompt
        "30": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "A photo of a cat",
                "clip": [25, 0]
            }
        },
        "15": { "class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024} }
    }
    
    result = parse_geninfo_from_prompt(prompt_graph)
    assert result.ok, result.error
    data = result.data
    assert data is not None
    
    # Check sampler params
    assert data["steps"]["value"] == 25
    assert data["seed"]["value"] == 99999
    assert data["cfg"]["value"] == 3.5 # Extracted from FluxGuidance
    
    # Check Prompt
    assert data["positive"]["value"] == "A photo of a cat"
    
def test_geninfo_flux_gguf_fp8_variant():
    """
    Test variant with UnetLoaderGGUF and potentially distinct structure.
    """
    prompt_graph = {
        # Sink
        "100": { "class_type": "SaveImage", "inputs": {"images": [80, 0]} },
        "80": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": [70, 0],
                "guider": [60, 0],
                "sampler": [50, 0],
                "sigmas": [40, 0],
                "latent_image": [15, 0]
            }
        },
        "70": { "class_type": "RandomNoise", "inputs": {"noise_seed": 12345} },
        # CFGGuider usage? Or just BasicGuider? Let's use BasicGuider without FluxGuidance (implicit guidance?)
        # Some workflows connect conditioning directly to BasicGuider.
        "60": {
            "class_type": "BasicGuider",
            "inputs": {
                "conditioning": [30, 0],
                "model": [20, 0]
            }
        },
        "50": { "class_type": "KSamplerSelect", "inputs": {"sampler_name": "uni_pc"} },
        "40": {
            "class_type": "BasicScheduler",
            "inputs": {
                "steps": 20,
                "scheduler": "beta",
                "model": [20, 0]
            }
        },
        # GGUF Loader for UNET
        "20": {
            "class_type": "UnetLoaderGGUF",
            "inputs": {"unet_name": "flux1-dev-Q8_0.gguf"}
        },
        "30": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "GGUF cat", "clip": [25, 0]}
        },
        "25": { "class_type": "DualCLIPLoader", "inputs": {"clip_name1": "t5", "clip_name2": "clip_l"} },
        "15": { "class_type": "EmptyLatentImage", "inputs": {} }
    }

    result = parse_geninfo_from_prompt(prompt_graph)
    assert result.ok
    data = result.data
    
    # Parser maps UNET/Diffusion models to 'checkpoint' field for compatibility
    assert data["checkpoint"]["name"] == "flux1-dev-Q8_0"
    
    # CFG might be missing if no FluxGuidance? 
    # Or BasicGuider doesn't have CFG.
    
    # The parser currently doesn't default CFG if missing.
    # But it should extract seed, steps.
    assert data["steps"]["value"] == 20
    assert data["seed"]["value"] == 12345
    
    # Verify Prompt was extracted
    # "GGUF cat" via BasicGuider -> conditioning
    assert data["positive"]["value"] == "GGUF cat"

