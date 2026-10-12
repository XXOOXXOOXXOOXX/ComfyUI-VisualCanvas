import { CanvasState, PRESETS, presetRect, originalRect, moveRect, resizeRect } from "./model.js";

const STYLE = `
.vc-editor{box-sizing:border-box;width:100%;min-width:280px;background:#202329;color:#edf0f5;border:1px solid #424955;border-radius:10px;padding:12px;font:13px/1.5 system-ui,sans-serif;overflow:hidden}
.vc-editor *{box-sizing:border-box}.vc-row{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-bottom:8px}
.vc-editor button,.vc-editor select,.vc-hex{font:inherit;color:inherit;background:#343a45;border:1px solid #566070;border-radius:6px;padding:5px 10px}
.vc-editor button{cursor:pointer}.vc-editor button:hover:not(:disabled){background:#465066}.vc-editor :disabled{opacity:.48;cursor:default}
.vc-editor .vc-confirm{background:#26775b;border-color:#43b68a}.vc-status{margin-left:auto;padding:3px 8px;border-radius:5px;background:#45404c;white-space:nowrap}
.vc-status[data-status=confirmed]{background:#205d47;color:#9befc6}.vc-status[data-status=cancelled]{background:#60472b;color:#ffd49b}
.vc-editor input[type=color]{width:34px;height:30px;border:0;padding:0;background:none;cursor:pointer}.vc-hex{width:92px;padding:4px 7px}
.vc-stage{display:block;width:100%;height:360px;border-radius:7px;background:#171a20;touch-action:none;outline:none}
.vc-info{font-variant-numeric:tabular-nums;margin-top:8px;color:#c1c9d6;overflow-wrap:anywhere}.vc-help{font-size:12px;color:#98a4b6;margin-top:3px}
.vc-error{color:#ffb6a7;min-height:18px;font-size:12px}.vc-editor label{display:flex;align-items:center;gap:6px}
`;

export class CanvasEditor {
    constructor({ raw, save, loadSource }) {
        if (!document.getElementById("visual-canvas-style")) {
            const style = document.createElement("style"); style.id = "visual-canvas-style"; style.textContent = STYLE; document.head.append(style);
        }
        this.model = new CanvasState(raw); this.save = save; this.loadSource = loadSource;
        this.root = document.createElement("div"); this.root.className = "vc-editor";
        this.root.innerHTML = `
          <div class="vc-row"><button class="vc-confirm" data-action="confirm">✓ 确认</button><button data-action="cancel">取消</button><button data-action="reset">重置</button><span class="vc-status" role="status"></span></div>
          <div class="vc-row"><label>比例 <select aria-label="画布比例"></select></label><label>画布颜色 <input type="color" aria-label="画布颜色"></label><input class="vc-hex" aria-label="十六进制颜色" maxlength="7" spellcheck="false"></div>
          <div class="vc-row"><button data-action="fit">适应视图</button><button data-action="minus" aria-label="缩小视图">−</button><button data-action="plus" aria-label="放大视图">＋</button><button data-action="refresh">刷新原图</button></div>
          <canvas class="vc-stage" tabindex="0" aria-label="扩图编辑区域：拖动边自由拉伸，拖动角保持比例，拖动框内移动画布"></canvas>
          <div class="vc-info"></div><div class="vc-help">边：自由拉伸 · 角：保持比例 · 框内：移动画布<br>滚轮：缩放视图 · Alt / 中键拖动：平移视图</div><div class="vc-error" role="alert"></div>`;
        this.canvas = this.root.querySelector("canvas"); this.ctx = this.canvas.getContext("2d");
        this.ratio = this.root.querySelector("select"); this.color = this.root.querySelector("input[type=color]"); this.hex = this.root.querySelector(".vc-hex");
        for (const preset of PRESETS) { const option = document.createElement("option"); option.textContent = option.value = preset; this.ratio.append(option); }
        this.root.addEventListener("pointerdown", e => e.stopPropagation());
        this.root.addEventListener("keydown", e => e.stopPropagation());
        this.root.addEventListener("wheel", e => e.stopPropagation(), { passive: true });
        this.root.querySelectorAll("button").forEach(button => button.addEventListener("click", () => this.action(button.dataset.action)));
        this.ratio.addEventListener("change", () => {
            const active = this.model.active; if (!active || this.model.locked) return;
            const preset = this.ratio.value;
            try {
                const rect = preset === "自由" ? active.rect : preset === "原图" ? originalRect(active.sourceWidth, active.sourceHeight)
                    : presetRect(active.sourceWidth, active.sourceHeight, Number(preset.split(":")[0]) / Number(preset.split(":")[1]));
                this.model.edit({ rect, preset }); this.persist(); this.fit(); this.render();
            } catch (error) { this.error(error.message); }
        });
        this.color.addEventListener("input", () => this.setColor(this.color.value));
        this.hex.addEventListener("change", () => {
            if (/^#[0-9a-f]{6}$/i.test(this.hex.value)) this.setColor(this.hex.value.toLowerCase());
            else { this.error("请输入 #RRGGBB 格式的颜色"); this.hex.value = this.model.active?.color || "#ffffff"; }
        });
        this.canvas.addEventListener("pointerdown", e => this.pointerDown(e));
        this.canvas.addEventListener("pointermove", e => this.pointerMove(e));
        this.canvas.addEventListener("pointerup", e => this.pointerEnd(e));
        this.canvas.addEventListener("pointercancel", e => this.pointerEnd(e));
        this.canvas.addEventListener("lostpointercapture", () => { this.drag = null; });
        this.canvas.addEventListener("wheel", e => {
            e.preventDefault(); const point = this.point(e); this.zoom(Math.exp(-e.deltaY * .001), point);
        }, { passive: false });
        this.observer = new ResizeObserver(() => { this.fit(); this.draw(); }); this.observer.observe(this.canvas);
        this.timer = setInterval(() => this.refresh(), 700);
        this.render(); this.refresh();
    }
    error(message = "") { this.root.querySelector(".vc-error").textContent = message; }
    persist() { this.save(this.model.serialize()); }
    restore(raw) { this.model.restore(raw); this.fit(); this.render(); this.refresh(); }
    setColor(color) { if (this.model.edit({ color })) { this.persist(); this.render(); } }
    action(action) {
        this.error();
        if (action === "confirm") {
            if (!this.image || !this.matches()) { this.error("请先连接加载图片节点，等待原图显示。尺寸变化时需先取消或重置。"); return; }
            if (this.model.confirm()) this.persist();
        } else if (action === "cancel") {
            this.model.cancel(); if (this.image) this.model.source(this.image.naturalWidth, this.image.naturalHeight); this.persist();
        } else if (action === "reset") {
            this.model.reset(this.image?.naturalWidth, this.image?.naturalHeight); this.persist(); this.fit();
        } else if (action === "fit") this.fit();
        else if (action === "plus") this.zoom(1.25);
        else if (action === "minus") this.zoom(.8);
        else if (action === "refresh") { this.refresh(true); return; }
        this.render();
    }
    matches() {
        const active = this.model.active;
        return !!this.image && active?.sourceWidth === this.image.naturalWidth && active?.sourceHeight === this.image.naturalHeight;
    }
    async refresh(force = false) {
        if (this.destroyed) return;
        let source;
        try { source = this.loadSource(); } catch { source = null; }
        const key = source?.key || "";
        if (!force && key === this.sourceKey) return;
        this.sourceKey = key; const request = this.request = (this.request || 0) + 1;
        this.image = null; this.drag = null; this.render();
        if (!source) { this.error("请将「加载图片 / Load Image」的 IMAGE 连接到此节点（支持 Reroute）。"); return; }
        this.error("正在读取原图…");
        const image = new Image();
        image.onload = () => {
            if (this.destroyed || request !== this.request) return;
            this.image = image;
            this.model.source(image.naturalWidth, image.naturalHeight);
            // A locked rectangle is never changed by preview reload or workflow execution.
            this.persist(); this.fit(); this.render();
            this.error(this.matches() ? "" : "图片尺寸已改变：原确认仍保留，请取消或重置后重新确认。");
        };
        image.onerror = () => { if (request === this.request && !this.destroyed) { this.error("无法读取原图，请检查加载图片节点，或点击刷新原图。"); this.render(); } };
        image.src = source.url + (source.url.includes("?") ? "&" : "?") + "vc=" + Date.now();
    }
    render() {
        const active = this.model.active, locked = this.model.locked;
        const status = this.root.querySelector(".vc-status");
        status.dataset.status = locked ? "confirmed" : this.model.value.status || "pending";
        status.textContent = locked ? "已确定 · 已锁定" : this.model.value.status === "cancelled" ? "已取消 · 可编辑" : "待确认 · 可编辑";
        this.ratio.disabled = this.color.disabled = this.hex.disabled = locked || !this.image;
        this.ratio.value = active?.preset || "自由";
        this.color.value = this.hex.value = active?.color || "#ffffff";
        this.root.querySelector('[data-action="confirm"]').disabled = locked || !this.matches();
        const info = this.root.querySelector(".vc-info");
        if (active) {
            const r = active.rect;
            info.textContent = `原图 ${active.sourceWidth} × ${active.sourceHeight} → 画布 ${r.width} × ${r.height} px ｜ 左 ${-r.x} 上 ${-r.y} 右 ${r.x + r.width - active.sourceWidth} 下 ${r.y + r.height - active.sourceHeight}`;
        } else info.textContent = "连接图片后直接预览，无需运行此节点";
        this.draw();
    }
    dimensions() { return { w: this.canvas.clientWidth || 520, h: this.canvas.clientHeight || 360 }; }
    fit() {
        const active = this.model.active; if (!active) return;
        const { w, h } = this.dimensions(), r = active.rect;
        const minX = Math.min(r.x, 0), minY = Math.min(r.y, 0);
        const maxX = Math.max(r.x + r.width, this.image?.naturalWidth || active.sourceWidth);
        const maxY = Math.max(r.y + r.height, this.image?.naturalHeight || active.sourceHeight);
        const scale = Math.min((w - 70) / (maxX - minX), (h - 60) / (maxY - minY)) * .8;
        this.view = { scale, x: w / 2 - (minX + maxX) * scale / 2, y: h / 2 - (minY + maxY) * scale / 2 };
    }
    zoom(factor, point) {
        if (!this.view) return;
        const { w, h } = this.dimensions(); point ||= { x: w / 2, y: h / 2 };
        const old = this.view.scale, scale = Math.max(.002, Math.min(20, old * factor));
        this.view.x = point.x - (point.x - this.view.x) * scale / old;
        this.view.y = point.y - (point.y - this.view.y) * scale / old;
        this.view.scale = scale; this.draw();
    }
    handles() {
        const r = this.model.active?.rect, v = this.view; if (!r || !v) return [];
        const left = v.x + r.x * v.scale, top = v.y + r.y * v.scale;
        const right = left + r.width * v.scale, bottom = top + r.height * v.scale;
        return [["nw", left, top], ["n", (left + right) / 2, top], ["ne", right, top], ["e", right, (top + bottom) / 2],
            ["se", right, bottom], ["s", (left + right) / 2, bottom], ["sw", left, bottom], ["w", left, (top + bottom) / 2]];
    }
    draw() {
        const { w, h } = this.dimensions(), dpr = window.devicePixelRatio || 1;
        if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
            this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
        }
        const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#181c23"; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "#262c36"; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = 0; x < w; x += 20) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let y = 0; y < h; y += 20) { ctx.moveTo(0, y); ctx.lineTo(w, y); } ctx.stroke();
        if (!this.model.active || !this.image) {
            ctx.fillStyle = "#a2afc2"; ctx.textAlign = "center"; ctx.font = "14px system-ui"; ctx.fillText("连接「加载图片」以开始", w / 2, h / 2); return;
        }
        if (!this.view) this.fit();
        const a = this.model.active, r = a.rect, v = this.view;
        const left = v.x + r.x * v.scale, top = v.y + r.y * v.scale, width = r.width * v.scale, height = r.height * v.scale;
        ctx.fillStyle = a.color; ctx.fillRect(left, top, width, height);
        ctx.drawImage(this.image, v.x, v.y, this.image.naturalWidth * v.scale, this.image.naturalHeight * v.scale);
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "#548ff7"; ctx.lineWidth = 1.5;
        ctx.strokeRect(v.x, v.y, this.image.naturalWidth * v.scale, this.image.naturalHeight * v.scale); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip();
        ctx.strokeStyle = "rgba(125,145,168,.45)"; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = 1; i <= 2; i++) {
            ctx.moveTo(left + width * i / 3, top); ctx.lineTo(left + width * i / 3, top + height);
            ctx.moveTo(left, top + height * i / 3); ctx.lineTo(left + width, top + height * i / 3);
        } ctx.stroke(); ctx.restore();
        ctx.strokeStyle = this.model.locked ? "#62dfa7" : "#f6f8fc"; ctx.lineWidth = 2; ctx.strokeRect(left, top, width, height);
        if (!this.model.locked && this.matches()) for (const [, x, y] of this.handles()) {
            ctx.fillStyle = "#fff"; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeStyle = "#283c58"; ctx.lineWidth = 1; ctx.strokeRect(x - 5, y - 5, 10, 10);
        }
    }
    point(e) {
        const box = this.canvas.getBoundingClientRect(), { w, h } = this.dimensions();
        return { x: (e.clientX - box.left) * w / box.width, y: (e.clientY - box.top) * h / box.height };
    }
    hit(point) {
        for (const [name, x, y] of this.handles()) if (Math.abs(x - point.x) <= 12 && Math.abs(y - point.y) <= 12) return name;
        const r = this.model.active?.rect, v = this.view; if (!r || !v) return null;
        const x = (point.x - v.x) / v.scale, y = (point.y - v.y) / v.scale;
        return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height ? "move" : null;
    }
    pointerDown(e) {
        if (!this.view || !this.image || this.drag) return;
        const point = this.point(e), pan = e.button === 1 || (e.button === 0 && e.altKey);
        if (!pan && (e.button !== 0 || this.model.locked || !this.matches())) return;
        const handle = pan ? "pan" : this.hit(point); if (!handle) return;
        e.preventDefault(); this.canvas.setPointerCapture(e.pointerId);
        this.drag = { id: e.pointerId, point, handle, rect: { ...this.model.active.rect }, view: { ...this.view } };
    }
    pointerMove(e) {
        const point = this.point(e), d = this.drag;
        if (!d) {
            const hit = this.model.locked ? null : this.hit(point);
            this.canvas.style.cursor = e.altKey ? "grab" : hit === "move" ? "move" : hit ? ({ n: "ns", s: "ns", e: "ew", w: "ew", nw: "nwse", se: "nwse", ne: "nesw", sw: "nesw" }[hit] + "-resize") : "default"; return;
        }
        if (d.id !== e.pointerId) return;
        if (d.handle === "pan") {
            this.view.x = d.view.x + point.x - d.point.x; this.view.y = d.view.y + point.y - d.point.y; this.draw(); return;
        }
        const dx = (point.x - d.point.x) / d.view.scale, dy = (point.y - d.point.y) / d.view.scale, a = this.model.active;
        const rect = d.handle === "move" ? moveRect(d.rect, dx, dy, a.sourceWidth, a.sourceHeight)
            : resizeRect(d.rect, d.handle, dx, dy, a.sourceWidth, a.sourceHeight);
        this.model.edit({ rect, preset: "自由" }); this.render();
    }
    pointerEnd(e) {
        if (!this.drag || this.drag.id !== e.pointerId) return;
        const pan = this.drag.handle === "pan"; this.drag = null;
        if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
        if (!pan) { this.persist(); this.fit(); this.render(); }
    }
    destroy() { this.destroyed = true; clearInterval(this.timer); this.observer.disconnect(); this.request = (this.request || 0) + 1; }
}
