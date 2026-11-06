# Chrome behaviors SnapStitch depends on

The code relies on these Chrome behaviors. Each one was found by a spike or an end-to-end test, on Chrome 156. If you change the capture or recording code, read this first.

## Screenshots

- **Scroll offsets snap to device pixels.** `scrollY` reports the exact fractional value: at 150% scaling, scrolling to 805 gives 805.333. Do stitching math in device pixels starting from `round(scrollY * scale)`. Don't get sizes by rounding sums of fractional CSS pixels, because float32 noise causes off-by-one rows.
- `captureVisibleTab` is limited to 2 calls per second, so whole-page capture waits at least 550 ms between calls.

## Recording

- **Tab capture constraints.** A large `maxWidth`/`maxHeight` makes Chrome scale frames *up* to that size (4096×4096 with `resizeMode: crop-and-scale`). Request roughly the device size, then call `track.applyConstraints({ resizeMode: 'none' })` to get native frames.
- **When the viewport's device height is odd, Chrome still scales the whole frame slightly**, because frames must have even dimensions. A 1264×765 viewport arrives as 1264×764 with all content scaled by 764/765, so content drifts by about 1 px per 800 px from the top-left corner. Crops are off by at most a pixel or two, which is fine. But any in-page UI drawn right next to the crop will bleed into it. Keep such UI at least 4 CSS px outside the crop (`src/rec-ui.js`). The e2e area test checks every edge pixel of every GIF frame for this.
- **Tab capture sends frames only when the page changes.** A static page produces a single frame. Anything drawn on top, like the cursor, needs its own clock to produce frames. That's why `src/ticker.js` exists.
- **Use a CPU-backed canvas for frames sent to MediaRecorder** (`willReadFrequently: true`). Frames from a GPU-backed canvas are converted RGB→YUV with BT.601 but aren't tagged with a color space, so players decode them as BT.709 and saturated colors shift (230,25,75 comes out as 246,48,73). With a CPU canvas the output is tagged (`colr` box) and the colors are exact.
- **MediaRecorder on a generator track times frames by when they arrive** and ignores `VideoFrame.timestamp`. It drops frames that arrive while the encoder is busy, and drops whatever is still being encoded when recording ends. To keep the final frame, emit it, wait about 100 ms, emit a throwaway duplicate, then end the track. You can check the result with an MP4 box dump: the `trun` sample durations show every frame that was kept.
- Chrome's MP4 MediaRecorder output is a fragmented MP4 with a correct `mvhd` duration. It plays and seeks normally.
- Tab-capture frames are YUV 4:2:0, so exact pixel comparisons don't work on them. Use tolerances or edge tests instead.

## Shortcuts

- **Chrome reserves Alt+Shift+R, C, W, X and Z.** If an extension suggests one of them, Chrome leaves the command unassigned without any warning. After installing, check `chrome.commands.getAll()` instead of assuming a key is free.
