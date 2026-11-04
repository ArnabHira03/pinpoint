const DEFAULT_TITLE = "Pinpoint: comment on this page";

// Each click injects content.js. The script keeps its state on the page, so a
// repeat injection just toggles comment mode.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: DEFAULT_TITLE });
  } catch {
    // Chrome blocks extensions on pages such as chrome:// and the Web Store.
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({
      tabId: tab.id,
      title: "Pinpoint can't run on this page",
    });
  }
});
