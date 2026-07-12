# Context7: Chrome Extensions (ctrl-tab stack)

Resolved library: `/websites/developer_chrome_google_cn_extensions` (Chrome Extensions docs, MV3).

## Patterns relevant to this repo

### Background to active tab

```javascript
async function sendMessageToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return await chrome.tabs.sendMessage(tab.id, message);
}
```

### Content script to service worker

```javascript
chrome.runtime.sendMessage({ type: "overlay-show" }, (response) => {
  initializeUI(response);
});
```

### Keyboard commands

```javascript
chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-tab") return;
  // open switcher
});
```

Fetched via Context7 MCP on 2026-06-04.
