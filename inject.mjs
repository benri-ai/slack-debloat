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

// CSS + custom.js — runs on attach, page load, and file save (not every tick).
function fullPayload() {
  const js = read(JS_FILE);
  return `${cssPayload()}
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
