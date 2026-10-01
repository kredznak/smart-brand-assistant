// Drives the built panel in a headless browser with a stand-in for the Express SDK,
// and fails if any action stops reporting what it did.
//
// This exists because the panel's real faults have been runtime ones that a type check
// cannot see: a selection read at the wrong moment, a proxy that swallowed toString,
// an Express API that throws unless a manifest flag is set. Every one of them showed up
// as a button that quietly did nothing.
//
// Run with: npm run smoke   (after npm run build)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 8129;

const EXPECTED = [
    ["Primary", /^Applied #/],
    ["Add palette to page", /^Palette added/],
    ["Apply to selection", /^Applied .+ to 1 text item/],
    ["Use selected text's font", /set as your heading font/],
    ["Scan fonts on this page", /off-brand font/],
    ["Fix 1 off-brand font", /^Updated/],
    ["Scan colors on this page", /off-brand color/],
    ["Fix 1 off-brand color", /^Updated/],
    // An unsupported file must be named and refused, leaving no preview to break.
    ["Reject a TIFF", /^TIFF files are not supported\./],
    ["Accept a PNG", /^preview shown: \(no message\)$/]
];

const CHROME =
    process.env.CHROME ??
    ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(
        p => existsSync(p)
    );

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

if (!existsSync(join(root, "dist/index.js"))) {
    console.error("dist/index.js is missing. Run `npm run build` first.");
    process.exit(1);
}
if (!CHROME) {
    console.error("No Chrome found. Set CHROME to its path.");
    process.exit(1);
}

const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(root, path === "/" ? "tools/smoke/page.html" : path);
    try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
        res.end(body);
    } catch {
        res.writeHead(404).end("not found");
    }
});

await new Promise(resolve => server.listen(PORT, resolve));

const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--virtual-time-budget=25000",
    "--dump-dom",
    `http://localhost:${PORT}/`
]);

let dom = "";
chrome.stdout.on("data", chunk => (dom += chunk));
const code = await new Promise(resolve => chrome.on("close", resolve));
server.close();

const payload = dom.match(/@@(\{.*\})@@/s);
if (!payload) {
    console.error(`The panel never reported a result (chrome exited ${code}).`);
    process.exit(1);
}

const result = JSON.parse(payload[1]);
const byLabel = new Map(result.steps);
let failed = 0;

if (!result.mounted) {
    console.error("FAIL  the panel never rendered");
    failed++;
}
for (const [label, pattern] of EXPECTED) {
    const message = byLabel.get(label) ?? "(not attempted)";
    const ok = pattern.test(message);
    console.log(`${ok ? "pass" : "FAIL"}  ${label.padEnd(28)} ${message}`);
    if (!ok) failed++;
}
for (const error of result.errors) {
    console.error(`FAIL  uncaught: ${error}`);
    failed++;
}

console.log(`\n${result.called.length} sandbox methods exercised`);
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
