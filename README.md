<p align="center">
  <img src="docs/images/hero.png" alt="SnapStitch, a free Gyazo alternative: screenshot and screen recorder extension for Chrome, Edge and Brave that keeps everything on your PC" width="100%">
</p>

<h1 align="center">SnapStitch: free screenshot and screen recorder for Chrome</h1>

<p align="center">
  <b>A private, open-source Gyazo alternative. Screenshot an area, the visible page or the whole scrolling page, and record your tab as MP4 or GIF.<br>Everything stays on your PC: no account, no uploads, no watermark.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/price-free-brightgreen" alt="Free">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license">
  <img src="https://img.shields.io/badge/uploads-none-success" alt="No uploads">
  <img src="https://img.shields.io/badge/Manifest-V3-4f46e5" alt="Chrome Manifest V3">
  <img src="https://img.shields.io/badge/works%20in-Chrome%20%7C%20Edge%20%7C%20Brave-lightgrey" alt="Works in Chrome, Edge and Brave">
</p>

<p align="center">
  <a href="#install-in-2-minutes">Install</a> ·
  <a href="#features">Features</a> ·
  <a href="#how-snapstitch-compares">Compare</a> ·
  <a href="#privacy-and-security">Privacy</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="#for-developers">Developers</a>
</p>

---

**SnapStitch** is a free browser extension for taking screenshots and making screen recordings in Google Chrome, Microsoft Edge, Brave and other Chromium browsers. It does what Gyazo, Lightshot, Awesome Screenshot, GoFullPage, Nimbus, Loom and Screencastify do for quick captures, with one difference: **your captures never leave your computer.** There's no cloud, no sign-up and no tracking. The extension makes no network requests at all.

- **Screenshot a dragged area.** It's copied to your clipboard right away, ready to paste into Slack, Discord, email or docs.
- **Screenshot the visible page** with one shortcut.
- **Screenshot the whole page.** SnapStitch scrolls for you and stitches everything into one sharp PNG, with no repeated sticky headers.
- **Record your screen as MP4 or GIF.** Record a dragged area or the full visible page. A pointer and click rings are drawn in, which makes tutorials and bug reports easy to follow.
- **Free and open source** (MIT). It's about 70 KB, needs no build step, and you can read every line.

## Features

### Screenshot any area, copied to the clipboard automatically

Press `Alt+Shift+S`, drag a box, done. The screenshot opens in a preview tab with **Copy** and **Download PNG** buttons. It's already on your clipboard, so you can paste it straight away.

<p align="center">
  <img src="docs/images/area-select.png" alt="Selecting an area of a web page to screenshot with SnapStitch" width="88%">
</p>

### Full-page screenshot (scrolling screenshot)

Press `Alt+Shift+F` to capture the **entire page**, top to bottom, in one image. SnapStitch scrolls through the page, captures each part and stitches the parts together pixel for pixel, at any Windows display scaling or browser zoom. It's tested at 100% and 150%. Sticky headers appear once, and floating chat buttons and pop-ups don't repeat on every tile.

<p align="center">
  <img src="docs/images/full-page.png" alt="Full-page scrolling screenshot in Chrome: the visible screen compared with the stitched whole-page image" width="88%">
</p>

### Screen recorder: MP4 and GIF from one recording

Press `Alt+Shift+G` and drag an area, or choose **Record visible page** in the popup. A dashed outline and a small **Stop** bar appear *outside* the area, so neither ends up in your video. Stop with the bar, the toolbar icon, or `Alt+Shift+G` again.

You get **both an MP4 and a GIF** from the same recording. Pick either one, or both, in the preview tab.

<p align="center">
  <img src="docs/images/demo.gif" alt="Animated GIF made with SnapStitch's screen recorder, showing the drawn mouse pointer, click ring and scrolling" width="72%">
  <br><sub>This GIF was recorded with SnapStitch: the pointer, the click ring and the scrolling are all real.</sub>
</p>

<p align="center">
  <img src="docs/images/recording.png" alt="Area screen recording in progress with SnapStitch's dashed outline and Stop button" width="49%">
  <img src="docs/images/preview-recording.png" alt="SnapStitch preview tab with an MP4 and GIF toggle and download buttons" width="49%">
</p>

- **MP4 (H.264)** at full resolution, up to 30 fps. It's the standard video format that common players and apps can open.
- **GIF** at up to 10 fps and 800 px wide, sized for chats, READMEs and tickets.
- **Drawn mouse pointer and click rings.** Chrome can't include the real pointer when it records a tab, so SnapStitch draws one in.
- **Accurate colors and length.** The video matches how long you recorded.

### Simple popup and keyboard shortcuts, in light or dark mode

<p align="center">
  <img src="docs/images/popup.png" alt="SnapStitch popup menu in light and dark mode with screenshot and screen recording options" width="70%">
</p>

| Action | Shortcut |
|---|---|
| Screenshot an area | `Alt+Shift+S` |
| Screenshot the visible page | `Alt+Shift+V` |
| Screenshot the whole page | `Alt+Shift+F` |
| Record an area / stop recording | `Alt+Shift+G` |
| Record the visible page | Set your own at `chrome://extensions/shortcuts` |

You can change any shortcut at `chrome://extensions/shortcuts`, or from **Change shortcuts** in the popup.

## How SnapStitch compares

| | **SnapStitch** | Typical cloud screenshot tools |
|---|---|---|
| Price | **Free, no limits** | Often free with limits, or paid |
| Account needed | **No** | Usually |
| Where your captures go | **Your computer only** | The company's servers |
| Watermarks | **Never** | Sometimes on free plans |
| Area, visible and full-page screenshots | **Yes** | Varies |
| Screen recording to MP4 **and** GIF | **Yes** | Varies |
| Works offline | **Yes** | Usually needs a connection |
| Open source, auditable | **Yes (MIT)** | Usually not |

If you want a **free Gyazo alternative**, a **Lightshot alternative without uploads**, a **GoFullPage alternative for full-page screenshots**, or a lightweight **Loom or Screencastify alternative for quick tab recordings** (when you don't need cloud sharing links), SnapStitch is built for you.

## Install in 2 minutes

SnapStitch isn't in the Chrome Web Store yet, so you install it straight from this repository. It's safe, and it takes about 2 minutes:

1. **Download:** click the green **Code** button at the top of this page, then **Download ZIP**.
2. **Unzip** it somewhere permanent, for example `Documents\SnapStitch`. Don't delete the folder afterwards: the browser loads the extension from it.
3. Open your extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
4. Turn on **Developer mode** (top-right in Chrome, left sidebar in Edge).
5. Click **Load unpacked** and select the unzipped folder, the one that contains `manifest.json`.
6. **Pin it.** Click the puzzle-piece icon in the toolbar, then click the pin next to **SnapStitch**.

To **update**, download the ZIP again, replace the folder, and click the reload icon on the SnapStitch card in your extensions page.

> **Requirements:** Chrome 116 or newer. Microsoft Edge, Brave, Opera and Vivaldi use the same engine and should work too (it's tested on Chrome). MP4 recording needs Chrome 126 or newer. Older versions save recordings as WebM instead.

## How to use

**Screenshots:** use a shortcut or the popup. Each screenshot opens in a preview tab:

- **Copy** (`Ctrl+C`) puts the image on your clipboard.
- **Download PNG** (`Ctrl+S`) saves it to your Downloads folder.
- Click a wide image to switch between fit-to-window and actual size.

**Recordings:** start with `Alt+Shift+G` (an area) or from the popup (an area or the visible page). While you record, the toolbar icon shows a red timer. To stop, do any of these:

- Press `Alt+Shift+G` again.
- Click the toolbar icon, then **Stop and save**.
- For area recordings, click **Stop** on the bar next to the area.

**Discard** throws a recording away. Closing the tab also stops and saves it. The preview tab plays the result and has **Download MP4** and **Download GIF** buttons.

## Privacy and security

SnapStitch was built for people who don't want their screenshots on someone else's server.

- **No network requests.** The extension never contacts any server. There's no analytics, telemetry, ads or remote code. Manifest V3 doesn't allow remote code anyway.
- **No account.** Nothing to sign up for, nothing to log into.
- **Your files, your disk.** Recent captures are kept in your browser's local extension storage so the preview tab can show them: the 20 latest screenshots and the 5 latest recordings. Older ones are deleted automatically. A capture becomes a file only when you click Download, and it goes to your own Downloads folder.
- **Minimal permissions.** The extension can only touch the tab you're capturing, and only after you click the icon or press a shortcut.

| Permission | Why it's needed |
|---|---|
| `activeTab` | Access to the current tab only, after you click the icon or press a shortcut |
| `scripting` | Shows the selection overlay, scrolls for full-page shots, and tracks the pointer during recordings |
| `clipboardWrite` | Copies screenshots to your clipboard |
| `tabCapture`, `offscreen` | Records the tab in a hidden extension page |
| `storage` | Remembers that a recording is running, for as long as the browser stays open |

All the code is in [`src/`](src): about 1,600 lines plus one small open-source GIF encoder. You're welcome to audit it.

## FAQ

<details>
<summary><b>Is SnapStitch really free?</b></summary>

Yes. It's open source under the MIT license: no paid tier, no limits, no watermark, no ads.
</details>

<details>
<summary><b>Where are my screenshots and recordings saved?</b></summary>

On your computer. Recent captures stay in the browser's local storage so they can be shown in the preview tab. When you click **Download**, the file is saved to your normal Downloads folder. Nothing is uploaded.
</details>

<details>
<summary><b>How do I take a full-page screenshot in Chrome?</b></summary>

Install SnapStitch and press `Alt+Shift+F`, or click the toolbar icon and choose **Whole page**. It scrolls the page, stitches it into one PNG and opens it in a preview tab, ready to download.
</details>

<details>
<summary><b>How do I record my screen as a GIF or MP4 in Chrome?</b></summary>

Press `Alt+Shift+G` and drag the area you want, or choose **Record → Visible page** in the popup. Press `Alt+Shift+G` again to stop. The preview lets you download the recording as **MP4** or **GIF**.
</details>

<details>
<summary><b>Is it a good Gyazo alternative?</b></summary>

If you liked Gyazo's quick drag-to-capture but don't want your images uploaded or tied to an account, yes. SnapStitch also adds full-page screenshots and MP4 recording, and it has no capture limits.
</details>

<details>
<summary><b>Does it record audio or my whole desktop?</b></summary>

Not currently. SnapStitch records the current browser tab (an area or the full visible page) without sound. That covers most bug reports, tutorials and quick demos.
</details>

<details>
<summary><b>Does it work in Microsoft Edge, Brave, Opera or Vivaldi?</b></summary>

It's built on the standard Chromium extension platform (Manifest V3), so it should. Install it the same way, using the browser's own extensions page. It's tested on Google Chrome.
</details>

<details>
<summary><b>Why is there a "developer mode" warning?</b></summary>

Browsers show that for any extension installed from a folder instead of the Web Store. It isn't a sign that anything is wrong. You can read all of SnapStitch's code in this repository.
</details>

## Limitations

- Pages that scroll an inner panel instead of the whole window (some web apps) can only be captured as the visible part.
- Browsers don't let extensions capture their own internal pages (`chrome://`, the Web Store). When you try, a red `!` badge appears on the icon.
- Recordings have no audio and stop on their own after 10 minutes.
- The drawn pointer pauses over embedded content from another site, such as a video player. It also stops after the page navigates, though the recording itself continues.
- To capture local `file://` pages, turn on **Allow access to file URLs** on the extension's details page.

## For developers

SnapStitch is plain JavaScript with no build step and no runtime dependencies besides a bundled copy of [gifenc](https://github.com/mattdesl/gifenc) (MIT).

```
manifest.json         Manifest V3: permissions, shortcuts
src/background.js     service worker: shortcuts, screenshots, stitching, recording control
src/page-fns.js       functions injected into the page for full-page capture
src/overlay.js        drag-to-select overlay (screenshots and recordings)
src/recorder.*        hidden page that records: tab capture, crop, pointer, MP4 + GIF
src/gif-worker.js     GIF encoding in a worker
src/ticker.js         steady clock so the recorder makes frames even on still pages
src/rec-ui.js         in-page part of a recording: pointer tracking, area outline, Stop bar
src/db.js             IndexedDB storage for recent captures
src/popup.*           toolbar popup
src/preview.*         preview tab (copy and download)
test/                 end-to-end tests and the README screenshot generator
docs/chrome-notes.md  Chrome behaviors the code relies on (read before changing capture code)
```

**Run the tests.** They load the real extension into Chrome for Testing and drive it through the toolbar popup, the same way a user would:

```bash
cd test
npm install      # downloads Chrome for Testing the first time (~170 MB)
npm test         # 26 checks at 1x and 1.5x display scaling
ONLY=record npm test   # run a subset
```

The tests check images and videos pixel by pixel:

- Every stitched row appears exactly once.
- Crops are exact.
- Video colors and length are right.
- The drawn pointer follows the mouse.
- The recording outline never bleeds into the video.

**Regenerate the README images** with `npm run shots`. It drives the extension on a fictional demo page (`test/fixtures/demo-page.html`).

Contributions are welcome. Please run `npm test` before opening a pull request, and read [docs/chrome-notes.md](docs/chrome-notes.md) if you touch capture or recording code.

## License

[MIT](LICENSE) © ImMike. The bundled [gifenc](https://github.com/mattdesl/gifenc) is MIT © Matt DesLauriers.

<sub>SnapStitch is an independent project, not affiliated with or endorsed by Gyazo, Lightshot, Awesome Screenshot, GoFullPage, Nimbus, Loom, Screencastify, Google or Microsoft. All product names are trademarks of their respective owners and are used only to describe compatibility and alternatives.</sub>

<sub>Keywords: free screenshot extension, Gyazo alternative, full page screenshot Chrome, scrolling screenshot, screen recorder Chrome extension, record screen to GIF, MP4 screen recorder, private screenshot tool, no upload, offline, open source, Edge, Brave.</sub>
