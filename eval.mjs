#!/usr/bin/env node
// Run a JS expression inside the main Slack window and print the result.
// Usage: node eval.mjs 'document.title'
const expr = process.argv[2];
if (!expr) { console.error("usage: node eval.mjs '<js expression>'"); process.exit(1); }

const PORT = process.env.SLACK_CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("slack.com"));
if (!page) { console.error("no Slack window found on CDP port"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.onopen = () =>
  ws.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression: expr, returnByValue: true, awaitPromise: true },
  }));
ws.onmessage = (m) => {
  const { result } = JSON.parse(m.data);
  if (result.exceptionDetails) console.error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  else console.log(JSON.stringify(result.result.value, null, 2));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(1); }, 8000);
