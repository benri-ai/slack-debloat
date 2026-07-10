// Catalog of known debloat options. Each key can be enabled in config.json;
// the injector turns enabled keys into CSS. Selectors verified on Slack 4.50
// — data-qa attributes are Slack's own test hooks and reasonably stable, but
// a Slack update can rename them; check DevTools at localhost:9222 if a rule
// stops working.

const row = (inner) =>
  `[data-qa="virtual-list-item"]:has(${inner}) { display: none !important; }`;

export const OPTIONS = [
  { key: "hide-slackbot-dm",
    desc: "Slackbot DM row in the sidebar",
    css: row('[data-qa^="channel_sidebar_pslackbot"]') },
  { key: "hide-threads-row",
    desc: "Threads row in the sidebar",
    css: row('[data-qa="channel_sidebar_vall_threads"]') },
  { key: "hide-huddles-row",
    desc: "Huddles row in the sidebar",
    css: row('[data-qa="channel_sidebar_pbrowse-huddles"]') },
  { key: "hide-drafts-row",
    desc: "Drafts & sent row in the sidebar",
    css: row('[data-qa="channel_sidebar_pdrafts"]') },
  { key: "hide-directory-row",
    desc: "Directory row in the sidebar",
    css: row('[data-qa="channel_sidebar_directories_link"]') },
  { key: "hide-slack-connect-row",
    desc: "External connections (Slack Connect) header in the sidebar",
    css: row('[data-qa="slack_connect"]') },
  { key: "hide-activity-tab",
    desc: "Activity tab in the left rail (hides its notification badge too)",
    css: '[data-qa="tab_rail_activity_button"] { display: none !important; }' },
  { key: "hide-later-tab",
    desc: "Later tab in the left rail",
    css: '[data-qa="tab_rail_later_button"] { display: none !important; }' },
  { key: "hide-files-tab",
    desc: "Files tab in the left rail",
    css: '[data-qa="tab_rail_files_button"] { display: none !important; }' },
  { key: "hide-tools-tab",
    desc: "Tools tab in the left rail",
    css: '[data-qa="tabs_item"]:has([data-qa="tools"], [data-qa="tools-filled"]) { display: none !important; }' },
  { key: "hide-huddle-button",
    desc: "Huddle button in the channel header",
    css: '[data-qa="huddle_button"] { display: none !important; }' },
  { key: "hide-slackbot-ai-button",
    desc: "Slackbot AI button next to the search bar",
    css: '[data-qa="slackbot-ai-button"] { display: none !important; }' },
  { key: "hide-upsell-banners",
    desc: 'In-channel "megaphone" promo banners (Business+ trials etc.)',
    css: "#message-list_megaphone_container { display: none !important; }" },
  { key: "bigger-threads-row",
    desc: "Make the Threads sidebar row larger (18px semibold, bigger icon)",
    css: [
      '[data-qa="channel_sidebar_vall_threads"] { font-size: 18px !important; font-weight: 600 !important; }',
      '[data-qa="channel_sidebar_vall_threads"] [data-qa="small-reply"] svg { transform: scale(1.25); transform-origin: center; }',
    ].join("\n") },
];
