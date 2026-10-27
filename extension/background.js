chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "Aletheia",
    title: "Check with Aletheia",
    contexts: ["selection"],
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "Aletheia") return;
  chrome.sidePanel.open({ tabId: tab.id });
  chrome.storage.session.set({
    pending: { text: info.selectionText, pageUrl: info.pageUrl, ts: Date.now() },
  });
});