import test from "node:test";
import assert from "node:assert/strict";
import { CanvasState, PRESETS, presetRect, moveRect, resizeRect } from "../web/model.js";

test("confirm locks a snapshot, cancel then reconfirm updates and survives workflow roundtrip", () => {
    const model = new CanvasState(); model.source(400, 300);
    model.edit({ rect: presetRect(400, 300, 16 / 9), color: "#123456" });
    assert.equal(model.confirm(), true);
    const locked = model.serialize();
    assert.equal(model.edit({ color: "#ff0000" }), false);
    assert.equal(model.confirm(), false);
    model.source(800, 900);
    assert.equal(model.serialize(), locked);
    const restored = new CanvasState(locked); assert.equal(restored.serialize(), locked);
    restored.cancel(); assert.equal(restored.locked, false); assert.equal(restored.value.status, "cancelled");
    restored.edit({ rect: presetRect(400, 300, 1), color: "#00ff00" }); restored.confirm();
    assert.notDeepEqual(restored.active, model.active);
    restored.reset(400, 300); assert.equal(restored.locked, false);
    assert.deepEqual(restored.active.rect, { x: 0, y: 0, width: 400, height: 300 });
});

test("presets contain the full image at the intended ratio within pixel rounding", () => {
    for (const [w, h] of [[1136, 2016], [2048, 512], [1, 1]]) for (const preset of PRESETS.slice(2)) {
        const [a, b] = preset.split(":").map(Number), r = presetRect(w, h, a / b);
        assert.ok(r.x <= 0 && r.y <= 0 && r.x + r.width >= w && r.y + r.height >= h);
        assert.ok(Math.abs(r.width - r.height * a / b) <= Math.max(1, a / b));
    }
});

test("corner drag preserves current ratio and edge drag changes ratio", () => {
    const r = { x: -100, y: -100, width: 600, height: 500 };
    const resized = resizeRect(r, "se", 200, 120, 400, 300);
    assert.ok(Math.abs(resized.width - resized.height * r.width / r.height) <= 1.2);
    const edge = resizeRect(r, "e", 200, 0, 400, 300);
    assert.equal(edge.height, 500); assert.equal(edge.width, 800);
});

test("all handles and translations never crop or exceed side limits", () => {
    const r = { x: -120, y: -50, width: 800, height: 600 };
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
        for (const dx of [-100000, -400, 0, 400, 100000]) for (const dy of [-100000, -400, 0, 400, 100000]) {
            const out = resizeRect(r, handle, dx, dy, 400, 300);
            assert.ok(out.x <= 0 && out.y <= 0 && out.x + out.width >= 400 && out.y + out.height >= 300, JSON.stringify({ handle, dx, dy, out }));
            assert.ok(out.width <= 16384 && out.height <= 16384);
        }
    }
    for (const delta of [-10000, 10000]) {
        const out = moveRect(r, delta, delta, 400, 300);
        assert.ok(out.x <= 0 && out.y <= 0 && out.x + out.width >= 400 && out.y + out.height >= 300);
    }
});

test("cancellation permits changed source dimensions; draft editing persists without confirming", () => {
    const model = new CanvasState(); model.source(400, 300); model.confirm();
    model.cancel(); model.source(800, 600);
    assert.equal(model.active.sourceWidth, 800); assert.equal(model.locked, false);
    const rect = presetRect(800, 600, 1); model.edit({ rect });
    const restored = new CanvasState(model.serialize());
    restored.source(800, 600); assert.deepEqual(restored.active.rect, rect); assert.equal(restored.locked, false);
});
