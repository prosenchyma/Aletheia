chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "truthcheck",
    title: "Check with TruthCheck",
    contexts: ["selection"],
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "truthcheck") return;
  chrome.sidePanel.open({ tabId: tab.id });
  chrome.storage.session.set({
    pending: { text: info.selectionText, ts: Date.now() },
  });
});