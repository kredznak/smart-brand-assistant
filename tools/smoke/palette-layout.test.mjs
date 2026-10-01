// Checks that "Add palette to page" lands the whole palette inside the page.
//
// The browser pass cannot see this: its stand-in sandbox answers addPaletteToPage with
// undefined, so the panel reports success without any geometry being worked out at all.
// The first release shipped a fixed row over 700px wide placed at x=40, which ran off the
// edge of any page narrower than that, and Adobe's review found it.
//
// Run with: node tools/smoke/palette-layout.test.mjs

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const out = mkdtempSync(join(tmpdir(), "palette-"));

try {
    execFileSync(join(root, "node_modules/.bin/tsc"), [
        join(root, "src/shared/paletteLayout.ts"),
        "--outDir", out,
        "--module", "esnext",
        "--target", "es2020",
        "--moduleResolution", "bundler",
        "--skipLibCheck"
    ], { stdio: "pipe" });
} catch {
    // tsc reports unrelated errors in ambient typings under node_modules and exits
    // non-zero even when it has written the file, so the emitted file is the real test.
}

const { paletteLayout, swatchCenter, SWATCH_MAX_SIZE } = await import(pathToFileURL(join(out, "paletteLayout.js")).href);

// Real Express page sizes, then sizes small enough to break a fixed-width row, then
// shapes that are only here to prove the arithmetic cannot produce a nonsense answer.
const PAGES = [
    [1080, 1080, "square social post"],
    [1080, 1920, "story"],
    [1920, 1080, "presentation"],
    [816, 1056, "US Letter flyer"],
    [1050, 600, "card"],
    [500, 500, "small square"],
    [320, 240, "narrow"],
    [120, 120, "tiny"],
    [40, 4000, "a sliver"],
    [4000, 40, "a strip"]
];

let failed = 0;
const check = (ok, what) => {
    if (!ok) {
        console.error(`FAIL  ${what}`);
        failed++;
    }
};

for (const [width, height, name] of PAGES) {
    for (let count = 1; count <= 5; count++) {
        const l = paletteLayout(count, width, height);
        const where = `${name} ${width}x${height}, ${count} swatch${count === 1 ? "" : "es"}`;
        const right = l.left + l.size * count + l.gap * (count - 1);

        for (const [key, value] of Object.entries(l)) {
            check(Number.isFinite(value), `${where}: ${key} is ${value}`);
        }
        check(l.size > 0, `${where}: swatches have no size (${l.size})`);
        check(l.gap >= 0, `${where}: negative gap (${l.gap})`);
        check(l.left >= 0, `${where}: row starts off the left edge (${l.left})`);
        check(l.top >= 0, `${where}: row starts above the top edge (${l.top})`);
        check(right <= width + 1e-9, `${where}: row ends ${right - width} past the right edge`);
        check(l.top + l.size <= height + 1e-9, `${where}: row ends ${l.top + l.size - height} past the bottom edge`);
        check(l.radius * 2 <= l.size + 1e-9, `${where}: corner radius ${l.radius} too big for a ${l.size} swatch`);

        // Every label is centred in its own swatch, which is what keeps it legible: the
        // text colour is chosen for the swatch behind it, so a label that drifts onto the
        // page becomes white text on a white background.
        for (let i = 0; i < count; i++) {
            const c = swatchCenter(l, i);
            const swatchLeft = l.left + i * (l.size + l.gap);
            check(
                Math.abs(c.x - (swatchLeft + l.size / 2)) < 1e-9 && Math.abs(c.y - (l.top + l.size / 2)) < 1e-9,
                `${where}: label ${i} is not centred in its swatch`
            );
            check(
                c.x >= 0 && c.x <= width && c.y >= 0 && c.y <= height,
                `${where}: label ${i} centres outside the page at ${c.x},${c.y}`
            );
        }
        check(l.fontSize > 0, `${where}: font size ${l.fontSize}`);
    }
}

// On a page with room to spare the swatches should still be their full size, not shrunk
// to fit something they already fit: a bounds check alone would pass a palette of dots.
const roomy = paletteLayout(5, 1080, 1080);
check(roomy.size === SWATCH_MAX_SIZE, `a 1080x1080 page should take full-size swatches, got ${roomy.size}`);
check(roomy.fontSize === 14, `full-size swatches should take the full label size, got ${roomy.fontSize}`);

// Centred, so the palette reads as placed rather than dropped in a corner.
const centred = paletteLayout(5, 1080, 1080);
const slack = 1080 - (centred.left + centred.size * 5 + centred.gap * 4);
check(Math.abs(centred.left - slack) < 1e-9, `row is not centred: ${centred.left} left, ${slack} right`);

// The case Adobe reported: a page narrower than the old fixed row.
const narrow = paletteLayout(5, 600, 400);
check(narrow.size < SWATCH_MAX_SIZE, "a 600px page should shrink the swatches to fit");

console.log(`checked ${PAGES.length * 5} palette layouts across ${PAGES.length} page sizes`);
if (failed === 0) {
    console.log("pass  every palette sits inside the page");
    process.exit(0);
}
console.error(`\n${failed} failed`);
process.exit(1);
