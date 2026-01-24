from pathlib import Path

from backend.features.metadata.service import MetadataService
from backend.shared import Result


class _SettingsStub:
    def get_probe_backend(self) -> str:  # pragma: no cover
        return "auto"


class _StubExifTool:
    def __init__(self, exif_data):
        self._exif_data = exif_data

    def read(self, file_path: str):
        return Result.Ok(self._exif_data)


class _StubFFProbe:
    def read(self, file_path: str):
        return Result.Err("FFPROBE_MISSING", "ffprobe not used in this test")


def test_metadata_service_builds_geninfo_from_a1111_parameters(tmp_path: Path):
    img = tmp_path / "a1111.png"
    img.write_bytes(b"")

    params = (
        "beautiful portrait of a fox\n"
        "Negative prompt: low quality\n"
        "Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 123, Size: 512x768, Model: myModel.safetensors"
    )

    exif = {"PNG:Parameters": params}
    svc = MetadataService(exiftool=_StubExifTool(exif), ffprobe=_StubFFProbe(), settings=_SettingsStub())

    res = svc.get_metadata(str(img))
    assert res.ok, res.error
    data = res.data or {}

    gi = data.get("geninfo")
    assert isinstance(gi, dict)
    assert gi["engine"]["parser_version"] == "geninfo-params-v1"
    assert gi["positive"]["value"].startswith("beautiful portrait")
    assert "low quality" in gi["negative"]["value"]
    assert gi["steps"]["value"] == 20
    assert gi["cfg"]["value"] == 7.0
    assert gi["seed"]["value"] == 123
    assert gi["size"]["width"] == 512
    assert gi["size"]["height"] == 768
    assert gi["checkpoint"]["name"] == "myModel"
