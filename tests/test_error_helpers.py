from backend.shared import sanitize_error_message


def test_sanitize_error_message_masks_paths() -> None:
    msg = sanitize_error_message(RuntimeError("Failed at C:\\\\secret\\\\file.png"), "Generic error")
    assert "[path]" in msg
    assert "C:\\\\" not in msg
    assert msg.startswith("Generic error:")


def test_sanitize_error_message_returns_fallback_for_empty() -> None:
    assert sanitize_error_message("", "Fallback") == "Fallback"
    assert sanitize_error_message(None, "Fallback") == "Fallback"
