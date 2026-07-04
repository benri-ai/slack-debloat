#!/usr/bin/env node
// CDP injector for the native Slack app.
// Attaches to every Slack window exposed on the remote-debugging port and
// injects custom.css + custom.js. Injection is self-healing: it re-applies
// on page loads and re-asserts the CSS every poll tick, because Slack's
// client boot can rebuild the document and wipe a one-shot injection.

import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.SLACK_CDP_PORT || 9222;
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = dirname(fileURLToPath(import.meta.url));
const CSS_FILE = join(DIR, "custom.css");
const JS_FILE = join(DIR, "custom.js");

const read = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

// Idempotent style upsert — safe to run repeatedly and before DOM is ready.
function cssPayload() {
  const css = JSON.stringify(read(CSS_FILE));
  return `(() => {
    const run = () => {
      let el = document.getElementById("slack-debloat-css");
      if (!el) {
        el = document.createElement("style");
        el.id = "slack-debloat-css";
        (document.head || document.documentElement).appendChild(el);
      }
      if (el.textContent !== ${css}) el.textContent = ${css};
    };
    if (document.head) run();
    else document.addEventListener("DOMContentLoaded", run, { once: true });
  })();`;
}

// Sidebar reflow: Slack's sidebar is a virtual list — rows are absolutely
// positioned with inline \`top\`, so a row hidden via display:none leaves an
// empty slot instead of collapsing. This shim shifts every visible row up
// by the total height of hidden rows above it, re-applying via
// MutationObserver whenever Slack repositions things. Hide whole rows
// ([data-qa="virtual-list-item"]:has(...)) for this to kick in.
function reflowPayload() {
  return `(() => {
    const install = () => {
      const reflow = () => {
        for (const list of document.querySelectorAll('[data-qa="slack_kit_list"]')) {
          // Never touch Slack's inline \`top\` — virtual lists recycle DOM
          // nodes while scrolling, so any stored "original position" goes
          // stale and rows collide. Instead treat \`top\` as the source of
          // truth and apply our shift as a transform, recomputed from
          // scratch (stateless, idempotent) on every pass.
          const rows = [...list.querySelectorAll('[data-qa="virtual-list-item"]')]
            .map((el) => {
              const top = parseFloat(el.style.top);
              if (Number.isNaN(top)) return null;
              delete el.dataset.sdOrig; delete el.dataset.sdSet; // legacy cleanup
              return { el, top, h: parseFloat(el.style.height) || el.offsetHeight };
            })
            .filter(Boolean)
            .sort((a, b) => a.top - b.top);
          let shift = 0;
          for (const r of rows) {
            if (getComputedStyle(r.el).display === "none") { shift += r.h; continue; }
            const want = shift ? \`translateY(-\${shift}px)\` : "";
            if (r.el.style.transform !== want) r.el.style.transform = want;
          }
        }
      };
      // Debounced re-run on any DOM/position change. Our own writes trigger
      // one extra pass, which is then a no-op, so it settles.
      window.__sdReflowObs?.disconnect();
      let t;
      const kick = () => { clearTimeout(t); t = setTimeout(reflow, 80); };
      window.__sdReflowObs = new MutationObserver(kick);
      window.__sdReflowObs.observe(document.body, {
        subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"],
      });
      kick();
    };
    if (document.body) install();
    else document.addEventListener("DOMContentLoaded", install, { once: true });
  })();`;
}

// CSS + reflow + custom.js — runs on attach, page load, and file save
// (not every tick).
function fullPayload() {
  const js = read(JS_FILE);
  return `${cssPayload()}
  ${reflowPayload()}
  (() => { try { ${js} } catch (e) { console.warn("slack-debloat custom.js:", e); } })();`;
}

const attached = new Map(); // targetId -> WebSocket

async function targets() {
  const res = await fetch(`${BASE}/json/list`);
  return (await res.json()).filter(
    (t) => (t.type === "page" || t.type === "webview") &&
           t.url.includes("slack.com") &&
           t.webSocketDebuggerUrl
  );
}

function attach(t) {
  if (attached.has(t.id)) return;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  attached.set(t.id, ws);
  let msgId = 0;
  const send = (method, params = {}) =>
    ws.send(JSON.stringify({ id: ++msgId, method, params }));

  // Registrations accumulate, but the payload upserts one style tag and
  // the newest registration runs last, so last save wins.
  ws._full = () => {
    send("Page.addScriptToEvaluateOnNewDocument", { source: fullPayload() });
    send("Runtime.evaluate", { expression: fullPayload() });
  };
  ws._css = () => send("Runtime.evaluate", { expression: cssPayload() });

  ws.onopen = () => {
    console.log(`[attach] ${t.title || t.url}`);
    send("Page.enable");
    ws._full();
  };
  ws.onmessage = (m) => {
    try {
      // Slack's boot can replace the document after load — re-inject fully
      // whenever a page load completes.
      if (JSON.parse(m.data).method === "Page.loadEventFired") ws._full();
    } catch { /* ignore non-JSON frames */ }
  };
  ws.onclose = () => { attached.delete(t.id); };
  ws.onerror = () => { ws.close(); };
}

// Live-reload via mtime polling — fs.watch silently dies when editors
// replace the file (rename/new inode), so poll instead.
const mtime = (f) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
let lastStamp = mtime(CSS_FILE) + mtime(JS_FILE);

console.log(`slack-debloat: watching ${BASE} …`);
while (true) {
  try { (await targets()).forEach(attach); }
  catch { /* Slack not up yet, or port closed — keep polling */ }

  const stamp = mtime(CSS_FILE) + mtime(JS_FILE);
  const changed = stamp !== lastStamp;
  if (changed) {
    lastStamp = stamp;
    console.log("[reload] files changed");
  }
  for (const ws of attached.values()) {
    if (ws.readyState !== 1) continue;
    if (changed) ws._full();
    else ws._css(); // cheap per-tick re-assert; heals a wiped style tag
  }
  await new Promise((r) => setTimeout(r, 1000));
}
