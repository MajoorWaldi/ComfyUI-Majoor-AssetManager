from backend.features.geninfo.parser import parse_geninfo_from_prompt

def test_geninfo_kijai_wanvideo():
    """
    Simulate Kijai WanVideo workflow.
    """
    prompt_graph = {
        "100": { "class_type": "SaveVideo", "inputs": {"images": [90, 0]} },
        "90": { "class_type": "VAEDecode", "inputs": {"samples": [80, 0], "vae": [10, 1]} }, # 10 is model loader, maybe it outputs VAE too
        "80": {
            "class_type": "WanVideoSampler",
            "inputs": {
                "model": [10, 0],
                "text_embeds": [50, 0],
                "steps": 25,
                "cfg": 3.0,
                "seed": 112233
            }
        },
        "50": {
            "class_type": "WanVideoTextEncode",
            "inputs": {
                "positive_prompt": "A beautiful video of a sunset",
                "negative_prompt": "garbage, low quality",
                "t5": [5, 0]
            }
        },
        "10": {
            "class_type": "WanVideoModelLoader",
            "inputs": {
                "model_name": "wan2.1-t2v-14b.safetensors",
                "precision": "fp8"
            }
        }
    }
    
    result = parse_geninfo_from_prompt(prompt_graph)
    assert result.ok
    data = result.data
    
    print(f"DEBUG: {data}")
    
    assert data["steps"]["value"] == 25
    assert data["cfg"]["value"] == 3.0
    assert data["seed"]["value"] == 112233
    
    # Check Prompts
    assert data["positive"]["value"] == "A beautiful video of a sunset"
    assert "garbage" in data["negative"]["value"]
    
    # Check Model
    assert data["checkpoint"]["name"] == "wan2.1-t2v-14b"


def test_geninfo_kijai_hunyuan():
    """
    Simulate Kijai HunyuanVideo workflow.
    """
    prompt_graph = {
        "80": {
            "class_type": "HyVideoSampler",
            "inputs": {
                "model": [10, 0],
                "hyvid_embeds": [50, 0],
                "steps": 30,
                "embedded_guidance_scale": 6.0, # Should map to CFG
                "seed": 777
            }
        },
        "50": {
            "class_type": "HyVideoTextEncode",
            "inputs": {
                "prompt": "Cinematic shot of a robot",
                # text_encoders link...
            }
        },
        "10": {
            "class_type": "HyVideoModelLoader",
            "inputs": {
                "model_name": "hunyuan-video.safetensors"
            }
        },
         "100": { "class_type": "SaveVideo", "inputs": {"images": [80, 0]} } # Sink needed
    }
    
    result = parse_geninfo_from_prompt(prompt_graph)
    assert result.ok
    data = result.data
    
    assert data["steps"]["value"] == 30
    assert data["cfg"]["value"] == 6.0 # Mapped from embedded_guidance_scale
    assert data["positive"]["value"] == "Cinematic shot of a robot"
    assert data["checkpoint"]["name"] == "hunyuan-video"

