import { settleSelection } from "../selection";
import React, { useEffect, useRef, useState } from "react";
import { BrandColor, generatePalette, Harmony, HARMONIES, normalizeHex, readableTextOn, toBrandColors } from "../../shared/color";
import { AuditResult, BrandFonts, SandboxProxy } from "../../shared/DocumentSandboxApi";
import { BUILD } from "../../shared/build";
import { analyzeSite } from "../api";
import { analyzeLogo, dataUrlToBlob } from "../extractColors";
import { catalogNamesForFamilies } from "../fontCatalog";
import CopyTab, { BrandVoice } from "./CopyTab";
import FontsTab from "./FontsTab";
import "./App.css";

import { AddOnSDKAPI } from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";

const STORAGE_KEY = "brandKit";
/** How far a colorful candidate outranks a neutral one when reading a web page. */
const SITE_VIVID_BOOST = 4;
const DEFAULT_BASE = "#5258E4";

interface SavedKit {
    palette: BrandColor[];
    logo: string | null; // small PNG data URL
    base: string;
    harmony: Harmony;
    tolerance: number;
    fonts?: BrandFonts;
    voice?: BrandVoice;
}

interface Draft {
    palette: BrandColor[];
    logo: string | null;
    /** CSS families the site used, most prominent first. Empty when read from a logo. */
    fonts: string[];
    /** Where this came from, shown on the results screen. */
    source: string;
}

type Step = "loading" | "onboarding" | "upload" | "results" | "kit";
type Tab = "kit" | "fonts" | "copy" | "audit";

// Copy written for the last logo has nothing to do with the next one, so the voice is
// cleared wherever a new brand starts. Left alone it quietly produces suggestions for a
// brand the user has already moved on from.
const EMPTY_VOICE: BrandVoice = { brandName: "", description: "", tone: "Friendly" };

// The file picker's `accept` list is only the default filter: on every platform the user
// can switch it to all files and choose anything, so whatever comes back is checked here
// too. Without this a TIFF reaches the preview, which cannot decode it and shows a broken
// image instead of saying what is wrong.
const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const LOGO_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg", ".webp"];
const LOGO_FORMATS = "Choose a PNG, JPG, SVG or WebP.";

/** Null if the file is a logo this add-on can read, otherwise why it cannot. */
function unsupportedLogo(file: File): string | null {
    const dot = file.name.lastIndexOf(".");
    const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : "";
    if (LOGO_TYPES.includes(file.type)) return null;
    // Some systems report no type at all, SVG especially, so the name decides those.
    if (!file.type && LOGO_EXTENSIONS.includes(extension)) return null;
    const named = extension ? `${extension.slice(1).toUpperCase()} files are not supported.` : "That file is not an image we can read.";
    return `${named} ${LOGO_FORMATS}`;
}

const TABS: { id: Tab; label: string }[] = [
    { id: "kit", label: "Colors" },
    { id: "fonts", label: "Fonts" },
    { id: "copy", label: "Copy" },
    { id: "audit", label: "Audit" }
];

const App = ({ addOnUISdk, sandboxProxy }: { addOnUISdk: AddOnSDKAPI; sandboxProxy: SandboxProxy }) => {
    const [step, setStep] = useState<Step>("loading");
    const [tab, setTab] = useState<Tab>("kit");
    const [palette, setPalette] = useState<BrandColor[]>([]);
    const [logo, setLogo] = useState<string | null>(null);
    const [base, setBase] = useState(DEFAULT_BASE);
    const [harmony, setHarmony] = useState<Harmony>("complementary");
    const [tolerance, setTolerance] = useState(8);
    const [brandFonts, setBrandFonts] = useState<BrandFonts>({ heading: null, body: null });
    const [voice, setVoice] = useState<BrandVoice>(EMPTY_VOICE);
    const [brandGeneration, setBrandGeneration] = useState(0);
    const [audit, setAudit] = useState<AuditResult | null>(null);
    const [status, setStatus] = useState("");

    // Upload flow
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [siteUrl, setSiteUrl] = useState("");
    const fileInput = useRef<HTMLInputElement>(null);

    const store = addOnUISdk.instance.clientStorage;
    const paletteHex = palette.map(c => c.hex);

    // While developing, reloading the panel does not always reload the document sandbox,
    // and an old sandbox answering a new panel produces confusing, wrong messages.
    const [staleSandbox, setStaleSandbox] = useState(false);
    useEffect(() => {
        sandboxProxy
            .build()
            .then(build => setStaleSandbox(build !== BUILD))
            .catch(() => setStaleSandbox(true)); // an older sandbox has no build() at all
    }, []);

    // What Express currently reports as selected, shown live, so it is clear before an
    // "apply to selection" button is pressed whether it will find anything.
    const [selectionInfo, setSelectionInfo] = useState<{ selected: number; locked: number; text: number } | null>(null);
    useEffect(() => {
        if (step !== "kit") return;
        let cancelled = false;
        const poll = () =>
            // Nothing can be selected or acted on while the panel is hidden, so the
            // twice-a-second round trip into Express is pure waste until it is back.
            document.hidden
                ? undefined
                : sandboxProxy
                .describeSelection()
                .then(info => {
                    if (!cancelled) setSelectionInfo(info);
                })
                .catch(() => undefined);
        poll();
        const timer = setInterval(poll, 500);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [step]);

    // Returning users go straight to their saved kit.
    useEffect(() => {
        store
            .getItem(STORAGE_KEY)
            .then(saved => {
                const kit = saved as SavedKit | undefined;
                if (kit && Array.isArray(kit.palette) && kit.palette.length > 0) {
                    setPalette(kit.palette);
                    setLogo(kit.logo ?? null);
                    setBase(kit.base ?? DEFAULT_BASE);
                    setHarmony(kit.harmony ?? "complementary");
                    setTolerance(kit.tolerance ?? 8);
                    if (kit.fonts) setBrandFonts(kit.fonts);
                    if (kit.voice) setVoice(kit.voice);
                    setStep("kit");
                } else {
                    setStep("onboarding");
                }
            })
            .catch(() => setStep("onboarding"));
    }, []);

    useEffect(() => {
        if (step !== "kit") return;
        const kit: SavedKit = { palette, logo, base, harmony, tolerance, fonts: brandFonts, voice };
        store.setItem(STORAGE_KEY, kit).catch(() => undefined);
    }, [step, palette, logo, base, harmony, tolerance, brandFonts, voice]);

    useEffect(() => {
        if (!file) {
            setPreview(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    async function run(action: () => Promise<string> | string) {
        try {
            setStatus(await action());
        } catch (e) {
            console.error(e);
            setStatus(e instanceof Error ? e.message : "Something went wrong.");
        }
    }

    // --- Upload flow ---------------------------------------------------------------------------

    const analyze = () =>
        run(async () => {
            if (!file) return "Choose a logo file first.";
            setAnalyzing(true);
            try {
                const result = await analyzeLogo(file);
                setDraft({ palette: result.palette, logo: result.thumbnail, fonts: [], source: "your logo" });
                setStep("results");
                return "";
            } finally {
                setAnalyzing(false);
            }
        });

    // The panel is a sandboxed iframe and cannot fetch another origin, so the
    // helper server visits the page and sends back what it found.
    const analyzeUrl = () =>
        run(async () => {
            if (!siteUrl.trim()) return "Enter a website address first.";
            setAnalyzing(true);
            try {
                const site = await analyzeSite(siteUrl.trim());
                const palette = toBrandColors(site.colors, undefined, SITE_VIVID_BOOST);
                if (palette.length === 0) return "No colors could be read from that site.";
                setDraft({
                    palette,
                    logo: site.icon,
                    fonts: site.fonts.map(f => f.family),
                    source: new URL(site.url).hostname.replace(/^www\./, "")
                });
                setStep("results");
                return "";
            } finally {
                setAnalyzing(false);
            }
        });

    const addBrand = () =>
        run(async () => {
            if (!draft) return "";
            setPalette(draft.palette);
            setLogo(draft.logo);
            setAudit(null);

            // A site's fonts are CSS family names, so only those Express also has can be adopted.
            let adopted: string | null = null;
            const candidates = catalogNamesForFamilies(draft.fonts);
            if (candidates.length > 0) {
                const available = await sandboxProxy.getAvailableFonts(candidates).catch(() => []);
                if (available.length > 0) {
                    setBrandFonts({ heading: available[0], body: available[1] ?? available[0] });
                    adopted = available[0].family;
                }
            }

            setDraft(null);
            setFile(null);
            setSiteUrl("");
            forgetPreviousBrand();
            setTab("kit");
            setStep("kit");
            return adopted
                ? `Brand kit saved, with ${adopted} as your heading font.`
                : "Brand kit saved. Click a color to apply it to your selection.";
        });

    // The Copy tab holds its generated suggestions in its own state, and today they happen
    // to die because switching tab unmounts it. Keying it to the generation says so out
    // loud, so copy written for the last logo cannot outlive it if tabs ever stop
    // unmounting — kept mounted for scroll position, say, or all four rendered and hidden.
    function forgetPreviousBrand() {
        setVoice(EMPTY_VOICE);
        setBrandGeneration(n => n + 1);
    }

    function startFromColor() {
        setPalette(generatePalette(base, harmony));
        setLogo(null);
        setAudit(null);
        forgetPreviousBrand();
        setTab("kit");
        setStep("kit");
        setStatus("");
    }

    function newBrand() {
        setFile(null);
        setSiteUrl("");
        setDraft(null);
        forgetPreviousBrand();
        setStatus("");
        setStep("upload");
    }

    // --- Kit tools -----------------------------------------------------------------------------

    function regenerate(nextBase: string, nextHarmony: Harmony) {
        setBase(nextBase);
        setHarmony(nextHarmony);
        setPalette(generatePalette(nextBase, nextHarmony));
        setAudit(null);
    }

    function editSwatch(index: number, value: string) {
        const hex = normalizeHex(value);
        if (!hex) return;
        setPalette(palette.map((c, i) => (i === index ? { ...c, hex } : c)));
        setAudit(null);
    }

    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

    const selectionLabel = (() => {
        if (!selectionInfo) return "";
        if (selectionInfo.text > 0) return `On canvas: ${plural(selectionInfo.text, "text item")} selected`;
        if (selectionInfo.selected > 0) return `On canvas: ${plural(selectionInfo.selected, "item")} selected, none of it text`;
        if (selectionInfo.locked > 0) return "On canvas: the selected item is locked, so it can't be changed";
        return "On canvas: nothing selected";
    })();

    const applyToSelection = (hex: string) =>
        run(async () => {
            await settleSelection(sandboxProxy);
            const changed = await sandboxProxy.applyColorToSelection(hex);
            return changed === 0 ? "Select something on the canvas first." : `Applied ${hex} to ${plural(changed, "item")}.`;
        });

    const addPaletteToPage = () =>
        run(async () => {
            await sandboxProxy.addPaletteToPage(palette);
            return "Palette added to the page.";
        });

    const addLogoToPage = () =>
        run(async () => {
            if (!logo) return "";
            await addOnUISdk.app.document.addImage(dataUrlToBlob(logo));
            return "Logo added to the page.";
        });

    const scan = () =>
        run(async () => {
            const result = await sandboxProxy.auditPage(paletteHex, tolerance);
            setAudit(result);
            const off = result.colors.filter(c => !c.onBrand).length;
            if (result.colors.length === 0) return "No solid colors found on this page.";
            return off === 0 ? "Everything on this page is on brand." : `${plural(off, "off-brand color")} found.`;
        });

    const fix = () =>
        run(async () => {
            const changed = await sandboxProxy.fixOffBrandColors(paletteHex, tolerance);
            setAudit(await sandboxProxy.auditPage(paletteHex, tolerance));
            return changed === 0 ? "Nothing needed changing." : `Updated ${plural(changed, "item")}. Undo with Cmd/Ctrl+Z.`;
        });

    const offBrandCount = audit ? audit.colors.filter(c => !c.onBrand).length : 0;

    // A logo takes precedence when both halves of the upload screen are filled in.
    const canAnalyze = Boolean(file || siteUrl.trim());
    const analyzeBrand = () => (file ? analyze() : analyzeUrl());

    // --- Screens -------------------------------------------------------------------------------

    if (step === "loading") return <div className="screen" />;

    if (step === "onboarding") {
        return (
            <div className="screen">
                <div className="hero">
                    <img className="brandMark" src="logo.png" alt="" />
                    <h1>Smart Brand Stylist</h1>
                    <p>Turn your logo or your website into a brand kit, then keep every design on brand.</p>
                </div>
                <button className="primary" onClick={() => setStep("upload")}>
                    Get started
                </button>
            </div>
        );
    }

    if (step === "upload") {
        return (
            <div className="screen">
                <header>
                    <img className="brandMark small" src="logo.png" alt="" />
                    <h1>Smart Brand Stylist</h1>
                    <p>Start from your logo or your website</p>
                </header>

                <div className="body">
                    {preview && (
                        <div className="logoCard">
                            {/* A file can carry a supported type and still not decode, so the
                                preview failing drops the file rather than leaving a broken image. */}
                            <img
                                src={preview}
                                alt="Logo preview"
                                onError={() => {
                                    setFile(null);
                                    setStatus(`That file could not be read as an image. ${LOGO_FORMATS}`);
                                }}
                            />
                        </div>
                    )}
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        hidden
                        onChange={e => {
                            const chosen = e.target.files?.[0] ?? null;
                            const problem = chosen ? unsupportedLogo(chosen) : null;
                            // Cleared either way, so picking the same file again still fires a change.
                            e.target.value = "";
                            setFile(problem ? null : chosen);
                            setStatus(problem ?? "");
                        }}
                    />
                    <div className="fileRow">
                        <button className="fileButton" onClick={() => fileInput.current?.click()}>
                            Choose file
                        </button>
                        <span className="fileName">{file ? file.name : "No file chosen"}</span>
                    </div>
                    <p className="hint">PNG, JPG, SVG or WebP. Your logo is analyzed on your device and is never uploaded.</p>

                    <div className="or">
                        <span>or</span>
                    </div>

                    <label className="fieldLabel" htmlFor="siteUrl">
                        Use your website
                    </label>
                    <input
                        id="siteUrl"
                        className="text"
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        spellCheck={false}
                        placeholder="yourbrand.com"
                        value={siteUrl}
                        onChange={e => {
                            setSiteUrl(e.target.value);
                            setStatus("");
                        }}
                        onKeyDown={e => {
                            if (e.key === "Enter" && canAnalyze && !analyzing) analyzeBrand();
                        }}
                    />
                    <p className="hint">We read the page's colors and fonts. The address is sent to the AI helper server, which visits the page.</p>

                    <button className="link" onClick={startFromColor}>
                        No logo? Start from a color instead
                    </button>
                </div>

                <p className="status" role="status" aria-live="polite">
                    {status}
                </p>
                <div className="actions">
                    <button className="primary" disabled={!canAnalyze || analyzing} onClick={analyzeBrand}>
                        {analyzing ? "Analyzing…" : "Analyze brand"}
                    </button>
                    {palette.length > 0 && (
                        <button className="ghost" onClick={() => setStep("kit")}>
                            Cancel
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (step === "results" && draft) {
        return (
            <div className="screen">
                <header>
                    <h1>Brand style</h1>
                    <p>Here is what we found in {draft.source}</p>
                </header>

                <div className="body">
                    <div className="logoCard">
                        {draft.logo && <img src={draft.logo} alt={`${draft.source} logo`} />}
                        <div className="resultSwatches">
                            {draft.palette.map(c => (
                                <span key={c.role} className="resultSwatch" style={{ background: c.hex }} title={`${c.role} ${c.hex}`} />
                            ))}
                        </div>
                    </div>
                    <ul className="resultList">
                        {draft.palette.map(c => (
                            <li key={c.role}>
                                <span className="chip" style={{ background: c.hex }} />
                                <span>{c.role}</span>
                                <code>{c.hex}</code>
                            </li>
                        ))}
                    </ul>

                    {draft.fonts.length > 0 && (
                        <>
                            <span className="fieldLabel">Fonts on the site</span>
                            <p className="hint">{draft.fonts.slice(0, 4).join(", ")}</p>
                        </>
                    )}
                </div>

                <div className="actions">
                    <button className="primary" onClick={addBrand}>
                        Save brand kit
                    </button>
                    <button className="ghost" onClick={newBrand}>
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="screen">
            {staleSandbox && (
                <p className="notice" role="alert">
                    Express is still running an older version of this add-on. Reload the whole page (Cmd/Ctrl+R), or
                    reconnect it from the Add-on Development panel.
                </p>
            )}
            <div className="tabs" role="tablist">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        role="tab"
                        aria-selected={tab === t.id}
                        className={tab === t.id ? "tab active" : "tab"}
                        onClick={() => {
                            setTab(t.id);
                            setStatus("");
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <p className="hint selectionHint" aria-live="polite">
                {selectionLabel}
            </p>

            {tab === "kit" && (
                <section>
                    {logo && (
                        <div className="logoCard small">
                            <img src={logo} alt="Brand logo" />
                        </div>
                    )}

                    <p className="hint">Click a color to apply it to whatever is selected on the canvas.</p>
                    <ul className="swatches">
                        {palette.map((c, i) => (
                            <li key={c.role}>
                                <button
                                    className="swatch"
                                    style={{ background: c.hex, color: readableTextOn(c.hex) }}
                                    onClick={() => applyToSelection(c.hex)}
                                    title={`Apply ${c.hex} to selection`}
                                >
                                    {c.role}
                                </button>
                                <input type="text" className="hex" defaultValue={c.hex} key={c.hex} onBlur={e => editSwatch(i, e.target.value)} aria-label={`${c.role} hex`} />
                            </li>
                        ))}
                    </ul>

                    {!logo && (
                        <details open>
                            <summary>Generate from a base color</summary>
                            <div className="row">
                                <input type="color" value={base} onChange={e => regenerate(e.target.value.toUpperCase(), harmony)} aria-label="Pick base color" />
                                <select value={harmony} onChange={e => regenerate(base, e.target.value as Harmony)} aria-label="Color harmony">
                                    {HARMONIES.map(h => (
                                        <option key={h.id} value={h.id}>
                                            {h.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </details>
                    )}

                    <button className="primary" onClick={addPaletteToPage}>
                        Add palette to page
                    </button>
                    {logo && (
                        <button className="secondary" onClick={addLogoToPage}>
                            Add logo to page
                        </button>
                    )}
                    <button className="link" onClick={newBrand}>
                        Analyze a different logo
                    </button>
                </section>
            )}

            {tab === "fonts" && <FontsTab sandboxProxy={sandboxProxy} fonts={brandFonts} logo={logo} onChange={setBrandFonts} run={run} />}

            {tab === "copy" && (
                <CopyTab key={brandGeneration} sandboxProxy={sandboxProxy} voice={voice} fonts={brandFonts} primaryHex={palette[0]?.hex} onVoiceChange={setVoice} run={run} />
            )}

            {tab === "audit" && (
                <section>
                    <label className="field">
                        <span>Strictness: {tolerance <= 4 ? "exact match" : tolerance <= 12 ? "close match" : "loose match"}</span>
                        <input
                            type="range"
                            min={1}
                            max={25}
                            /* The filled part of the track is drawn by us, not the browser, so it needs to
                               know how far along the value is. See input[type="range"] in App.css. */
                            style={{ ["--filled" as string]: `${((tolerance - 1) / 24) * 100}%` }}
                            value={tolerance}
                            onChange={e => {
                                setTolerance(Number(e.target.value));
                                setAudit(null);
                            }}
                        />
                    </label>

                    <button className="primary" onClick={scan}>
                        Scan colors on this page
                    </button>

                    {audit && audit.colors.length > 0 && (
                        <ul className="audit">
                            {audit.colors.map(c => (
                                <li key={c.hex}>
                                    <span className="chip" style={{ background: c.hex }} />
                                    <span className="auditText">
                                        <strong>{c.hex}</strong>
                                        <small>
                                            {plural(c.count, "use")} · {c.usedBy.join(", ")}
                                        </small>
                                    </span>
                                    {c.onBrand ? (
                                        <span className="badge ok">On brand</span>
                                    ) : (
                                        <span className="fixTo">
                                            <span className="badge off">Off brand</span>
                                            {c.nearestBrandHex && (
                                                <small>
                                                    → <span className="chip tiny" style={{ background: c.nearestBrandHex }} /> {c.nearestBrandHex}
                                                </small>
                                            )}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {offBrandCount > 0 && (
                        <button className="secondary" onClick={fix}>
                            Fix {plural(offBrandCount, "off-brand color")}
                        </button>
                    )}
                </section>
            )}

            <p className="status pinned" role="status" aria-live="polite">
                {status}
            </p>
        </div>
    );
};

export default App;
