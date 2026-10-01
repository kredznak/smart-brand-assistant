// Where a palette's swatches sit on the page.
//
// Kept out of the sandbox so it can be checked without Express. The first release placed
// a fixed row — five 120px swatches from x=40, over 700px in all — which ran off the edge
// of any page narrower than that, and positioned it inside whatever Express offered as
// the insertion parent, which can be a group sitting anywhere at all.

export const SWATCH_MAX_SIZE = 120;
export const SWATCH_MAX_GAP = 16;

export interface PaletteLayout {
    size: number;
    gap: number;
    /** Left edge of the first swatch, in page coordinates. */
    left: number;
    top: number;
    /** Offset from a swatch's top-left corner to its label. */
    inset: number;
    radius: number;
    fontSize: number;
}

/**
 * A row of `count` swatches, scaled and centred so the whole row sits inside a page of
 * the given size with a margin around it. Guaranteed for any page size: the row never
 * starts left of the page, and never extends past its right or bottom edge.
 */
export function paletteLayout(count: number, pageWidth: number, pageHeight: number): PaletteLayout {
    // A missing or unreadable page size must not turn the whole layout into NaN.
    const width = Math.max(1, pageWidth || 0);
    const height = Math.max(1, pageHeight || 0);
    const n = Math.max(1, Math.floor(count));

    // Proportional as well as capped, so the margin cannot eat a small page: this leaves
    // at least nine tenths of each side to lay the row out in, whatever the page size.
    const margin = Math.min(40, width * 0.05, height * 0.05);
    const gap = Math.min(SWATCH_MAX_GAP, (width - margin * 2) * 0.02);
    const room = width - margin * 2 - gap * (n - 1);
    const size = Math.min(SWATCH_MAX_SIZE, room / n, height - margin * 2);
    const rowWidth = size * n + gap * (n - 1);

    return {
        size,
        gap,
        left: (width - rowWidth) / 2,
        top: Math.min(margin, height - size),
        inset: size * 0.1,
        radius: Math.min(12, size / 10),
        // Floored because Express refuses a font size below a point or so, which only
        // comes up on a page too small to read a label on anyway.
        fontSize: Math.max(6, Math.min(14, size / 8.5))
    };
}
