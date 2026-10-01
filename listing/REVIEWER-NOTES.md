# Notes to reviewer

Paste into the "Notes to reviewer" field when submitting. Attach `demo-brand/bookbit.png` as the sample logo.

---

Smart Brand Stylist needs no account, sign-in or credentials. All AI features work out of the box.

Suggested test (about 5 minutes):

1. Open the add-on. On the start screen choose a logo file (the attached bookbit.png, or any PNG with a few solid colors) and click Analyze brand. Or type a website such as adobe.com and click Analyze brand.
2. On the results screen confirm the palette. The Colors tab opens with the extracted colors.
3. Draw a rectangle on the canvas, select it, and click a swatch in the panel: the rectangle takes that color. Click Add palette to page to place labelled swatches.
4. Fonts tab: click a pairing (for example Clean). Add a text box, select it, click Apply to selection under Heading font.
5. Copy tab: brand name "Bookbit", description "cozy neighborhood coffee house in Brooklyn serving small-batch roasted coffee and house-made pastries", tone Friendly, write a Tagline, click Suggest copy. Click Add to page on any suggestion.
6. Audit tab: add a shape in a random color, click Scan colors on this page, then Fix off-brand colors. Cmd/Ctrl+Z undoes it.

Fixed since 1.0.1, if you would like to retest the two issues directly:

- Unsupported file formats. Choosing a .tiff (or any other format we do not read) now
  refuses the file and says so — "TIFF files are not supported. Choose a PNG, JPG, SVG or
  WebP." — and no preview is shown. A file that claims a supported format but cannot be
  decoded is refused the same way.
- Add palette to page. The swatch row is now measured against the page and placed inside
  it: the swatches and gaps shrink to fit a narrow page, the row is centred, and it goes
  onto the artboard rather than into whatever the current selection makes the insertion
  parent, which could previously be a group positioned off the canvas. Worth trying on a
  small or unusually shaped page as well as a standard one. Text added from the Copy tab
  is now placed the same way.

Notes: logo color extraction runs entirely in the browser. AI requests go to our Cloudflare Worker, which calls Anthropic; the server keeps no user data and applies a per-user daily limit. Privacy policy, terms and help are linked in the listing.
