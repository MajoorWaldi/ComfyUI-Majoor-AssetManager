class _DummyRequest:
    def __init__(self, path: str, headers=None):
        self.path = path
        self.headers = headers or {}


def test_observability_respects_client_opt_out(monkeypatch):
    from backend.observability import _should_log

    monkeypatch.setenv("MJR_OBS_LOG_ALL", "1")

    req = _DummyRequest("/mjr/am/list", headers={"X-MJR-OBS": "off"})
    assert _should_log(req, status=200, duration_ms=1.0) is False


def test_observability_suppresses_successful_health_polling(monkeypatch):
    from backend.observability import _should_log

    monkeypatch.setenv("MJR_OBS_LOG_SUCCESS", "1")

    req = _DummyRequest("/mjr/am/health", headers={})
    assert _should_log(req, status=200, duration_ms=1.0) is False

    req = _DummyRequest("/mjr/am/health/counters", headers={})
    assert _should_log(req, status=200, duration_ms=1.0) is False


def test_observability_logs_health_errors(monkeypatch):
    from backend.observability import _should_log

    monkeypatch.delenv("MJR_OBS_LOG_ALL", raising=False)
    monkeypatch.delenv("MJR_OBS_LOG_SUCCESS", raising=False)

    req = _DummyRequest("/mjr/am/health", headers={})
    assert _should_log(req, status=500, duration_ms=1.0) is True


def test_observability_success_requires_client_explicit_on(monkeypatch):
    from backend.observability import _should_log

    # Enable slow+success logging and lower the threshold so any request qualifies.
    monkeypatch.setenv("MJR_OBS_LOG_SUCCESS", "1")
    monkeypatch.setenv("MJR_OBS_LOG_SLOW", "1")
    monkeypatch.setenv("MJR_OBS_SLOW_MS", "0")

    req = _DummyRequest("/mjr/am/list", headers={})
    assert _should_log(req, status=200, duration_ms=1.0) is False

    req = _DummyRequest("/mjr/am/list", headers={"X-MJR-OBS": "on"})
    assert _should_log(req, status=200, duration_ms=1.0) is True
