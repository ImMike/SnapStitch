# SnapStitch privacy policy

_Effective November 10, 2026._

SnapStitch is a free, open-source screenshot and screen recording extension for Chrome, Edge and Brave, with an optional Windows desktop app, SnapStitch Desktop. This policy covers both.

## Summary

**Nothing SnapStitch handles ever leaves your computer.** It does not transmit, sell or share any of your data. It has no servers, no accounts, no analytics and no ads. The extension makes no network requests, and the desktop app blocks all network requests.

## What SnapStitch handles, and where it stays

- **Screenshots and recordings you take.** They're kept in the extension's local browser storage so the preview tab can show them. Only the 20 most recent screenshots and the 5 most recent recordings are kept; older ones are deleted automatically. **Delete** in the preview removes a capture immediately. A capture becomes a file only when you click **Download**, and it goes to your own Downloads folder.
- **The title and address of the page you captured, and when.** They're stored with the capture, locally, to label the preview and name downloaded files.
- **Your pointer position and clicks, during a recording.** They're drawn into the video so viewers can follow along, and aren't stored anywhere else.
- **Your clipboard.** SnapStitch writes to it only when you copy a screenshot. Area screenshots are copied automatically. SnapStitch never reads your clipboard.
- **Recording status.** While a recording runs, the extension remembers that it is running. This lasts until the recording stops or the browser closes.

None of this ever leaves your computer.

## Permissions

| Permission | Why it's needed |
|---|---|
| `activeTab` | Access to the current tab only, after you click the icon or press a shortcut |
| `scripting` | Shows the selection overlay, scrolls for full-page screenshots, and tracks the pointer during recordings |
| `clipboardWrite` | Copies screenshots to your clipboard |
| `tabCapture`, `offscreen` | Records the tab in a hidden extension page |
| `storage` | Remembers that a recording is running, for as long as the browser stays open |
| `nativeMessaging` (optional) | Receives captures from SnapStitch Desktop. Only requested, with your click, the first time the desktop app sends a capture |

SnapStitch has no access to websites you don't capture, and it runs no code from the internet.

## SnapStitch Desktop (optional)

If you install the desktop app, each capture is written to a folder in your Windows user profile (`%LOCALAPPDATA%\SnapStitch\captures`). It is handed to the extension through the browser's native messaging channel, which runs on your computer and not over the network. The folder is deleted as soon as the preview tab has the capture. The app keeps its settings, such as which browser to open captures in, in your user profile. Uninstalling removes them.

## Third parties

None. SnapStitch includes one open-source library, the [gifenc](https://github.com/mattdesl/gifenc) GIF encoder, which runs inside the extension and sends nothing anywhere.

SnapStitch's use of information complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. In the store's privacy disclosure, SnapStitch lists website content (your captures), web history (the title, address and time saved with each capture) and user activity (pointer and clicks in recordings), because the store counts data handled on your own computer. None of it is used outside your computer.

## Changes

Changes to this policy are published in this file, with the effective date updated. The full history is in this repository's commits.

## Contact

Questions? Open an issue at [github.com/ImMike/SnapStitch/issues](https://github.com/ImMike/SnapStitch/issues).
