// Stands in for the Adobe Express SDK so the built panel can be driven outside Express.
// Every sandbox method answers with a fixed, plausible value; the point is to exercise
// the panel's own code, not Express.

export const RuntimeType = { documentSandbox: "documentSandbox", panel: "panel" };
export const AppEvent = { themechange: "themechange" };

const called = [];
window.__called = called;

const font = (postscriptName, family, style) => ({ postscriptName, family, style });
const answers = (name, value) => (...args) => {
    called.push(name);
    return Promise.resolve(typeof value === "function" ? value(...args) : value);
};

const sandbox = {
    build: answers("build", () => window.__BUILD),
    describeSelection: answers("describeSelection", () => window.__selection),
    auditPage: answers("auditPage", {
        colors: [{ hex: "#FF0000", count: 3, usedBy: ["fill"], nearestBrandHex: "#2F6F4F", distance: 40, onBrand: false }],
        scanned: 9
    }),
    fixOffBrandColors: answers("fixOffBrandColors", 3),
    applyColorToSelection: answers("applyColorToSelection", 2),
    addPaletteToPage: answers("addPaletteToPage", undefined),
    getAvailableFonts: answers("getAvailableFonts", names =>
        names.map(n => font(n, n.split("-")[0], n.split("-")[1] || "Regular"))
    ),
    getSelectionFont: answers("getSelectionFont", font("Montserrat-Bold", "Montserrat", "Bold")),
    loadFont: answers("loadFont", true),
    applyFontToSelection: answers("applyFontToSelection", { changed: 1, selected: 1, textFound: 1, locked: 0 }),
    auditFonts: answers("auditFonts", [{ postscriptName: "Arial", family: "Arial", style: "Regular", count: 2, onBrand: false }]),
    fixOffBrandFonts: answers("fixOffBrandFonts", 2),
    addTextToPage: answers("addTextToPage", undefined),
    replaceSelectedText: answers("replaceSelectedText", true)
};

const savedKit = {
    palette: [{ role: "Primary", hex: "#2F6F4F" }, { role: "Secondary", hex: "#FD7933" }],
    logo: null,
    base: "#2F6F4F",
    harmony: "complementary",
    tolerance: 8,
    fonts: { heading: font("Montserrat-Bold", "Montserrat", "Bold"), body: font("Lato-Regular", "Lato", "Regular") }
};

export default {
    ready: Promise.resolve(),
    instance: {
        runtime: { apiProxy: async () => sandbox },
        clientStorage: {
            // SMOKE_NO_KIT drives the first-run screens, which a saved kit skips past.
            getItem: async () => (globalThis.SMOKE_NO_KIT ? null : savedKit),
            setItem: async () => {}
        }
    },
    app: {
        document: { addImage: async () => {} },
        // The panel reads the theme once at startup and then listens. SMOKE_THEME lets a
        // run drive the panel in either theme without a real Express.
        ui: { theme: globalThis.SMOKE_THEME || "light" },
        on: () => {}
    }
};
