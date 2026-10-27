chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "Aletheia",
      title: "Check with Aletheia",
      contexts: ["selection"],
    });
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "Aletheia" || !tab) return;

  // Must be called right away, while Chrome still counts it as a user click
  chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.error("open failed", e));

  (async () => {
    let text = info.selectionText || "";
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => String(window.getSelection()),
      });
      if (r && r.result && r.result.length > text.length) text = r.result;
    } catch (e) {
      console.warn("Could not read the full selection, using menu text", e);
    }
    await chrome.storage.session.set({
      pending: { text, pageUrl: info.pageUrl, ts: Date.now() },
    });
  })();
});