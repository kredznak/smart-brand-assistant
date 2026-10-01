import addOnSandboxSdk from "add-on-sdk-document-sandbox";
import { AvailableFont, Color, colorUtils, constants, editor, fonts } from "express-document-sdk";
import { BUILD } from "../shared/build";
import { BrandColor, nearestBrandColor, normalizeHex, readableTextOn } from "../shared/color";
import { paletteLayout } from "../shared/paletteLayout";
import {
    ApplyFontResult,
    AuditColor,
    AuditFont,
    AuditResult,
    BrandFonts,
    DocumentSandboxApi,
    FontInfo,
    TextStyle
} from "../shared/DocumentSandboxApi";

const { runtime } = addOnSandboxSdk.instance;

type Usage = "fill" | "stroke" | "text";

/** One place on the page where a solid color is used, with a way to replace it. */
interface ColorUse {
    hex: string;
    usage: Usage;
    replace(hex: string): void;
}

function toHex6(color: Color): string {
    return normalizeHex(colorUtils.toHex(color)) ?? "#000000";
}

function withAlpha(hex: string, alpha: number): Color {
    const c = colorUtils.fromHex(hex);
    return { red: c.red, green: c.green, blue: c.blue, alpha };
}

/**
 * The given nodes and everything inside them, walking `children` level by level.
 * `allDescendants` would be shorter, but inside Express it throws "Experimental APIs are
 * not supported" as soon as the selection holds a container such as a group or an image,
 * and the manifest opt-in it wants is not allowed in a distributed add-on.
 */
function* walk(roots: Iterable<any>): Iterable<any> {
    for (const root of roots) {
        yield root;
        let children: Iterable<any> | undefined;
        try {
            children = root.children;
        } catch {
            children = undefined; // not a container, or not readable
        }
        if (children) yield* walk(children);
    }
}

/** Collects every solid color used by the given nodes (and everything inside them). */
function collectColorUses(roots: Iterable<any>): { uses: ColorUse[]; scanned: number } {
    const uses: ColorUse[] = [];
    const seenText = new Set<string>();
    let scanned = 0;

    const visit = (node: any) => {
        scanned++;
        try {
            if (node.type === constants.SceneNodeType.text) {
                const model = node.fullContent;
                if (seenText.has(model.id)) return; // threaded text frames share one model
                seenText.add(model.id);
                let start = 0;
                for (const range of model.characterStyleRanges) {
                    const alpha = range.color.alpha;
                    const span = { start, length: range.length };
                    start += range.length;
                    uses.push({
                        hex: toHex6(range.color),
                        usage: "text",
                        replace: hex => model.applyCharacterStyles({ color: withAlpha(hex, alpha) }, span)
                    });
                }
                return;
            }
            const fill = node.fill;
            if (fill && fill.type === constants.FillType.color) {
                const alpha = fill.color.alpha;
                uses.push({
                    hex: toHex6(fill.color),
                    usage: "fill",
                    replace: hex => {
                        node.fill = editor.makeColorFill(withAlpha(hex, alpha));
                    }
                });
            }
            const stroke = node.stroke;
            if (stroke && stroke.type === constants.StrokeType.color && stroke.width > 0) {
                const alpha = stroke.color.alpha;
                uses.push({
                    hex: toHex6(stroke.color),
                    usage: "stroke",
                    replace: hex => {
                        node.stroke = editor.makeStroke({ ...stroke, color: withAlpha(hex, alpha) });
                    }
                });
            }
        } catch (e) {
            console.log("Skipped a node while scanning:", e);
        }
    };

    for (const node of walk(roots)) visit(node);
    return { uses, scanned };
}

/** Every distinct text content model under the given nodes (threaded frames share one model). */
function collectTextModels(roots: Iterable<any>): any[] {
    const models: any[] = [];
    const seen = new Set<string>();
    const visit = (node: any) => {
        try {
            if (node.type !== constants.SceneNodeType.text) return;
            const model = node.fullContent;
            if (seen.has(model.id)) return;
            seen.add(model.id);
            models.push(model);
        } catch (e) {
            console.log("Skipped a text node:", e);
        }
    };
    for (const node of walk(roots)) visit(node);
    return models;
}

const HEADING_MIN_SIZE = 30; // points; text this large is treated as a heading

const toFontInfo = (font: { postscriptName: string; family: string; style: string }): FontInfo => ({
    postscriptName: font.postscriptName,
    family: font.family,
    style: font.style
});

async function loadFonts(names: (string | undefined)[]): Promise<Map<string, AvailableFont>> {
    const loaded = new Map<string, AvailableFont>();
    for (const name of names) {
        if (!name || loaded.has(name)) continue;
        try {
            const font = await fonts.fromPostscriptName(name);
            if (font) loaded.set(name, font);
        } catch (e) {
            console.log("Font lookup failed for", name, e);
        }
    }
    return loaded;
}

// Fonts already looked up, so applying one needs no await. Unlike page content, a
// font object is not a scene node and is safe to keep across calls.
const fontCache = new Map<string, AvailableFont>();

/**
 * How many clicked nodes Express is keeping out of the selection because they are locked.
 * selectionIncludingNonEditable is an experimental API: it throws unless the manifest opts
 * in, and that opt-in is not allowed in a distributed add-on, so its absence must cost
 * nothing more than not being able to say "that text is locked".
 */
let lockedCountAvailable = true;

function lockedCount(selected: number): number {
    // The panel polls the selection twice a second, so once this API has refused it must
    // not be called again: every call throws, and a swallowed throw twice a second is
    // both wasted work and noise in the console.
    if (!lockedCountAvailable) return 0;
    try {
        return Math.max(0, editor.context.selectionIncludingNonEditable.length - selected);
    } catch {
        lockedCountAvailable = false;
        return 0;
    }
}

function pageRoots(): Iterable<any> {
    return editor.context.currentPage.artboards;
}

/**
 * The artboard holding whatever Express would insert into next. Positions are measured
 * against a node's parent, so content meant to land at a known place on the page has to
 * go into the artboard itself: `insertionParent` is whatever the user's selection makes
 * it, and a group sitting half off the canvas would take the content with it.
 */
function currentArtboard(): any | null {
    let node: any = editor.context.insertionParent;
    while (node) {
        if (node.type === constants.SceneNodeType.artboard) return node;
        try {
            node = node.parent;
        } catch {
            break;
        }
    }
    return editor.context.currentPage.artboards.first ?? null;
}

function start(): void {
    const sandboxApi: DocumentSandboxApi = {
        build: () => BUILD,

        describeSelection() {
            const selection = editor.context.selection;
            const selected = selection.length;
            return { selected, locked: lockedCount(selected), text: collectTextModels(selection).length };
        },

        auditPage(paletteHex: string[], tolerance: number): AuditResult {
            const { uses, scanned } = collectColorUses(pageRoots());
            const byHex = new Map<string, AuditColor>();
            for (const use of uses) {
                let entry = byHex.get(use.hex);
                if (!entry) {
                    const nearest = nearestBrandColor(use.hex, paletteHex);
                    entry = {
                        hex: use.hex,
                        count: 0,
                        usedBy: [],
                        nearestBrandHex: nearest ? nearest.hex : null,
                        distance: nearest ? nearest.distance : 0,
                        onBrand: nearest ? nearest.distance <= tolerance : true
                    };
                    byHex.set(use.hex, entry);
                }
                entry.count++;
                if (!entry.usedBy.includes(use.usage)) entry.usedBy.push(use.usage);
            }
            const colors = [...byHex.values()].sort(
                (a, b) => Number(a.onBrand) - Number(b.onBrand) || b.count - a.count
            );
            return { colors, scanned };
        },

        fixOffBrandColors(paletteHex: string[], tolerance: number): number {
            const { uses } = collectColorUses(pageRoots());
            let changed = 0;
            for (const use of uses) {
                const nearest = nearestBrandColor(use.hex, paletteHex);
                // Exact matches need no change; anything else beyond tolerance snaps to the brand color.
                if (!nearest || nearest.distance <= tolerance) continue;
                try {
                    use.replace(nearest.hex);
                    changed++;
                } catch (e) {
                    console.log("Could not recolor a node (it may be locked):", e);
                }
            }
            return changed;
        },

        applyColorToSelection(hex: string): number {
            const { uses } = collectColorUses(editor.context.selection);
            let changed = 0;
            for (const use of uses) {
                if (use.usage === "stroke") continue;
                try {
                    use.replace(hex);
                    changed++;
                } catch (e) {
                    console.log("Could not recolor a selected node:", e);
                }
            }
            return changed;
        },

        addPaletteToPage(palette: BrandColor[]): void {
            if (palette.length === 0) return;
            const page = editor.context.currentPage;
            const parent = currentArtboard() ?? editor.context.insertionParent;
            const { size, gap, left, top, inset, radius, fontSize } = paletteLayout(
                palette.length,
                page.width,
                page.height
            );

            palette.forEach((brandColor, i) => {
                const x = left + i * (size + gap);
                const swatch = editor.createRectangle();
                swatch.width = size;
                swatch.height = size;
                swatch.topLeftRadius = swatch.topRightRadius = radius;
                swatch.bottomLeftRadius = swatch.bottomRightRadius = radius;
                swatch.fill = editor.makeColorFill(colorUtils.fromHex(brandColor.hex));
                parent.children.append(swatch);
                swatch.setPositionInParent({ x, y: top }, { x: 0, y: 0 });

                const label = editor.createText(`${brandColor.role}\n${brandColor.hex}`);
                parent.children.append(label);
                label.fullContent.applyCharacterStyles({
                    fontSize,
                    color: colorUtils.fromHex(readableTextOn(brandColor.hex))
                });
                label.setPositionInParent({ x: x + inset, y: top + inset }, { x: 0, y: 0 });
            });
        },

        async getAvailableFonts(postscriptNames: string[]): Promise<FontInfo[]> {
            const loaded = await loadFonts(postscriptNames);
            return [...loaded.values()].map(toFontInfo);
        },

        getSelectionFont(): FontInfo | null {
            for (const model of collectTextModels(editor.context.selection)) {
                const first = model.characterStyleRanges[0];
                if (first) return toFontInfo(first.font);
            }
            return null;
        },

        async loadFont(postscriptName: string): Promise<boolean> {
            if (fontCache.has(postscriptName)) return true;
            try {
                const font = await fonts.fromPostscriptName(postscriptName);
                if (!font) return false;
                fontCache.set(postscriptName, font);
                return true;
            } catch (e) {
                console.log("Font lookup failed for", postscriptName, e);
                return false;
            }
        },

        // Deliberately synchronous, shaped like applyColorToSelection, which has always
        // worked. The earlier version awaited the font inside keepContentActiveDuringAsync;
        // that gave the selection a window to vanish and, if the call stalled, produced no
        // answer at all, which from the panel looked like a dead button.
        applyFontToSelection(postscriptName: string): ApplyFontResult {
            const result: ApplyFontResult = { changed: 0, selected: 0, textFound: 0, locked: 0 };
            const selection = editor.context.selection;
            result.selected = selection.length;
            result.locked = lockedCount(selection.length);
            const models = collectTextModels(selection);
            result.textFound = models.length;
            if (models.length === 0) return result;

            const font = fontCache.get(postscriptName);
            if (!font) {
                result.error = `${postscriptName} has not been loaded yet. Press Apply again.`;
                return result;
            }
            for (const model of models) {
                try {
                    model.applyCharacterStyles({ font });
                    result.changed++;
                } catch (e) {
                    result.error = e instanceof Error ? e.message : String(e);
                    console.log("Could not change the font of a text item:", e);
                }
            }
            return result;
        },

        auditFonts(brandFamilies: string[]): AuditFont[] {
            const brand = brandFamilies.map(f => f.toLowerCase());
            const byName = new Map<string, AuditFont>();
            for (const model of collectTextModels(pageRoots())) {
                for (const range of model.characterStyleRanges) {
                    const info = toFontInfo(range.font);
                    let entry = byName.get(info.postscriptName);
                    if (!entry) {
                        entry = { ...info, count: 0, onBrand: brand.includes(info.family.toLowerCase()) };
                        byName.set(info.postscriptName, entry);
                    }
                    entry.count++;
                }
            }
            return [...byName.values()].sort((a, b) => Number(a.onBrand) - Number(b.onBrand) || b.count - a.count);
        },

        async fixOffBrandFonts(brandFonts: BrandFonts): Promise<number> {
            // Captured here rather than taken from the callback argument: inside Express that
            // argument has not reliably been the Map the async lambda returned.
            let loaded: Map<string, AvailableFont> = new Map();
            const headingName = (brandFonts.heading ?? brandFonts.body)?.postscriptName;
            const bodyName = (brandFonts.body ?? brandFonts.heading)?.postscriptName;
            const brandFamilies = [brandFonts.heading, brandFonts.body]
                .filter((f): f is FontInfo => !!f)
                .map(f => f.family.toLowerCase());
            let changed = 0;
            await editor.keepContentActiveDuringAsync(
                editor.context.currentPage,
                async () => {
                    loaded = await loadFonts([headingName, bodyName]);
                },
                () => {
                    const heading = headingName ? loaded.get(headingName) : undefined;
                    const body = bodyName ? loaded.get(bodyName) : undefined;
                    for (const model of collectTextModels(pageRoots())) {
                        let start = 0;
                        for (const range of model.characterStyleRanges) {
                            const span = { start, length: range.length };
                            start += range.length;
                            if (brandFamilies.includes(range.font.family.toLowerCase())) continue;
                            const font = range.fontSize >= HEADING_MIN_SIZE ? heading : body;
                            if (!font) continue;
                            try {
                                model.applyCharacterStyles({ font }, span);
                                changed++;
                            } catch (e) {
                                console.log("Could not change a font (the text may use an unavailable font):", e);
                            }
                        }
                    }
                }
            );
            return changed;
        },

        async addTextToPage(text: string, style: TextStyle): Promise<void> {
            // Captured here rather than taken from the callback argument: inside Express that
            // argument has not reliably been the Map the async lambda returned.
            let loaded: Map<string, AvailableFont> = new Map();
            await editor.keepContentActiveDuringAsync(
                editor.context.currentPage,
                async () => {
                    loaded = await loadFonts([style.postscriptName]);
                },
                () => {
                    const page = editor.context.currentPage;
                    const parent = currentArtboard() ?? editor.context.insertionParent;
                    const node = editor.createText(text);
                    parent.children.append(node);
                    const font = style.postscriptName ? loaded.get(style.postscriptName) : undefined;
                    node.fullContent.applyCharacterStyles({
                        ...(font ? { font } : {}),
                        ...(style.hex ? { color: colorUtils.fromHex(style.hex) } : {}),
                        fontSize: style.fontSize ?? 32
                    });

                    // Wrap long copy to the page width instead of running off the canvas in one
                    // line. Measured as well as counted, because a short line in a large size
                    // overruns a narrow page just as easily as a long one does.
                    const margin = Math.min(40, page.width * 0.05, page.height * 0.05);
                    const maxWidth = page.width - margin * 2;
                    if (text.length > 40 || node.boundsLocal.width > maxWidth) {
                        try {
                            node.layout = { type: constants.TextLayout.autoHeight, width: maxWidth };
                        } catch (e) {
                            console.log("Could not wrap the text:", e);
                        }
                    }
                    // A fifth of the way down the page, but never below its bottom edge.
                    const y = Math.max(margin, Math.min(page.height * 0.2, page.height - margin - node.boundsLocal.height));
                    node.setPositionInParent({ x: margin, y }, { x: 0, y: 0 });
                }
            );
        },

        replaceSelectedText(text: string): boolean {
            const model = collectTextModels(editor.context.selection)[0];
            if (!model) return false;
            model.text = text;
            return true;
        }
    };

    runtime.exposeApi(sandboxApi);
}

start();
