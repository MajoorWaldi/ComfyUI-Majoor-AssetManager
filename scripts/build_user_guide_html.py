from __future__ import annotations

import argparse
import html
import os
import posixpath
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = REPO_ROOT / "docs"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _slugify(text: str) -> str:
    s = str(text or "").strip().lower()
    s = re.sub(r"[^\w\s\-]+", "", s, flags=re.UNICODE)
    s = re.sub(r"[\s\-]+", "-", s).strip("-")
    return s or "section"


def _escape(s: str) -> str:
    return html.escape(s or "", quote=False)


_RE_MD_LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_RE_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def _rel_from_docs(url: str) -> str:
    """
    Rewrite a relative URL that appears in docs/*.md to a URL that works from the
    repo root (where user_guide.html is generated).
    """
    u = (url or "").strip()
    if not u:
        return u
    if u.startswith("#"):
        return u
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", u):  # http:, https:, mailto:, etc.
        return u
    if u.startswith("/"):
        return u

    parsed = urllib.parse.urlsplit(u)
    path = (parsed.path or "").replace("\\", "/")
    joined = posixpath.normpath(posixpath.join("docs", path))
    if joined == ".":
        joined = "docs"
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, joined, parsed.query, parsed.fragment))


def _inline_md_to_html(text: str, *, doc_prefix: str, doc_id_by_md_name: dict[str, str]) -> str:
    # Escape first, then re-inject inline constructs.
    s = _escape(text)

    # Inline code: `...`
    # Use a conservative approach: only backticks on the same line.
    def repl_code(m: re.Match) -> str:
        return f'<code>{_escape(m.group(1))}</code>'

    s = re.sub(r"`([^`]+)`", repl_code, s)

    # Images: ![alt](url)
    def repl_image(m: re.Match) -> str:
        alt = (m.group(1) or "").strip()
        url = (m.group(2) or "").strip()

        safe_url = url
        parsed = urllib.parse.urlsplit(url)
        path = (parsed.path or "").replace("\\", "/")
        md_name = Path(path).name if path else ""
        if md_name not in doc_id_by_md_name:
            safe_url = _rel_from_docs(url)

        # User guide preference: do not render images. Keep a clickable link instead.
        safe_attr = html.escape(safe_url, quote=True)
        label = alt or "image"
        return f'<a href="{safe_attr}" target="_blank" rel="noopener noreferrer">[{_escape(label)}]</a>'

    s = _RE_MD_IMAGE.sub(repl_image, s)

    # Links: [text](url)
    def repl_link(m: re.Match) -> str:
        label = m.group(1)
        url = m.group(2).strip()

        # Intra-doc anchors: (#heading)
        if url.startswith("#"):
            anchor = f"#{doc_prefix}-{_slugify(url[1:])}"
            return f'<a href="{html.escape(anchor, quote=True)}">{_escape(label)}</a>'

        parsed = urllib.parse.urlsplit(url)
        path = (parsed.path or "").replace("\\", "/")
        frag = parsed.fragment or ""

        # Cross-doc md links inside docs/: map to in-page sections.
        md_name = Path(path).name if path else ""
        if md_name in doc_id_by_md_name:
            doc_id = doc_id_by_md_name[md_name]
            if frag:
                anchor = f"#{doc_id}-{_slugify(frag)}"
            else:
                anchor = f"#{doc_id}"
            return f'<a href="{html.escape(anchor, quote=True)}">{_escape(label)}</a>'

        # External links: open in a new tab.
        if re.match(r"^https?://", url, flags=re.IGNORECASE):
            safe_url = html.escape(url, quote=True)
            return f'<a href="{safe_url}" target="_blank" rel="noopener noreferrer">{_escape(label)}</a>'

        # Other relative links (README, scripts, etc.): rewrite relative to docs/.
        safe_url = html.escape(_rel_from_docs(url), quote=True)
        return f'<a href="{safe_url}">{_escape(label)}</a>'

    s = _RE_MD_LINK.sub(repl_link, s)

    # Bold / italic (basic)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", s)
    return s


def _is_hr(line: str) -> bool:
    t = line.strip()
    return t in {"---", "***", "___"}


def _looks_like_table_header(line: str, next_line: str) -> bool:
    if "|" not in line:
        return False
    if "|" not in next_line:
        return False
    sep = next_line.strip()
    # Typical md separator: | --- | ---: |
    return bool(re.fullmatch(r"\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?", sep))


def _split_table_row(line: str) -> list[str]:
    # Strip outer pipes if present.
    t = line.strip()
    if t.startswith("|"):
        t = t[1:]
    if t.endswith("|"):
        t = t[:-1]
    return [c.strip() for c in t.split("|")]


@dataclass
class Doc:
    file: str
    title: str
    desc: str


def _docs_from_index(index_md: str) -> list[Doc]:
    docs: list[Doc] = []
    for line in index_md.splitlines():
        m = re.match(r"^\-\s+\[([^\]]+)\]\(([^)]+\.md)\)\s+\-\s+(.*)$", line.strip())
        if not m:
            continue
        title = m.group(1).strip()
        file = m.group(2).strip()
        desc = m.group(3).strip()
        docs.append(Doc(file=file, title=title, desc=desc))
    return docs


def _md_to_html(md: str, *, doc_prefix: str, doc_id_by_md_name: dict[str, str]) -> str:
    out: list[str] = []
    lines = md.replace("\r\n", "\n").split("\n")

    in_code = False
    code_lang = ""
    code_lines: list[str] = []

    list_stack: list[tuple[str, int]] = []  # (ul|ol, indent)

    def close_lists(to_indent: int = -1) -> None:
        nonlocal list_stack
        while list_stack and (to_indent < 0 or list_stack[-1][1] >= to_indent):
            tag, _ = list_stack.pop()
            out.append(f"</{tag}>")

    def open_list(tag: str, indent: int) -> None:
        list_stack.append((tag, indent))
        out.append(f"<{tag}>")

    def flush_paragraph(buf: list[str]) -> None:
        if not buf:
            return
        text = " ".join(x.strip() for x in buf).strip()
        if text:
            out.append(f"<p>{_inline_md_to_html(text, doc_prefix=doc_prefix, doc_id_by_md_name=doc_id_by_md_name)}</p>")
        buf.clear()

    para: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]

        # Fenced code block
        if line.strip().startswith("```"):
            flush_paragraph(para)
            close_lists()
            if not in_code:
                in_code = True
                code_lang = line.strip().lstrip("`").strip()
                code_lines = []
            else:
                in_code = False
                lang_attr = f' class="language-{_escape(code_lang)}"' if code_lang else ""
                out.append(f"<pre><code{lang_attr}>{_escape('\\n'.join(code_lines))}</code></pre>")
                code_lang = ""
                code_lines = []
            i += 1
            continue

        if in_code:
            code_lines.append(line)
            i += 1
            continue

        if not line.strip():
            flush_paragraph(para)
            close_lists()
            i += 1
            continue

        if _is_hr(line):
            flush_paragraph(para)
            close_lists()
            out.append("<hr />")
            i += 1
            continue

        # Tables
        if i + 1 < len(lines) and _looks_like_table_header(line, lines[i + 1]):
            flush_paragraph(para)
            close_lists()
            header_cells = _split_table_row(line)
            i += 2  # skip separator
            body_rows: list[list[str]] = []
            while i < len(lines) and lines[i].strip() and "|" in lines[i]:
                body_rows.append(_split_table_row(lines[i]))
                i += 1
            out.append('<div class="table-wrap"><table>')
            out.append(
                "<thead><tr>"
                + "".join(f"<th>{_inline_md_to_html(c, doc_prefix=doc_prefix, doc_id_by_md_name=doc_id_by_md_name)}</th>" for c in header_cells)
                + "</tr></thead>"
            )
            out.append("<tbody>")
            for r in body_rows:
                out.append(
                    "<tr>"
                    + "".join(f"<td>{_inline_md_to_html(c, doc_prefix=doc_prefix, doc_id_by_md_name=doc_id_by_md_name)}</td>" for c in r)
                    + "</tr>"
                )
            out.append("</tbody></table></div>")
            continue

        # Headings
        mh = re.match(r"^(#{1,6})\s+(.*)$", line)
        if mh:
            flush_paragraph(para)
            close_lists()
            level = len(mh.group(1))
            text = mh.group(2).strip()
            hid = f"{doc_prefix}-{_slugify(text)}"
            out.append(
                f'<h{level} id="{_escape(hid)}">'
                f"{_inline_md_to_html(text, doc_prefix=doc_prefix, doc_id_by_md_name=doc_id_by_md_name)}"
                f"</h{level}>"
            )
            i += 1
            continue

        # Lists (basic nested)
        ml = re.match(r"^(\s*)([-*+])\s+(.*)$", line)
        mol = re.match(r"^(\s*)(\d+)\.\s+(.*)$", line)
        if ml or mol:
            flush_paragraph(para)
            indent = len((ml.group(1) if ml else mol.group(1)).replace("\t", "    "))
            tag = "ul" if ml else "ol"
            item_text = (ml.group(3) if ml else mol.group(3)).strip()

            if not list_stack:
                open_list(tag, indent)
            else:
                cur_tag, cur_indent = list_stack[-1]
                if indent > cur_indent:
                    open_list(tag, indent)
                else:
                    while list_stack and indent < list_stack[-1][1]:
                        close_lists(to_indent=list_stack[-1][1])
                    if list_stack and list_stack[-1][0] != tag:
                        close_lists(to_indent=list_stack[-1][1])
                        open_list(tag, indent)

            out.append(f"<li>{_inline_md_to_html(item_text, doc_prefix=doc_prefix, doc_id_by_md_name=doc_id_by_md_name)}</li>")
            i += 1
            continue

        # Blockquote (single line)
        if line.lstrip().startswith(">"):
            flush_paragraph(para)
            close_lists()
            out.append(
                f'<blockquote>{_inline_md_to_html(line.lstrip()[1:].strip(), doc_prefix=doc_prefix, doc_id_by_md_name=doc_id_by_md_name)}</blockquote>'
            )
            i += 1
            continue

        # Default: paragraph continuation
        para.append(line)
        i += 1

    flush_paragraph(para)
    close_lists()
    return "\n".join(out)


def _render_html_page(title: str, docs: list[Doc], rendered_sections: list[str]) -> str:
    # "Classic" layout (top bar + sticky nav), closer to the original HTML.
    css = r"""
    :root{
      --bg: #0f1115;
      --panel: rgba(21,25,35,0.92);
      --text: #e7eaf0;
      --muted: rgba(231,234,240,0.68);
      --border: rgba(231,234,240,0.10);
      --accent: #5fb3ff;
      --shadow: 0 18px 45px rgba(0,0,0,0.35);
      --radius: 14px;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }
    *{ box-sizing:border-box; }
    html,body{ height:100%; }
    body{
      margin:0;
      font-family: var(--sans);
      color: var(--text);
      background:
        radial-gradient(1200px 600px at 20% -20%, rgba(95,179,255,0.18), transparent 60%),
        radial-gradient(900px 550px at 100% 0%, rgba(57,217,138,0.12), transparent 55%),
        var(--bg);
    }
    a{ color: var(--accent); text-decoration:none; }
    a:hover{ text-decoration: underline; }
    mark{ background: rgba(95,179,255,0.22); color: rgba(231,234,240,0.96); padding: 0 2px; border-radius: 4px; }
    code{ font-family: var(--mono); font-size: 12px; padding: 2px 6px; border-radius: 8px; border: 1px solid rgba(231,234,240,0.10); background: rgba(16,20,29,0.70); color: rgba(231,234,240,0.92); }
    pre{ margin: 10px 0; padding: 12px 12px; border-radius: 12px; border: 1px solid rgba(231,234,240,0.10); background: rgba(16,20,29,0.90); overflow:auto; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.18); }
    pre code{ padding:0; border:0; background: transparent; font-size: 12px; }
    hr{ border:0; border-top: 1px solid rgba(231,234,240,0.10); margin: 18px 0; }
    blockquote{ margin: 10px 0; padding: 10px 12px; border-left: 3px solid rgba(95,179,255,0.55); background: rgba(95,179,255,0.06); border-radius: 12px; color: rgba(231,234,240,0.88); }
    .table-wrap{ overflow:auto; border-radius: 12px; border: 1px solid rgba(231,234,240,0.10); background: rgba(16,20,29,0.55); }
    table{ width:100%; border-collapse: collapse; }
    th, td{ padding: 9px 10px; vertical-align: top; border-top: 1px solid rgba(231,234,240,0.08); }
    th{ text-align:left; font-size: 12px; color: var(--muted); font-weight: 700; border-top: 0; }

    .wrap{ max-width: 1180px; margin:0 auto; padding: 22px 16px 70px; }
    .top{
      display:flex; gap:14px; align-items:flex-end; justify-content:space-between;
      padding: 16px 18px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
      box-shadow: var(--shadow);
    }
    .brand{ display:flex; gap: 12px; align-items:center; }
    .logo{
      width: 36px; height: 36px;
      border-radius: 12px;
      border: 1px solid rgba(231,234,240,0.12);
      background:
        radial-gradient(120px 70px at 30% 20%, rgba(95,179,255,0.25), transparent 55%),
        rgba(0,0,0,0.25);
      display:flex; align-items:center; justify-content:center;
      font-size: 18px;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15);
    }
    .logo.icon{ background-image: url('ressources/icon.png'); background-size: cover; background-position: center; font-size: 0; }
    .title{ font-size: 20px; font-weight: 800; letter-spacing: 0.2px; }
    .subtitle{ color: var(--muted); font-size: 12px; margin-top: 6px; line-height: 1.4; }
    .pillrow{ display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
    .pill{
      display:inline-flex; gap: 8px; align-items:center;
      padding: 7px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.03);
      font-size: 12px;
      color: var(--muted);
    }
    .dot{ width: 9px; height: 9px; border-radius: 999px; background: var(--accent); box-shadow: 0 0 0 3px rgba(95,179,255,0.14); }

    .nav{
      margin-top: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: rgba(21,25,35,0.75);
      box-shadow: var(--shadow);
      padding: 10px 10px;
      position: sticky;
      top: 10px;
      z-index: 5;
    }
    .navrow{ display:flex; align-items:center; justify-content:space-between; gap: 10px; flex-wrap:wrap; }
    .search{ flex: 1 1 280px; min-width: 220px; padding: 9px 10px; border-radius: 999px; border: 1px solid rgba(231,234,240,0.12); background: rgba(16,20,29,0.60); color: rgba(231,234,240,0.92); outline:none; }
    .search:focus{ border-color: rgba(95,179,255,0.45); box-shadow: 0 0 0 3px rgba(95,179,255,0.12); }
    .navlinks{ display:flex; gap: 8px; flex-wrap:wrap; align-items:center; }
    .matches{ color: var(--muted); font-size: 12px; padding: 4px 8px; border-radius: 999px; border: 1px solid rgba(231,234,240,0.10); background: rgba(255,255,255,0.02); }
    .nav a{
      display:inline-block;
      padding: 8px 10px;
      border-radius: 999px;
      border: 1px solid rgba(231,234,240,0.10);
      background: rgba(255,255,255,0.02);
      color: rgba(231,234,240,0.86);
      font-size: 12px;
      white-space: nowrap;
    }
    .nav a:hover{
      border-color: rgba(95,179,255,0.35);
      background: rgba(95,179,255,0.10);
      text-decoration:none;
    }

    .grid{ display:grid; grid-template-columns: 1fr; gap: 14px; margin-top: 14px; }
    .panel{
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow:hidden;
    }
    .panel-h{
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
      display:flex; align-items:center; justify-content:space-between; gap: 10px;
    }
    .panel-h h2{
      margin:0;
      font-size: 14px;
      letter-spacing: 0.2px;
      font-weight: 800;
      color: rgba(231,234,240,0.92);
    }
    .panel-b{ padding: 12px 14px 14px; color: rgba(231,234,240,0.90); }
    .panel-b p{ margin: 10px 0; color: rgba(231,234,240,0.86); line-height: 1.55; }
    .panel-b ul, .panel-b ol{ margin: 10px 0 10px 18px; color: rgba(231,234,240,0.86); }
    .panel-b li{ margin: 6px 0; }
    .section{ scroll-margin-top: 12px; }
    .section h1{ font-size: 20px; margin: 6px 0 10px; }
    .section h2{ font-size: 17px; margin: 18px 0 10px; }
    .section h3{ font-size: 14px; margin: 16px 0 8px; color: rgba(231,234,240,0.92); }
    .section h4{ font-size: 13px; margin: 14px 0 6px; color: rgba(231,234,240,0.88); }

    .toplink{ display:inline-block; margin-top: 10px; font-size: 12px; color: var(--muted); }
    .toplink:hover{ color: rgba(231,234,240,0.90); text-decoration:none; }
    """

    nav_links: list[str] = ['<a class="navlink" href="#top" data-text="top">Top</a>']
    for d in docs:
        doc_id = _slugify(Path(d.file).stem)
        nav_links.append(
            f'<a class="navlink" href="#{html.escape(doc_id)}" data-text="{html.escape((d.title + " " + d.desc).lower())}">{html.escape(d.title)}</a>'
        )

    js = r"""
    (function(){
      const q = document.getElementById('q');
      const links = Array.from(document.querySelectorAll('.navlink'));
      const panels = Array.from(document.querySelectorAll('section.panel.section'));
      const matchesEl = document.getElementById('matches');

      function escapeRegExp(s){
        return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }

      function getTokens(){
        const raw = (q && q.value ? q.value : '').trim();
        if(!raw) return [];
        return raw.split(/\s+/g).filter(Boolean);
      }

      function makeWordRegex(tokens){
        if(!tokens.length) return null;
        // Note: JS \b word-boundary is based on [A-Za-z0-9_]. Good enough for typical tags/words.
        const parts = tokens.map(t => escapeRegExp(t));
        return new RegExp('\\b(?:' + parts.join('|') + ')\\b', 'gi');
      }

      function panelMatchesAllTokens(panelText, tokens){
        if(!tokens.length) return true;
        const text = (panelText || '').toLowerCase();
        for(const tok of tokens){
          // Whole-word match using a boundary approximation.
          const r = new RegExp('\\b' + escapeRegExp(tok.toLowerCase()) + '\\b', 'i');
          if(!r.test(text)) return false;
        }
        return true;
      }

      function clearMarks(root){
        const marks = root.querySelectorAll('mark');
        for(const m of marks){
          const t = document.createTextNode(m.textContent || '');
          m.replaceWith(t);
        }
      }

      function markMatches(root, tokens){
        const rx = makeWordRegex(tokens);
        if(!rx) return 0;
        let count = 0;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node){
            if(!node.nodeValue) return NodeFilter.FILTER_REJECT;
            const p = node.parentElement;
            if(!p) return NodeFilter.FILTER_REJECT;
            if(p.closest('pre, code, script, style')) return NodeFilter.FILTER_REJECT;
            if(!(p.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6'))) return NodeFilter.FILTER_REJECT;
            rx.lastIndex = 0;
            return rx.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        });

        const toProcess = [];
        while(walker.nextNode()){
          toProcess.push(walker.currentNode);
          if(toProcess.length > 350) break; // safety
        }

        for(const node of toProcess){
          const text = node.nodeValue || '';
          rx.lastIndex = 0;
          let m;
          let last = 0;
          const frag = document.createDocumentFragment();
          let changed = false;

          while((m = rx.exec(text)) !== null){
            const start = m.index;
            const end = start + (m[0] ? m[0].length : 0);
            if(end <= start) break;

            if(start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
            const hit = document.createElement('mark');
            hit.textContent = text.slice(start, end);
            frag.appendChild(hit);
            count += 1;
            changed = true;
            last = end;
            if(count > 800) break;
          }

          if(changed){
            if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
            node.parentNode.replaceChild(frag, node);
          }
          if(count > 800) break;
        }

        return count;
      }

      function applyFilter(){
        const tokens = getTokens();
        let visiblePanels = 0;
        let marked = 0;

        for(const p of panels){
          clearMarks(p);
          const t = (p.textContent || '');
          const ok = panelMatchesAllTokens(t, tokens);
          p.style.display = ok ? '' : 'none';
          if(ok){
            visiblePanels += 1;
            if(tokens.length) marked += markMatches(p, tokens);
          }
        }

        for(const a of links){
          const href = a.getAttribute('href') || '';
          const id = href.startsWith('#') ? href.slice(1) : '';
          if(!tokens.length || id === 'top'){
            a.style.display = '';
            continue;
          }
          const target = id ? document.getElementById(id) : null;
          a.style.display = (target && target.style.display !== 'none') ? '' : 'none';
        }

        if(matchesEl){
          matchesEl.textContent = tokens.length ? ('Matches: ' + marked + ' • Sections: ' + visiblePanels) : ('Sections: ' + panels.length);
        }
      }

      if(q){
        q.addEventListener('input', () => {
          applyFilter();
        });
      }
      for(const a of links){
        a.addEventListener('click', (e) => {
          const href = a.getAttribute('href') || '';
          if(href.startsWith('#')){
            const id = href.slice(1);
            const el = document.getElementById(id);
            if(el){
              e.preventDefault();
              el.scrollIntoView({behavior:'smooth', block:'start'});
              history.replaceState(null, '', href);
            }
          }
        });
      }

      // Allow ?q=... deep-linking
      try{
        const u = new URL(window.location.href);
        const qq = (u.searchParams.get('q') || '').trim();
        if(q && qq){
          q.value = qq;
        }
      }catch(_){}
      applyFilter();
    })();
    """

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>{html.escape(title)}</title>
  <style>{css}</style>
</head>
<body>
  <div class="wrap">
    <header class="top" id="top">
      <div class="brand">
        <div class="logo icon" aria-hidden="true"> </div>
        <div>
        <div class="title">🗂️ Majoor Assets Manager — User Guide</div>
        <div class="subtitle">Generated from <code>docs/</code> for a readable single-page experience.</div>
        </div>
      </div>
      <div class="pillrow">
        <div class="pill"><span class="dot"></span> Docs: {len(docs)}</div>
        <div class="pill"><span class="dot"></span> Updated: January 2026</div>
      </div>
    </header>

    <nav class="nav">
      <div class="navrow">
        <input id="q" class="search" placeholder="Search (filters + highlights)..." />
        <div id="matches" class="matches">Sections: {len(docs) + 1}</div>
        <div class="navlinks">
          {''.join(nav_links)}
        </div>
      </div>
    </nav>

    <main class="grid">
      <section class="panel section" id="intro">
        <div class="panel-h"><h2>Introduction</h2></div>
        <div class="panel-b">
          <p>Tip: edit <code>docs/DOCUMENTATION_INDEX.md</code> to change the curated order, then regenerate with <code>python scripts/build_user_guide_html.py</code>.</p>
        </div>
      </section>

      {''.join(rendered_sections)}

      <div style="text-align:center; color: var(--muted); font-size: 12px; margin-top: 10px;">
        Majoor Assets Manager • Documentation • January 2026
      </div>
    </main>
  </div>
  <script>{js}</script>
</body>
</html>
"""


def build(out_path: Path) -> None:
    index_md = _read_text(DOCS_DIR / "DOCUMENTATION_INDEX.md")
    curated: list[Doc] = [
        Doc(file="DOCUMENTATION_INDEX.md", title="DOCUMENTATION_INDEX.md", desc="Documentation index (curated list)"),
    ]
    curated.extend(_docs_from_index(index_md))

    # Also include non-index docs at the end (e.g. audits) for completeness.
    indexed = {d.file for d in curated}
    extra_md = sorted([p.name for p in DOCS_DIR.glob("*.md") if p.name not in indexed and p.name != "DOCUMENTATION_INDEX.md"])
    for name in extra_md:
        curated.append(Doc(file=name, title=name, desc="Additional documentation"))

    doc_id_by_md_name = {Path(d.file).name: _slugify(Path(d.file).stem) for d in curated}

    rendered_sections: list[str] = []
    for d in curated:
        md_path = DOCS_DIR / d.file
        if not md_path.exists():
            continue
        doc_id = _slugify(Path(d.file).stem)
        md = _read_text(md_path)
        doc_prefix = doc_id
        body = _md_to_html(md, doc_prefix=doc_prefix, doc_id_by_md_name=doc_id_by_md_name)
        rendered_sections.append(
            f"""
            <section class="panel section" id="{html.escape(doc_id)}">
              <div class="panel-h"><h2>{html.escape(d.title)}</h2></div>
              <div class="panel-b">
                <div style="color: var(--muted); font-size: 12px; margin-bottom: 10px;">{html.escape(d.desc)}</div>
                <div class="section">{body}</div>
                <a class="toplink" href="#top">Back to top</a>
                <div style="margin-top: 10px; font-size: 12px; color: var(--muted);">
                  Source: <code>docs/{html.escape(d.file)}</code>
                </div>
              </div>
            </section>
            """
        )

    page = _render_html_page("Majoor Assets Manager - User Guide", curated, rendered_sections)
    out_path.write_text(page, encoding="utf-8", newline="\n")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Build the single-page HTML user guide from docs/*.md")
    p.add_argument("--out", type=str, default=str(REPO_ROOT / "user_guide.html"), help="Output HTML path")
    args = p.parse_args(argv)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    build(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(os.sys.argv[1:]))
