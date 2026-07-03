#!/usr/bin/env node
// Interactive configurator: pick what to hide/change, and the choices are
// written to a managed block in custom.css (anything you wrote by hand
// outside that block is left alone). If Slack is running debloated, each
// option is live-probed against the real DOM, and saved changes apply
// within ~1 second.
//
// Usage: node configure.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const DIR = dirname(fileURLToPath(import.meta.url));
const CSS_FILE = join(DIR, "custom.css");
const EXAMPLE_FILE = join(DIR, "custom.css.example");
const PORT = process.env.SLACK_CDP_PORT || 9222;

const BLOCK_START = "/* >>> slack-debloat managed block — run `node configure.mjs` to change */";
const BLOCK_END = "/* <<< slack-debloat managed block */";

const row = (inner) =>
  `[data-qa="virtual-list-item"]:has(${inner}) { display: none !important; }`;

const OPTIONS = [
  { key: "slackbot-dm", label: "Slackbot DM row (sidebar)",
    css: row('[data-qa^="channel_sidebar_pslackbot"]'),
    probe: '[data-qa^="channel_sidebar_pslackbot"]' },
  { key: "threads-row", label: "Threads row (sidebar)",
    css: row('[data-qa="channel_sidebar_vall_threads"]'),
    probe: '[data-qa="channel_sidebar_vall_threads"]' },
  { key: "huddles-row", label: "Huddles row (sidebar)",
    css: row('[data-qa="channel_sidebar_pbrowse-huddles"]'),
    probe: '[data-qa="channel_sidebar_pbrowse-huddles"]' },
  { key: "drafts-row", label: "Drafts & sent row (sidebar)",
    css: row('[data-qa="channel_sidebar_pdrafts"]'),
    probe: '[data-qa="channel_sidebar_pdrafts"]' },
  { key: "directory-row", label: "Directory row (sidebar)",
    css: row('[data-qa="channel_sidebar_directories_link"]'),
    probe: '[data-qa="channel_sidebar_directories_link"]' },
  { key: "slack-connect-row", label: "External connections header (sidebar)",
    css: row('[data-qa="slack_connect"]'),
    probe: '[data-qa="slack_connect"]' },
  { key: "activity-tab", label: "Activity tab (left rail) — hides its badge too",
    css: '[data-qa="tab_rail_activity_button"] { display: none !important; }',
    probe: '[data-qa="tab_rail_activity_button"]' },
  { key: "later-tab", label: "Later tab (left rail)",
    css: '[data-qa="tab_rail_later_button"] { display: none !important; }',
    probe: '[data-qa="tab_rail_later_button"]' },
  { key: "files-tab", label: "Files tab (left rail)",
    css: '[data-qa="tab_rail_files_button"] { display: none !important; }',
    probe: '[data-qa="tab_rail_files_button"]' },
  { key: "tools-tab", label: "Tools tab (left rail)",
    css: '[data-qa="tabs_item"]:has([data-qa="tools"], [data-qa="tools-filled"]) { display: none !important; }',
    probe: '[data-qa="tabs_item"]:has([data-qa="tools"], [data-qa="tools-filled"])' },
  { key: "huddle-button", label: "Huddle button (channel header)",
    css: '[data-qa="huddle_button"] { display: none !important; }',
    probe: '[data-qa="huddle_button"]' },
  { key: "slackbot-ai-button", label: "Slackbot AI button (next to search bar)",
    css: '[data-qa="slackbot-ai-button"] { display: none !important; }',
    probe: '[data-qa="slackbot-ai-button"]' },
  { key: "upsell-banners", label: "Upsell banners in the message pane (Business+ etc.)",
    css: "#message-list_megaphone_container { display: none !important; }",
    probe: "#message-list_megaphone_container" },
  { key: "threads-big", label: "Make the Threads row larger (18px semibold)",
    css: [
      '[data-qa="channel_sidebar_vall_threads"] { font-size: 18px !important; font-weight: 600 !important; }',
      '[data-qa="channel_sidebar_vall_threads"] [data-qa="small-reply"] svg { transform: scale(1.25); transform-origin: center; }',
    ].join("\n"),
    probe: '[data-qa="channel_sidebar_vall_threads"]' },
];

// --- custom.css read/write ------------------------------------------------

function loadCss() {
  if (existsSync(CSS_FILE)) return readFileSync(CSS_FILE, "utf8");
  if (existsSync(EXAMPLE_FILE)) return readFileSync(EXAMPLE_FILE, "utf8");
  return "";
}

function currentSelection(css) {
  const m = css.match(/\/\* config: ([a-z0-9,-]*) \*\//);
  return new Set(m && m[1] ? m[1].split(",") : []);
}

function withManagedBlock(css, keys) {
  const start = css.indexOf(BLOCK_START);
  const end = css.indexOf(BLOCK_END);
  let base = css;
  if (start !== -1 && end !== -1) {
    base = css.slice(0, start) + css.slice(end + BLOCK_END.length);
  }
  base = base.replace(/\n{3,}$/, "\n\n").replace(/^\n+/, "");
  if (keys.size === 0) return base;
  const rules = OPTIONS.filter((o) => keys.has(o.key))
    .map((o) => `/* ${o.label} */\n${o.css}`)
    .join("\n\n");
  return `${base.trimEnd()}\n\n${BLOCK_START}\n/* config: ${[...keys].join(",")} */\n\n${rules}\n\n${BLOCK_END}\n`;
}

// --- live probe against the running Slack ---------------------------------

async function probeLive() {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    const page = list.find((t) => t.type === "page" && t.url.includes("slack.com"));
    if (!page) return null;
    return await new Promise((resolve) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      ws.onopen = () =>
        ws.send(JSON.stringify({
          id: 1, method: "Runtime.evaluate",
          params: {
            expression: `JSON.stringify(${JSON.stringify(OPTIONS.map((o) => o.probe))}.map(s => { try { return !!document.querySelector(s); } catch { return false; } }))`,
            returnByValue: true,
          },
        }));
      ws.onmessage = (m) => { resolve(JSON.parse(JSON.parse(m.data).result.result.value)); ws.close(); };
      ws.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 3000);
    });
  } catch { return null; }
}

// --- interactive menu ------------------------------------------------------

const css = loadCss();
const selected = currentSelection(css);
console.log("slack-debloat configurator\n");
process.stdout.write("Probing your running Slack… ");
const found = await probeLive();
console.log(found ? "connected.\n" : "not reachable (launch via Slack Debloat to enable live checks).\n");

const PROMPT = "\nToggle by number (space-separated), (s)ave, (q)uit: ";

function renderMenu() {
  console.log("Pick what to hide/change:\n");
  OPTIONS.forEach((o, i) => {
    const mark = selected.has(o.key) ? "[x]" : "[ ]";
    const seen = found === null ? "" : found[i] ? "  ● in your Slack" : "  ○ not visible right now";
    console.log(`  ${String(i + 1).padStart(2)}. ${mark} ${o.label}${seen}`);
  });
  console.log("\n  ○ items may simply be scrolled out of view — rules still apply when they appear.");
  process.stdout.write(PROMPT);
}

function save() {
  writeFileSync(CSS_FILE, withManagedBlock(css, selected));
  console.log(`\nSaved ${CSS_FILE}`);
  console.log(found ? "Your running Slack updates within ~1 second." : "Changes apply next time Slack runs debloated.");
}

// Async line iterator instead of rl.question(): question() silently drops
// lines that arrive between prompts (breaks piped input) and never settles
// on EOF. The iterator consumes lines in order and ends cleanly on Ctrl-D.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let saved = false;
renderMenu();
for await (const line of rl) {
  const answer = line.trim().toLowerCase();
  if (answer === "q") break;
  if (answer === "s") { save(); saved = true; break; }
  const nums = answer.split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= OPTIONS.length);
  if (!nums.length) { process.stdout.write("Enter option numbers, s, or q." + PROMPT); continue; }
  for (const n of nums) {
    const key = OPTIONS[n - 1].key;
    selected.has(key) ? selected.delete(key) : selected.add(key);
  }
  console.log("");
  renderMenu();
}
rl.close();
if (!saved) console.log("\nNo changes saved.");
