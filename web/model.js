export const MAX_SIDE = 16384;
export const PRESETS = ["自由", "原图", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
const copy = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function originalRect(w, h) { return { x: 0, y: 0, width: w, height: h }; }

export function presetRect(w, h, ratio) {
    const width = Math.ceil(Math.max(w, h * ratio));
    const height = Math.ceil(Math.max(h, w / ratio));
    if (width > MAX_SIDE || height > MAX_SIDE) throw new Error("该比例超过最大画布尺寸 16384px");
    return { x: -Math.floor((width - w) / 2) || 0, y: -Math.floor((height - h) / 2) || 0, width, height };
}

// Image coordinates are fixed at (0,0); all operations must contain the image.
export function moveRect(rect, dx, dy, w, h) {
    return { ...rect, x: clamp(Math.round(rect.x + dx), w - rect.width, 0),
        y: clamp(Math.round(rect.y + dy), h - rect.height, 0) };
}

export function resizeRect(rect, handle, dx, dy, w, h) {
    let left = rect.x, top = rect.y, right = left + rect.width, bottom = top + rect.height;
    const west = handle.includes("w"), east = handle.includes("e");
    const north = handle.includes("n"), south = handle.includes("s");
    if ((west || east) && (north || south)) {
        const anchorX = west ? right : left, anchorY = north ? bottom : top;
        const ratio = rect.width / rect.height;
        const desiredWidth = rect.width + (west ? -dx : dx);
        const desiredHeight = rect.height + (north ? -dy : dy);
        // Project movement onto the aspect-ratio diagonal; preserve the opposite corner.
        let height = (desiredWidth * ratio + desiredHeight) / (ratio * ratio + 1);
        const minWidth = west ? anchorX : w - anchorX;
        const minHeight = north ? anchorY : h - anchorY;
        const minimum = Math.max(minHeight, minWidth / ratio, 1);
        const maximum = Math.min(MAX_SIDE, MAX_SIDE / ratio);
        if (minimum > maximum) return { ...rect };
        height = clamp(height, minimum, maximum);
        const pixelHeight = Math.min(MAX_SIDE, Math.ceil(height));
        const pixelWidth = Math.min(MAX_SIDE, Math.ceil(height * ratio));
        return { x: west ? anchorX - pixelWidth : anchorX,
            y: north ? anchorY - pixelHeight : anchorY, width: pixelWidth, height: pixelHeight };
    }
    if (west) left = clamp(Math.round(left + dx), right - MAX_SIDE, 0);
    if (east) right = clamp(Math.round(right + dx), w, left + MAX_SIDE);
    if (north) top = clamp(Math.round(top + dy), bottom - MAX_SIDE, 0);
    if (south) bottom = clamp(Math.round(bottom + dy), h, top + MAX_SIDE);
    return { x: left, y: top, width: right - left, height: bottom - top };
}

export class CanvasState {
    constructor(raw) { this.restore(raw); }
    restore(raw) {
        let value;
        try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { value = null; }
        this.value = value?.version === 1 ? copy(value) : { version: 1, locked: null, draft: null, status: "pending" };
    }
    get locked() { return !!this.value.locked; }
    get active() { return this.value.locked || this.value.draft; }
    serialize() { return JSON.stringify(this.value); }
    source(w, h) {
        if (this.locked) return;
        if (this.value.draft?.sourceWidth === w && this.value.draft?.sourceHeight === h) return;
        this.value.draft = { sourceWidth: w, sourceHeight: h, rect: originalRect(w, h), color: this.value.draft?.color || "#ffffff", preset: "自由" };
    }
    edit(change) { if (this.locked || !this.value.draft) return false; Object.assign(this.value.draft, copy(change)); return true; }
    confirm() {
        if (this.locked || !this.value.draft) return false;
        this.value.locked = copy(this.value.draft);
        this.value.status = "confirmed";
        return true;
    }
    cancel() {
        if (this.value.locked) this.value.draft = copy(this.value.locked);
        this.value.locked = null;
        this.value.status = "cancelled";
    }
    reset(w, h) {
        const color = this.active?.color || "#ffffff";
        this.value = { version: 1, locked: null, status: "cancelled", draft: w && h ? {
            sourceWidth: w, sourceHeight: h, rect: originalRect(w, h), color, preset: "自由",
        } : null };
    }
}
