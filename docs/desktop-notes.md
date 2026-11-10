# Windows and Electron behaviors SnapStitch Desktop depends on

SnapStitch Desktop (`desktop/`) relies on these behaviors. Each was found by a spike or a test on Windows 10 with Electron 45 (Chromium 156) and Brave 156. If you change the capture, hand-off or setup code, read this first, along with [chrome-notes.md](chrome-notes.md): the recorder is the same code.

## Hand-off to the browser

- **The browser accepts `chrome-extension://` URLs on its command line.** `brave.exe --profile-directory=<profile> chrome-extension://<id>/src/preview.html?desktop=<id>` opens the tab in the running browser in about 60 ms, or starts the browser if it's closed. Chromium's own launcher calls `AllowSetForegroundWindow` for the running instance, so the browser comes to the front. That's why the app launches the browser from the input handler (the key press or click), before it encodes the capture: the native messaging host waits for the files.
- **Brave reads native messaging hosts only from `HKCU\Software\Google\Chrome\NativeMessagingHosts`**, not from its own `BraveSoftware\Brave-Browser` key. Chrome for Testing reads the Chrome key too. Setup writes the Chrome, Edge and Brave keys anyway.
- **A host can send at most 1 MB per message.** The host sends 512 KiB chunks (about 700 KB as base64) and stays at most 8 MiB ahead of the page's progress reports. The page stores each chunk as its own `Blob`, so Chrome can keep large recordings on disk. Measured: a PNG reaches the preview in about 150 ms, and 200 MB transfers at about 120 MB/s.
- **Unpacked extension IDs come from the folder path:** the first 32 hex digits of SHA-256 of the UTF-16 path, written with the letters a to p. `desktop/browsers.js` also reads each profile's `Secure Preferences` to find the browsers and profiles that have SnapStitch loaded from this folder.
- Session restore reopens `?desktop=` tabs, which import again if the capture folder still exists. Once imported, the tab's address becomes `?id=`.

## Capture

- **`desktopCapturer` thumbnails are exact screenshots.** At the monitor's native size they match a GDI `BitBlt` of the same screen pixel for pixel, and they don't include the pointer. A thumbnail is scaled to fit the requested size, so `capture.js` asks once per distinct monitor size. A grab takes roughly 0.1 s per screen.
- **Video frames from screen capture are I420 (YUV 4:2:0)** and include the pointer. They're fine for recordings and wrong for screenshots.
- **`BrowserWindow.setContentProtection(true)` removes a window from every capture** on Windows 10 2004 and later, including `desktopCapturer` thumbnails, the video stream and GDI. The overlays, the outline and the Stop bar use it. A consequence: no capture API can see them, so check their position by eye. The outline still sits 6 px outside the area, in case protection isn't available.
- Screen recording asks for the `display-capture` permission, not `media`. `main.js` grants only that, and only to the app's own pages.
- Electron's `MediaRecorder` supports `video/mp4;codecs=avc1`. With the CPU-backed canvas from `src/rec-core.js`, the output is tagged BT.709 / sRGB, the same as in Chrome.
- The `PrtSc` combinations register with `globalShortcut` unless another tool holds them, such as Windows' "Use the Print screen key to open screen snipping" setting, OneDrive or ShareX. The app then shows a notification and keeps working from the tray.

## Running Electron

- **`ELECTRON_RUN_AS_NODE=1` in the environment turns `electron.exe` into plain Node.** VS Code sets it for its child processes, and the native host launcher (`host.cmd`, written by `setup.js`) relies on it. The app removes it, and `CHROME_CRASHPAD_PIPE_NAME`, from the environment of the browser it launches. If you start the app from a tool that sets it, unset it first.
- `electron <folder>` needs a `package.json` (or an `index.js`) in that folder. A folder that has only `main.js` silently does nothing.
- npm 11 may skip Electron's postinstall step, which downloads the binary. In that case run `node node_modules/electron/install.js`.
- Pages load from a privileged `snapstitch://app/` scheme mapped onto the repository (only `desktop/`, `src/` and `icons/`). That lets `desktop/recorder.js` import `../src/rec-core.js` and its module workers without a build step.
- Idle, the app uses about 230 MB of private memory: the main process, GPU process and 4 pre-created windows (three overlays and the popup) at about 25 MB each.

## Packaging (`npm run dist`)

- electron-builder makes a one-click, per-user NSIS installer. The `appId`, `com.snapstitch.desktop`, is also the AppUserModelID that `main.js` sets. Windows matches the two for notifications, the jump list and the pinned taskbar button.
- **asar is off on purpose.** The browser starts the native host as `SnapStitch Desktop.exe` in Run As Node mode, through `%LOCALAPPDATA%\SnapStitch\host\host.cmd`. `setup.js` writes that file at run time with this executable's path, so one code path covers `npm start` (electron.exe) and the installed app. Keep Electron's `RunAsNode` fuse on.
- The files shared with the extension (`src/rec-core.js`, the GIF worker, `popup.css`, `icons/`) are copied into `resources/` (`extraResources`). `main.js` serves them from there when packaged, and from the repo otherwise.
- An installed app can't know where the extension's folder is, so `browsers.js` recognizes SnapStitch in each profile by its manifest (name plus homepage), not by path.
- Uninstalling runs `build/installer.nsh`. It removes the host registry keys, the startup entry (the `Run` value is named after the appId) and `%LOCALAPPDATA%\SnapStitch`, except during an upgrade (`${isUpdated}`), so "Start with Windows" survives updates.
- The app asks once, on its first visible start, whether to start with Windows. It never turns that on by itself.
