import { me, openInApp, selectionIn, sendScreenshot, sendText } from './shared.js';

const $ = (id) => document.getElementById(id);
const status = (msg, bad = false) => { $('status').textContent = msg; $('status').className = `status ${bad ? 'bad' : ''}`; };

me().then(({ user }) => { $('who').textContent = `Connected as ${user.email}`; })
  .catch((e) => { $('who').textContent = e.message; $('who').className = 'bad'; });

async function go(label, task) {
  status(`${label}…`);
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  try {
    const id = await task();
    status('Sent — opening GetHired…');
    await openInApp(id);
    window.close();
  } catch (e) {
    status(e.message, true);
    for (const b of document.querySelectorAll('button')) b.disabled = false;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

$('text').onclick = () => go('Sending text', async () => {
  const tab = await activeTab();
  return sendText(await selectionIn(tab.id), tab.url);
});
$('shot').onclick = () => go('Capturing', async () => sendScreenshot(await chrome.tabs.captureVisibleTab({ format: 'png' })));
$('opts').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
