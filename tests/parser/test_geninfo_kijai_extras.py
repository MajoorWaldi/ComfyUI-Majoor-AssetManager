from backend.features.geninfo.parser import parse_geninfo_from_prompt

def test_geninfo_kijai_flux_trainer_inference():
    """
    Test Kijai's FluxKohyaInferenceSampler which has built-in prompt input.
    """
    prompt_graph = {
        "100": { "class_type": "SaveImage", "inputs": {"images": [80, 0]} },
        "80": {
            "class_type": "FluxKohyaInferenceSampler",
            "inputs": {
                "model": [10, 0],
                "prompt": "Baked in prompt inside sampler",
                "width": 1024,
                "height": 1024,
                "steps": 20,
                "seed": 555
            }
        },
        "10": { "class_type": "LoadDiffusionModel", "inputs": {"unet_name": "flux1-dev.safetensors"}}
    }
    
    result = parse_geninfo_from_prompt(prompt_graph)
    assert result.ok
    data = result.data
    
    assert data["positive"]["value"] == "Baked in prompt inside sampler"
    assert data["steps"]["value"] == 20
    assert data["seed"]["value"] == 555

def test_geninfo_marigold_depth():
    """
    Test Marigold Depth Estimation as a 'sampler'.
    """
    prompt_graph = {
        "20": { "class_type": "PreviewImage", "inputs": {"images": [10, 0]} },
        "10": {
            "class_type": "MarigoldDepthEstimation",
            "inputs": {
                "image": [5, 0],
                "denoise_steps": 15,
                "ensemble_size": 5,
                "seed": 123
            }
        },
        "5": { "class_type": "LoadImage", "inputs": {"image": "test.png"} }
    }
    
    result = parse_geninfo_from_prompt(prompt_graph)
    assert result.ok
    data = result.data
    
    # Marigold should be detected as sampler
    # It is connected to sink, so it should be PRIMARY
    assert data["engine"]["sampler_mode"] == "primary"
    assert data["steps"]["value"] == 15
    assert data["seed"]["value"] == 123
