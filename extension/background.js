import { openInApp, selectionIn, sendScreenshot, sendText } from './shared.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'gh-text', title: 'Send selected job post to GetHired', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'gh-shot', title: 'Send this screen to GetHired (screenshot)', contexts: ['page', 'image'] });
  chrome.runtime.openOptionsPage();
});

function notify(message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'GetHired', message });
}

async function run(task) {
  try {
    const id = await task();
    await openInApp(id);
  } catch (err) {
    notify(err instanceof Error ? err.message : String(err));
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'gh-text') void run(() => sendText(info.selectionText || '', tab?.url));
  if (info.menuItemId === 'gh-shot') void run(async () => sendScreenshot(await chrome.tabs.captureVisibleTab({ format: 'png' })));
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'send-selection' || !tab?.id) return;
  void run(async () => sendText(await selectionIn(tab.id), tab.url));
});
