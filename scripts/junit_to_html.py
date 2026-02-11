from __future__ import annotations

import argparse
import datetime as _dt
import html
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


_CSS = r"""
:root {
  --bg: #0f1115;
  --panel: #151923;
  --panel-2: #10141d;
  --text: #e7eaf0;
  --muted: rgba(231,234,240,0.68);
  --border: rgba(231,234,240,0.10);
  --accent: #5fb3ff;
  --ok: #39d98a;
  --fail: #ff5c5c;
  --skip: #f6c177;
  --shadow: 0 18px 45px rgba(0,0,0,0.35);
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: var(--sans);
  background: radial-gradient(1200px 600px at 20% -20%, rgba(95,179,255,0.20), transparent 60%),
              radial-gradient(900px 550px at 100% 0%, rgba(57,217,138,0.14), transparent 55%),
              var(--bg);
  color: var(--text);
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.wrap { max-width: 1180px; margin: 0 auto; padding: 22px 18px 60px; }
.top {
  display: flex; gap: 14px; align-items: baseline; justify-content: space-between;
  padding: 16px 18px; border: 1px solid var(--border); border-radius: 14px;
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
  box-shadow: var(--shadow);
}
.title { font-size: 18px; font-weight: 700; letter-spacing: 0.2px; }
.meta { color: var(--muted); font-size: 12px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-end; }
.chip {
  display: inline-flex; gap: 8px; align-items: center;
  padding: 7px 10px; border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.03);
  font-size: 12px; color: var(--muted);
}
.dot { width: 9px; height: 9px; border-radius: 999px; background: var(--muted); box-shadow: 0 0 0 3px rgba(255,255,255,0.04); }
.dot.ok { background: var(--ok); box-shadow: 0 0 0 3px rgba(57,217,138,0.14); }
.dot.fail { background: var(--fail); box-shadow: 0 0 0 3px rgba(255,92,92,0.14); }
.dot.skip { background: var(--skip); box-shadow: 0 0 0 3px rgba(246,193,119,0.14); }

.grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 14px; }
.panel {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: rgba(21,25,35,0.92);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.panel-h {
  display: flex; gap: 10px; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
}
.panel-h .left { display: flex; gap: 10px; align-items: center; min-width: 0; }
.suite { font-weight: 700; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.small { color: var(--muted); font-size: 12px; }
.panel-b { padding: 10px 12px 12px; }

table { width: 100%; border-collapse: collapse; }
th, td { padding: 9px 10px; vertical-align: top; }
th { text-align: left; font-size: 12px; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); }
tr + tr td { border-top: 1px solid rgba(231,234,240,0.07); }
.name { font-weight: 600; color: var(--text); }
.cls { font-family: var(--mono); font-size: 12px; color: rgba(231,234,240,0.78); }
.time { font-family: var(--mono); font-size: 12px; color: rgba(231,234,240,0.72); text-align: right; white-space: nowrap; }
.status { font-size: 12px; font-weight: 700; letter-spacing: 0.2px; }
.status.ok { color: var(--ok); }
.status.fail { color: var(--fail); }
.status.skip { color: var(--skip); }

details { margin-top: 8px; }
summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  user-select: none;
}
.pre {
  margin-top: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(231,234,240,0.10);
  background: rgba(16,20,29,0.85);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.footer {
  margin-top: 14px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
"""


def _as_int(value: str | None, default: int = 0) -> int:
    try:
        return int(float(value or 0))
    except Exception:
        return default


def _as_float(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value or 0.0)
    except Exception:
        return default


def _now_local_str() -> str:
    try:
        return _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""


def _parse_junit(xml_path: Path) -> dict:
    tree = ET.parse(xml_path)
    root = tree.getroot()

    # JUnit can be either <testsuite> or <testsuites>.
    if root.tag == "testsuites":
        suites = list(root.findall("testsuite"))
        root_totals = {
            "tests": _as_int(root.get("tests")),
            "failures": _as_int(root.get("failures")),
            "errors": _as_int(root.get("errors")),
            "skipped": _as_int(root.get("skipped")),
            "time": _as_float(root.get("time")),
        }
    else:
        suites = [root] if root.tag == "testsuite" else list(root.findall(".//testsuite"))
        root_totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0, "time": 0.0}

    # Some generators (including pytest) may omit totals on <testsuites>.
    # Always compute totals from child suites; only trust root totals if they look valid.
    computed = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0, "time": 0.0}
    for s in suites:
        computed["tests"] += _as_int(s.get("tests"))
        computed["failures"] += _as_int(s.get("failures"))
        computed["errors"] += _as_int(s.get("errors"))
        computed["skipped"] += _as_int(s.get("skipped"))
        computed["time"] += _as_float(s.get("time"))

    # If root totals are all zeros but suites have real counts, use computed.
    if sum(int(root_totals.get(k, 0) or 0) for k in ("tests", "failures", "errors", "skipped")) == 0 and computed["tests"] > 0:
        totals = computed
    else:
        totals = root_totals

    parsed_suites: list[dict] = []
    for suite in suites:
        suite_name = suite.get("name") or "testsuite"
        suite_time = _as_float(suite.get("time"))
        suite_tests = _as_int(suite.get("tests"))
        suite_failures = _as_int(suite.get("failures"))
        suite_errors = _as_int(suite.get("errors"))
        suite_skipped = _as_int(suite.get("skipped"))

        cases: list[dict] = []
        for tc in suite.findall(".//testcase"):
            name = tc.get("name") or ""
            classname = tc.get("classname") or ""
            t = _as_float(tc.get("time"))

            status = "ok"
            detail = ""
            failure = tc.find("failure")
            error = tc.find("error")
            skipped = tc.find("skipped")
            if skipped is not None:
                status = "skip"
                detail = skipped.get("message") or (skipped.text or "")
            elif failure is not None:
                status = "fail"
                detail = (failure.get("message") or "") + ("\n" if (failure.text or "").strip() else "") + (failure.text or "")
            elif error is not None:
                status = "fail"
                detail = (error.get("message") or "") + ("\n" if (error.text or "").strip() else "") + (error.text or "")

            cases.append(
                {
                    "name": name,
                    "classname": classname,
                    "time": t,
                    "status": status,
                    "detail": detail.strip(),
                }
            )

        parsed_suites.append(
            {
                "name": suite_name,
                "tests": suite_tests,
                "failures": suite_failures,
                "errors": suite_errors,
                "skipped": suite_skipped,
                "time": suite_time,
                "cases": cases,
            }
        )

    return {"totals": totals, "suites": parsed_suites}


def _escape(s: str) -> str:
    return html.escape(s or "", quote=False)


def _render_html(title: str, xml_path: Path, data: dict) -> str:
    totals = data.get("totals") or {}
    suites = data.get("suites") or []
    failures_total = int(totals.get("failures", 0) or 0) + int(totals.get("errors", 0) or 0)
    status = "ok" if failures_total == 0 else "fail"
    if status == "ok" and int(totals.get("skipped", 0) or 0) > 0:
        status = "skip"

    def chip(label: str, value: str, kind: str) -> str:
        return f'<span class="chip"><span class="dot {kind}"></span><span>{_escape(label)}:</span><b style="color: var(--text)">{_escape(value)}</b></span>'

    overall_label = "PASSED" if status == "ok" else ("SKIPPED" if status == "skip" else "FAILED")
    chips = "\n".join(
        [
            chip("Overall", overall_label, status),
            chip("Tests", str(int(totals.get("tests", 0) or 0)), "ok" if status != "fail" else "fail"),
            chip("Failures", str(int(failures_total)), "fail" if failures_total else "ok"),
            chip("Skipped", str(int(totals.get("skipped", 0) or 0)), "skip" if int(totals.get("skipped", 0) or 0) else "ok"),
            chip("Time", f"{float(totals.get('time', 0.0) or 0.0):.2f}s", "ok" if status != "fail" else "fail"),
        ]
    )

    rendered_suites: list[str] = []
    for suite in suites:
        suite_name = suite.get("name") or "testsuite"
        cases = suite.get("cases") or []
        suite_fail = int(suite.get("failures", 0) or 0) + int(suite.get("errors", 0) or 0)
        suite_skip = int(suite.get("skipped", 0) or 0)
        suite_status = "fail" if suite_fail else ("skip" if suite_skip else "ok")

        rows: list[str] = []
        for c in cases:
            st = c.get("status") or "ok"
            status_label = "PASSED" if st == "ok" else ("SKIPPED" if st == "skip" else "FAILED")
            detail = c.get("detail") or ""
            detail_html = ""
            if detail:
                detail_html = f"""
                <details>
                  <summary>Details</summary>
                  <div class="pre">{_escape(detail)}</div>
                </details>
                """
            rows.append(
                f"""
                <tr>
                  <td>
                    <div class="name">{_escape(c.get("name") or "")}</div>
                    <div class="cls">{_escape(c.get("classname") or "")}</div>
                    {detail_html}
                  </td>
                  <td class="time">{float(c.get("time") or 0.0):.3f}s</td>
                  <td class="time"><span class="status {st}">{status_label}</span></td>
                </tr>
                """
            )

        rendered_suites.append(
            f"""
            <section class="panel">
              <div class="panel-h">
                <div class="left">
                  <span class="dot {suite_status}"></span>
                  <div style="min-width:0">
                    <div class="suite">{_escape(suite_name)}</div>
                    <div class="small">{int(suite.get("tests", 0) or 0)} tests • {suite_fail} failing • {suite_skip} skipped • {float(suite.get("time", 0.0) or 0.0):.2f}s</div>
                  </div>
                </div>
              </div>
              <div class="panel-b">
                <table>
                  <thead>
                    <tr>
                      <th>Test Case</th>
                      <th style="width: 90px; text-align:right;">Time</th>
                      <th style="width: 96px; text-align:right;">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {''.join(rows)}
                  </tbody>
                </table>
              </div>
            </section>
            """
        )

    xml_name = xml_path.name
    xml_mtime = ""
    try:
        xml_mtime = _dt.datetime.fromtimestamp(xml_path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        pass

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{_escape(title)}</title>
  <style>{_CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <div class="title">{_escape(title)}</div>
        <div class="meta">Source: <span style="font-family: var(--mono)">{_escape(xml_name)}</span> • Generated: {_escape(_now_local_str())} • XML mtime: {_escape(xml_mtime)}</div>
      </div>
      <div class="chips">
        {chips}
      </div>
    </div>

    <div class="grid">
      {''.join(rendered_suites) if rendered_suites else '<div class="panel"><div class="panel-b">No suites found.</div></div>'}
    </div>

    <div class="footer">Majoor Assets Manager • Pytest JUnit report</div>
  </div>
</body>
</html>
"""


def _write_index(index_dir: Path) -> None:
    try:
        index_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        return

    items: list[tuple[float, Path]] = []
    try:
        for p in index_dir.glob("*.html"):
            if p.name.lower() == "index.html":
                continue
            try:
                items.append((p.stat().st_mtime, p))
            except Exception:
                items.append((0.0, p))
    except Exception:
        return

    items.sort(key=lambda t: t[0], reverse=True)

    rows: list[str] = []
    for mtime, p in items[:200]:
        ts = ""
        try:
            ts = _dt.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass
        rows.append(
            f'<tr><td><a href="{html.escape(p.name)}">{html.escape(p.name)}</a></td><td class="time">{html.escape(ts)}</td></tr>'
        )

    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pytest Reports</title>
  <style>{_CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <div class="title">Pytest Reports</div>
        <div class="meta">Folder: <span style="font-family: var(--mono)">{html.escape(str(index_dir))}</span></div>
      </div>
      <div class="chips">
        <span class="chip"><span class="dot ok"></span><span>Count:</span><b style="color: var(--text)">{len(items)}</b></span>
      </div>
    </div>
    <div class="grid">
      <section class="panel">
        <div class="panel-h">
          <div class="left">
            <span class="dot ok"></span>
            <div class="suite">Latest HTML reports</div>
          </div>
        </div>
        <div class="panel-b">
          <table>
            <thead>
              <tr><th>Report</th><th style="width: 190px; text-align:right;">Modified</th></tr>
            </thead>
            <tbody>
              {''.join(rows) if rows else '<tr><td colspan="2" class="small">No reports found.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    <div class="footer">Majoor Assets Manager • Pytest reports index</div>
  </div>
</body>
</html>
"""
    try:
        (index_dir / "index.html").write_text(page, encoding="utf-8")
    except Exception:
        return


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Convert a JUnit XML report to a styled HTML report.")
    p.add_argument("xml", type=str, help="Input JUnit XML path")
    p.add_argument("html", type=str, help="Output HTML path")
    p.add_argument("--title", type=str, default="Pytest Report", help="HTML title")
    p.add_argument("--index-dir", type=str, default="", help="If set, also write index.html in this folder")
    args = p.parse_args(argv)

    xml_path = Path(args.xml)
    html_path = Path(args.html)

    if not xml_path.exists():
        print(f"[junit_to_html] Input XML not found: {xml_path}", file=sys.stderr)
        return 2

    try:
        data = _parse_junit(xml_path)
    except Exception as exc:
        print(f"[junit_to_html] Failed to parse XML: {exc}", file=sys.stderr)
        return 3

    try:
        html_path.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    page = _render_html(args.title, xml_path, data)
    try:
        html_path.write_text(page, encoding="utf-8")
    except Exception as exc:
        print(f"[junit_to_html] Failed to write HTML: {exc}", file=sys.stderr)
        return 4

    if args.index_dir:
        try:
            _write_index(Path(args.index_dir))
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
