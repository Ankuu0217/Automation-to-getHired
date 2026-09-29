import { DEFAULT_APP_URL, getConfig, me } from './shared.js';

const $ = (id) => document.getElementById(id);
getConfig().then(({ appUrl, token }) => { $('appUrl').value = appUrl; $('token').value = token; });

$('save').onclick = async () => {
  const appUrl = ($('appUrl').value.trim() || DEFAULT_APP_URL).replace(/\/+$/, '');
  const token = $('token').value.trim();
  const status = $('status');
  try {
    const origin = new URL(appUrl).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error('Permission to reach GetHired was not granted.');
    await chrome.storage.sync.set({ appUrl, token });
    const { user } = await me();
    status.textContent = `Connected as ${user.email}. You can close this tab.`;
    status.className = 'status ok';
  } catch (e) {
    status.textContent = e.message;
    status.className = 'status bad';
  }
};
