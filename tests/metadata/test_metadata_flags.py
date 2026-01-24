from backend.shared import Result
from backend.features.index.metadata_helpers import MetadataHelpers


def test_has_generation_data_true_when_workflow_present():
    meta = {"workflow": {"nodes": [{"id": 1, "type": "KSampler"}], "links": []}, "quality": "full"}
    has_wf, has_gen, quality, raw = MetadataHelpers.prepare_metadata_fields(Result.Ok(meta))
    assert has_wf is True
    assert has_gen is True
    assert quality == "full"
    assert isinstance(raw, str) and raw


def test_has_generation_data_false_for_workflow_without_sampler():
    meta = {"workflow": {"nodes": [{"id": 1, "type": "LoadImage"}], "links": []}, "quality": "full"}
    has_wf, has_gen, _, _ = MetadataHelpers.prepare_metadata_fields(Result.Ok(meta))
    assert has_wf is True
    assert has_gen is False


def test_has_generation_data_false_for_media_pipeline_prompt_graph():
    prompt = {
        "1": {"class_type": "VHS_LoadVideo", "inputs": {"video": "x.mp4"}},
        "2": {"class_type": "VHS_VideoCombine", "inputs": {"images": ["1", 0]}},
    }
    meta = {"prompt": prompt, "workflow": {"nodes": [{"id": 1, "type": "LoadVideo"}], "links": []}, "quality": "partial"}
    has_wf, has_gen, _, _ = MetadataHelpers.prepare_metadata_fields(Result.Ok(meta))
    assert has_wf is True
    assert has_gen is False
