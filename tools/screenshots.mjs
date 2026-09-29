// Turns raw screen captures into the exact size Adobe wants for listing screenshots.
//
// Adobe recommends 1360x800 PNG or JPG. A Mac screen capture is never that: it is
// whatever the window happened to be, doubled on a Retina display. This scales each
// capture to fit and pads it out to the exact size.
//
// The padding matters. sips' own --padToHeightWidth silently CROPS when the image is
// larger than the target, so scaling has to happen first and has to fit BOTH sides --
// --resampleHeightWidthMax only constrains the longer one, which leaves a wide capture
// too tall and hands the crop back to sips. That cost 50px off the bottom of a test
// image before this was caught.
//
// It also strips the DEVELOPER MODE badge and the window focus border, which every
// capture of an unpublished add-on picks up. See tools/lib/clean-capture.mjs.
//
// Put captures in listing/screenshots/raw/ and run: npm run screenshots

import { execFileSync } from "node:child_process";
import { readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { clean } from "./lib/clean-capture.mjs";

const W = 1360;
const H = 800;
const PAD = (process.argv.find(a => a.startsWith("--pad=")) ?? "--pad=FFFFFF").split("=")[1];

const root = fileURLToPath(new URL("..", import.meta.url));
const rawDir = join(root, "listing/screenshots/raw");
const outDir = join(root, "listing/screenshots");

const sips = (...args) => execFileSync("sips", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function size(file) {
    const out = sips("-g", "pixelWidth", "-g", "pixelHeight", file);
    return {
        w: Number(out.match(/pixelWidth:\s*(\d+)/)[1]),
        h: Number(out.match(/pixelHeight:\s*(\d+)/)[1])
    };
}

if (!existsSync(rawDir)) {
    mkdirSync(rawDir, { recursive: true });
    console.log(`\n  Created ${rawDir.replace(root, "")}\n\n  Put your captures there and run this again.`);
    console.log(`  See listing/SCREENSHOTS.md for what each one should show.\n`);
    process.exit(0);
}

const files = readdirSync(rawDir).filter(f => /\.(png|jpe?g)$/i.test(f)).sort();
if (files.length === 0) {
    console.log(`\n  Nothing in listing/screenshots/raw/ yet.\n  See listing/SCREENSHOTS.md for what each one should show.\n`);
    process.exit(0);
}

console.log(`\n  Target ${W}x${H}, padding #${PAD}\n`);
let warnings = 0;

for (const name of files) {
    const out = join(outDir, name.replace(/\.jpe?g$/i, ".png"));
    copyFileSync(join(rawDir, name), out);

    const raw = size(out);
    // Fit inside the target: whichever side runs out first decides the scale.
    const scale = Math.min(W / raw.w, H / raw.h);
    // A capture smaller than the target on both sides is left at its own resolution and
    // padded up to size. Blowing it up to fill the frame only invents pixels: the file
    // would be the same 1360x800 either way, but softer. Padding is white, and the panel
    // sits on white, so the seam does not read as a border.
    if (scale >= 1) {
        // nothing to resample
    } else if (raw.w / raw.h > W / H) {
        sips("--resampleWidth", String(W), out);
    } else {
        sips("--resampleHeight", String(H), out);
    }

    const fitted = size(out);
    sips("--padToHeightWidth", String(H), String(W), "--padColor", PAD, out);

    // Capturing an unpublished add-on always catches the DEVELOPER MODE badge, and
    // often the window's focus border. Neither belongs in a store listing.
    const removed = clean(out);

    const final = size(out);
    const bars = final.w - fitted.w + (final.h - fitted.h);
    const barPct = Math.round((bars / (final.w - fitted.w > 0 ? W : H)) * 100);

    const notes = [];
    if (scale > 1) { notes.push(`padded, not upscaled - captured ${raw.w}x${raw.h}, smaller than the target`); }
    if (barPct > 15) { notes.push(`${barPct}% padding - recapture closer to 17:10`); warnings++; }
    if (final.w !== W || final.h !== H) { notes.push(`WRONG SIZE ${final.w}x${final.h}`); warnings++; }

    const cleaned = [];
    if (removed.badge) cleaned.push(`badge ${removed.badge.w}x${removed.badge.h}`);
    if (removed.borderRows) cleaned.push(`${removed.borderRows} border rows`);
    const scrubbed = cleaned.length ? `  removed ${cleaned.join(" + ")}` : "";

    const tag = notes.length ? `  <- ${notes.join("; ")}` : "";
    console.log(`  ${name.padEnd(28)} ${String(raw.w).padStart(5)}x${String(raw.h).padEnd(5)} -> ${final.w}x${final.h}${scrubbed}${tag}`);
}

console.log(
    warnings === 0
        ? `\n  ${files.length} ready in listing/screenshots/. Upload these, not the raw ones.\n`
        : `\n  ${files.length} written, ${warnings} worth a second look before uploading.\n`
);
