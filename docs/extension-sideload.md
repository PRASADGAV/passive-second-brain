# Chrome Extension — Sideload Guide

## Load the Extension in Chrome / Brave / Edge

1. Open your browser and go to: `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Navigate to `C:\Users\prasa\Desktop\Mega\extension` and select that folder
5. The **Passive Second Brain** extension will appear in your extension list
6. Click the puzzle icon in the toolbar and **pin** the extension for easy access

## Configure the Extension

Before the extension can talk to your backend, set these values in the extension popup:

1. Click the PSB icon in your toolbar
2. The popup shows tracking status and queue count
3. The extension automatically connects to `http://localhost:8090`

If your backend runs on a different port, open `extension/background.js` and update:
```javascript
const { PSB_API_URL = 'http://localhost:8090', ... }
```

## How It Works

| Trigger | What happens |
|---------|-------------|
| You read a webpage for **60+ seconds** | Page text is captured and queued |
| You watch a YouTube video past **50%** | Transcript is fetched and queued |
| You click **Pause** in popup | All capturing stops immediately |
| You click **Resume** | Capturing resumes |

## Blocked Domains (never captured)

`instagram.com`, `twitter.com`, `x.com`, `reddit.com`, `facebook.com`,
`netflix.com`, `tiktok.com`, `snapchat.com`, `pinterest.com`, `tumblr.com`,
`twitch.tv`, `discord.com`

Plus any page with these in the URL path: `signin`, `login`, `password`, `billing`, `checkout`, `bank`, `paypal`

## Package as ZIP (for submission)

The `psb-extension.zip` file at the project root contains the packaged extension.
To repackage:
```powershell
cd C:\Users\prasa\Desktop\Mega
Compress-Archive -Path extension\* -DestinationPath psb-extension.zip -Force
```
