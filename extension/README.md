# GetHired Chrome extension

Send a job post to GetHired in one click — as selected text or a screenshot of the current view.

**Install (developer mode, until it's on the Chrome Web Store)**
1. Download `gethired-extension.zip` from GetHired → Settings → Chrome extension and unzip it (or use this folder).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the folder.
3. In the options page that opens, paste the token from GetHired → Settings → **Create token**, and save.

**Use it**
- Select a post's text → right-click → *Send selected job post to GetHired* (or `Alt+Shift+G`).
- Or click the toolbar icon → *Send screenshot of this view*.
GetHired opens on the review step with company, role and recruiter email filled in.

**Security:** the token only allows capturing posts (`POST /jobs/upload`, `POST /jobs/import`) and reading
the result — it can't send email, change settings or delete anything. Revoke it anytime in Settings.
