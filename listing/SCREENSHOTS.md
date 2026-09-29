# Capturing the listing screenshots

Adobe needs at least one promotional image and recommends **1360 x 800**, PNG or JPG.
Five are planned; the shot list is in [`LISTING.md`](LISTING.md).

Capture at whatever size is convenient, drop the files in `listing/screenshots/raw/`,
and run:

```bash
npm run screenshots
```

Each one is scaled to fit and padded out to exactly 1360 x 800 in `listing/screenshots/`.
Upload those, never the raw ones. The tool warns when a capture was too small (it will
look soft) or too far from 17:10 (it will sit in thick bars).

---

## 1. Set up a demo brand, once

Every shot uses the same document, so this is done once and all five come out consistent.

**Use `listing/demo-brand/bookbit.png` as the brand.** It is an invented mark, so no real
company's logo is being taken apart in a public store listing. Avoid typing a well-known
domain into the website field for the same reason.

Do not use `src/logo.png`, which the earlier version of this guide recommended. It is a
single flat white shape on transparency, so the extractor finds exactly one near-white
color: the palette comes out grey, the AI font pairing is judging a blank mark, and the
audit has nothing meaningful to compare against. Three of the five shots would be wasted.

1. Open a new Express document, something wide like a presentation or a social banner.
2. Open the add-on, choose **Upload a logo**, and pick `listing/demo-brand/bookbit.png`.
3. Let it analyse. You now have a palette and the Colors tab is showing.

The palette that comes out is known, because the extractor was run against this file:

| Role | Color | Share of the logo |
| --- | --- | --- |
| Primary | `#DF604E` coral | 16.2% |
| Secondary | `#63B89A` green | 4.5% |
| Accent | `#292032` near-black | 77.6% |

Worth noticing in shot 2: the dark hexagon is 77.6% of the logo and still ranks third,
because at 22% saturation it reads as neutral and the most colorful candidate leads.

## 2. Build a page worth photographing

An empty canvas makes a poor screenshot and makes shot 4 impossible.

Put together something that looks like real work — a few headings, a paragraph, two or
three shapes, maybe an image. Then, deliberately:

- **Give three shapes these colors**, which were chosen by measuring them against the
  palette above. One maps to each brand color, at a spread of distances, so the audit
  shows both an obvious catch and a subtle one:

  | Use this | It is | The audit will say it becomes | Distance |
  | --- | --- | --- | --- |
  | `#F5A623` | warm amber | `#DF604E` Primary | 49.9 — obviously wrong |
  | `#4A7FD4` | a stock blue | `#292032` Accent | 55.2 — the commonest real mistake |
  | `#1ABC9C` | turquoise | `#63B89A` Secondary | 13.4 — close enough to miss by eye |

- Set **one text item to a font that is not your brand font**, so the Fonts tab scan has
  something to report.

Shot 4 is the one that fails without this. It is worth doing first.

### Two colors you will see flagged whether you plan for them or not

The scan walks the artboard itself, not just what you put on it
(`pageRoots()` in `src/sandbox/code.ts` returns `currentPage.artboards`, and each
artboard's own fill is read). With a three-color palette holding no neutral:

- **The white background is flagged**, 45.9 away, and its nearest brand color is the
  green. Pressing **Fix** turns the page green. Capture the audit list, which is what
  shot 4 is for, rather than pressing Fix and hoping.
- **Default black text is flagged**, 19.5 away, and becomes `#292032`. That one is
  harmless and arguably right, since `#292032` is the brand's near-black.

Neither is a bug. A palette with no neutral in it has nothing better to offer. Keep white
shapes off the page so the audit list stays short and readable in a screenshot.

## 3. Size the window

1360 x 800 is 17:10, which no browser window is by default, so captures end up in bars.
Setting the window first means almost no padding. With Express open in front:

```bash
osascript -e 'tell application "Google Chrome" to set bounds of front window to {100, 100, 1460, 900}'
```

For Safari, swap the application name. On a Retina display this captures at 2720 x 1600,
which scales down to exactly 1360 x 800 with no padding at all.

Then capture the window with **Cmd+Shift+4, then Space**, and click the window.

## 4. Take the five

Name them so they sort into the order they should appear in the listing:

| File | Screen | Make sure this is visible |
| --- | --- | --- |
| `1-upload.png` | Upload screen | Both halves: the logo picker **and** the website field. This is the first thing a new user sees. |
| `2-colors.png` | Colors tab | The palette, the harmony dropdown, and the shape on canvas that just took a color. |
| `3-fonts.png` | Fonts tab | Heading and body fonts, a pairing suggestion, and canvas text set in that font. |
| `4-audit.png` | Audit tab | A finished scan: off-brand swatches listed, each showing the brand color it would become, and the fix button. |
| `5-copy.png` | Copy tab | Generated headlines next to the document they were written for. |

Show the whole Express window with the panel open, not the panel cropped out on its own.
The guidelines ask that screenshots represent the add-on's real functionality and
appearance, and a floating panel with no canvas shows neither.

## 5. Check before you upload

- **Nothing personal in frame** — these go in a public store. No email address in the
  Express avatar menu, no bookmarks bar, no other tabs with readable titles, no
  notifications. Hide the bookmarks bar with Cmd+Shift+B.
- **No other company's brand** — no third-party logo on the canvas, no recognisable
  domain in the website field.
- **The status line reads sensibly.** It sits under the tabs and says what just happened
  ("Applied #635BFF to 1 item"). A screenshot showing an error, or "nothing selected",
  reads as broken.
- **Run `npm run screenshots` and read the warnings**, then open the results at full size
  and check nothing important sits in the padding.

## What the tool takes out, besides padding

Two things end up in every capture that a user of the published add-on would never
see, so `npm run screenshots` removes them on the way through:

- **The DEVELOPER MODE badge**, a blue chip in the middle of the Express toolbar. It is
  on screen because add-on testing has to be enabled to run an unpublished add-on at
  all, which is why it cannot simply be avoided while capturing.
- **The window focus border**, a few pixels of blue along one edge of the window.

Both are flat color on flat color. The badge is repainted by sampling the toolbar
either side of it, row by row rather than once, so the fill follows the bar -- which
matters because the badge can sit flush against the top of the capture, where the rows
above it are white padding and have to stay white. The Share button is blue too, and is
left alone: the badge is picked out as the blue cluster nearest the middle of the bar.

Nothing about the add-on's own interface is altered, and the files in `raw/` are never
written to, so they stay as evidence of what was actually on screen. The code is in
[`tools/lib/clean-capture.mjs`](../tools/lib/clean-capture.mjs).

That gap is closed: the set was recaptured in light mode on 28 September 2026 after Adobe
asked the panel to follow the Express theme, so all five raws exist again, including the
`3. fonts.png` that had been lost.

`raw/` is gitignored, which is how the old one went missing in the first place. The
captures are only ever on disk, so keep a copy somewhere outside `raw/` until the listing
is accepted -- a capture is a few minutes of setting up a document, not a few seconds.

These five were captured at 1240x715 against a 1360x800 target, so the tool upscaled them
1.10x and said so. That is mild enough to ship. To avoid it, capture the window with
Cmd+Shift+4 then Space on a Retina display: the result is 2x and downscales cleanly.

## Why the tool exists

`sips --padToHeightWidth` crops instead of padding when the image is bigger than the
target, and `--resampleHeightWidthMax` only constrains the longer side — so the obvious
two-command version scales a wide capture to 1360 wide, leaves it 850 tall, and then
quietly loses 50 pixels off it. The tool computes the scale against both sides first.
