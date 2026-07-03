#!/usr/bin/env node
// Capture a screenshot of the main Slack window (optionally clipped to a
// CSS selector). Usage:
//   node screenshot.mjs out.png
//   node screenshot.mjs sidebar.png '.p-channel_sidebar'
import { writeFileSync } from "node:fs";

const [out, selector] = process.argv.slice(2);
if (!out) { console.error("usage: node screenshot.mjs <out.png> [css-selector]"); process.exit(1); }

const PORT = process.env.SLACK_CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("slack.com"));
if (!page) { console.error("no Slack window found on CDP port"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (!pending.has(d.id)) return;
  const { resolve, reject } = pending.get(d.id);
  pending.delete(d.id);
  d.error ? reject(new Error(d.error.message)) : resolve(d.result);
};

ws.onopen = async () => {
  try {
    let clip;
    if (selector) {
      const { result } = await send("Runtime.evaluate", {
        expression: `JSON.stringify(document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect())`,
        returnByValue: true,
      });
      const r = JSON.parse(result.value || "null");
      if (!r) { console.error(`selector not found: ${selector}`); process.exit(1); }
      clip = { x: r.x, y: r.y, width: r.width, height: r.height, scale: 2 };
    }
    const shot = await send("Page.captureScreenshot", { format: "png", ...(clip && { clip }) });
    writeFileSync(out, Buffer.from(shot.data, "base64"));
    console.log(`saved ${out}`);
    process.exit(0);
  } catch (e) { console.error(e.message); process.exit(1); }
};
setTimeout(() => { console.error("timeout"); process.exit(1); }, 10000);
