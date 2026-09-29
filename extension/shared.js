// Shared by popup, options and the background worker.
export const DEFAULT_APP_URL = 'https://gethired-ankuu.vercel.app';

export async function getConfig() {
  const { appUrl = DEFAULT_APP_URL, token = '' } = await chrome.storage.sync.get(['appUrl', 'token']);
  return { appUrl: appUrl.replace(/\/+$/, ''), token };
}

async function api(path, init = {}) {
  const { appUrl, token } = await getConfig();
  if (!token) throw new Error('Connect the extension first: open its Options and paste your token from GetHired → Settings.');
  const res = await fetch(`${appUrl}/api/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Request failed (${res.status})`);
  return body;
}

export const me = () => api('/auth/me');

export async function sendText(rawText, sourceUrl) {
  const text = (rawText || '').trim();
  if (text.length < 40) throw new Error('Select the whole job post (at least a few lines) and try again.');
  const body = { rawText: text.slice(0, 20000) };
  if (sourceUrl && /^https?:\/\//.test(sourceUrl)) body.sourceUrl = sourceUrl.slice(0, 2000);
  const { jobPostId } = await api('/jobs/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return jobPostId;
}

export async function sendScreenshot(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const form = new FormData();
  form.append('screenshot', blob, 'post.png');
  const { jobPostId } = await api('/jobs/upload', { method: 'POST', body: form });
  return jobPostId;
}

export async function openInApp(jobPostId) {
  const { appUrl } = await getConfig();
  await chrome.tabs.create({ url: `${appUrl}/apps/new?job=${jobPostId}` });
}

/** Selected text in the active tab (works in LinkedIn's feed, job pages, Gmail, anywhere). */
export async function selectionIn(tabId) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => String(window.getSelection() || '') });
  return res?.result || '';
}
