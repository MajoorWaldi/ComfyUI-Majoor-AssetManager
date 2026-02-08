from backend.features.geninfo.parser import parse_geninfo_from_prompt

def test_parse_geninfo_workflow_metadata_only():
    """Test extracting metadata from workflow when prompt is missing."""
    prompt = None
    workflow = {
        "extra": {
            "title": "My Masterpiece",
            "author": "DaVinci",
            "version": "1.0",
        },
        "nodes": [],
        "links": [],
    }
    
    result = parse_geninfo_from_prompt(prompt, workflow)
    
    assert result.ok
    assert result.data is not None
    assert "metadata" in result.data
    meta = result.data["metadata"]
    assert meta["title"] == "My Masterpiece"
    assert meta["author"] == "DaVinci"
    assert meta["version"] == "1.0"

def test_parse_geninfo_workflow_metadata_merge_fallback():
    """Test that workflow metadata is returned even if graph parsing finds no sinks."""
    prompt = {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 123
            }
        }
    }
    # This prompt has no valid sink (save node), so standard parser would return None.
    # But with workflow metadata, we should get that metadata back.
    
    workflow = {
        "extra": {
            "title": "Merged Info"
        }
    }
    
    result = parse_geninfo_from_prompt(prompt, workflow)
    
    assert result.ok
    assert result.data is not None
    assert result.data["metadata"]["title"] == "Merged Info"
