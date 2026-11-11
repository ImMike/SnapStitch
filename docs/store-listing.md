# Chrome Web Store listing

Everything needed to publish SnapStitch on the [Chrome Web Store](https://chrome.google.com/webstore/devconsole), ready to copy into the developer dashboard. Brave installs from the Chrome Web Store too, and the same zip works for [Microsoft Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge/), which is free.

SnapStitch Desktop, the optional Windows app, isn't part of this listing. It's a Windows program, distributed separately.

## 1. Build the upload

```powershell
powershell -File tools\package-extension.ps1   # writes dist\SnapStitch-<version>.zip
```

The zip contains only `manifest.json`, `src/` and `icons/`. Raise `version` in `manifest.json` before each new upload.

## 2. Account (one time)

- Register at the developer dashboard and pay the one-time fee.
- Use an email address you don't mind being public: the store can show it on the listing, and it can't be changed later.
- Declare **Non-trader**. SnapStitch is free, has no ads and earns nothing. Traders must publish their name, address and phone number on the listing.

## 3. Store listing tab

**Name:** SnapStitch (from the manifest)

**Summary:** taken from the manifest's `description` (131 of 132 characters):

> Screenshot or record a dragged area or the visible page, or stitch the whole scrolling page into one image. Saves PNG, MP4 and GIF.

**Description:**

```
Take screenshots and screen recordings of any web page, and keep them on your own computer.

SCREENSHOTS
• Select area (Alt+Shift+S): drag a box and it's copied to your clipboard right away, ready to paste into a chat, an email or a document.
• Visible page (Alt+Shift+V): everything in the window, in one shortcut.
• Whole page (Alt+Shift+F): SnapStitch scrolls the page for you and stitches it into one sharp PNG. Sticky headers and floating buttons appear once, not on every part.

SCREEN RECORDING
• Record an area (Alt+Shift+G) or the whole visible page.
• Get both an MP4 (full resolution, up to 30 fps) and a GIF (up to 10 fps, 800 px wide) from every recording.
• Your mouse pointer and clicks are drawn into the video, which makes tutorials and bug reports easy to follow.
• The outline and Stop bar stay outside the recorded area, so they never show up in the video.

EVERY CAPTURE OPENS IN A PREVIEW TAB
Copy it, download it as PNG, MP4 or GIF, or delete it.

PRIVATE BY DESIGN
• No account, no sign-up.
• No uploads: SnapStitch makes no network requests at all.
• No analytics, no ads, no remote code.
• Your 20 most recent screenshots and 5 most recent recordings are kept in your browser so the preview can show them. Older ones are deleted automatically.

OPTIONAL: CAPTURE YOUR WHOLE WINDOWS DESKTOP
SnapStitch Desktop is a separate, optional Windows app that captures other programs and any monitor with PrtSc. Its captures open in this same preview tab. SnapStitch asks for permission to talk to it only the first time it sends you a capture. Everything works without it.

FREE AND OPEN SOURCE
MIT licensed. Read every line at https://github.com/ImMike/SnapStitch

All shortcuts can be changed at chrome://extensions/shortcuts.
```

**Category:** Productivity → Tools

**Language:** English

**Graphics:**

| Store field | File |
|---|---|
| Store icon (128×128) | `icons/128.png` |
| Screenshots (1280×800), in this order | `docs/store/1-area.png`, `2-full-page.png`, `3-record.png`, `4-popup.png`, `5-private.png` |
| Small promo tile (440×280) | `docs/store/promo-tile.png` |
| Marquee promo tile (1400×560) | `docs/store/marquee-tile.png` |
| Global promo video | Leave empty. It's optional and needs a YouTube upload. |

Regenerate these with `cd test && npm run shots`. They're made from a fictional demo page, never a real site. All are 24-bit PNGs without alpha, as the store requires.

**Homepage URL:** https://github.com/ImMike/SnapStitch
**Support URL:** https://github.com/ImMike/SnapStitch/issues

## 4. Privacy practices tab

**Single purpose:**

> SnapStitch takes screenshots and screen recordings of the current web page and keeps them on the user's computer, where the user can copy, download or delete them.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `activeTab` | Gives access to the current tab only after the user clicks the toolbar icon or presses a SnapStitch shortcut, to capture it. SnapStitch requests no host permissions. |
| `scripting` | Injects the drag-to-select overlay, scrolls the page to capture it in parts for whole-page screenshots, and tracks the pointer during recordings so it can be drawn into the video. Only on the tab the user chose to capture. |
| `clipboardWrite` | Copies a screenshot to the clipboard when the user selects an area or clicks Copy. |
| `tabCapture` | Records the current tab when the user starts a recording. |
| `offscreen` | Runs the recorder (video encoding and GIF creation) in a hidden extension page, as Manifest V3 requires for media capture. |
| `storage` | Remembers, for the browser session only, that a recording is running, so the toolbar popup can show Stop and the recording survives a service worker restart. |
| `nativeMessaging` (optional) | Requested only with a click, the first time SnapStitch Desktop (an optional Windows app by the same developer) sends a capture. It's used only to receive that capture from the app on the same computer. Never requested otherwise. |

**Remote code:** No, I am not using remote code. All JavaScript is packaged in the extension.

**Data usage:** Google counts data handled only on the user's device as handled ([User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq): disclosure is required "even when data is processed or stored locally on a user's device"). SnapStitch transmits nothing, but it handles these locally, so check them:
- **Website content**: screenshots and recordings are images and videos of the page.
- **Web history**: the page title, address and time are saved with each capture.
- **User activity**: pointer position and clicks are drawn into recordings.

Leave the rest unchecked. Then certify all three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/ImMike/SnapStitch/blob/main/PRIVACY.md

## 5. Test instructions tab

Leave **Username** and **Password** empty. **Additional instructions** (474 of 500 characters):

```
No account or login. Open any normal website (Chrome blocks capture on chrome:// pages and the Web Store itself), then click the SnapStitch icon. Screenshot > Select area: drag a box; it opens in a preview tab and is copied to the clipboard. Visible page and Whole page work the same way. Record MP4 / GIF > Select area: drag, then click Stop; the preview offers MP4 and GIF. nativeMessaging is optional, used only by our separate Windows app, and never requested otherwise.
```

## 6. Distribution tab

Free, public, all regions.

## After it's published

- Live at <https://chromewebstore.google.com/detail/snapstitch/ogekamablglppgbiapemomeiekmiogpf> (ID `ogekamablglppgbiapemomeiekmiogpf`), linked from the README.
- The store gives the extension its own ID. SnapStitch Desktop finds the extension by its manifest, so it works with the store version without changes.
