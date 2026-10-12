import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { CanvasEditor } from "./editor.js";

function sourceFor(node) {
    let current = node, slot = current.inputs?.findIndex(input => input.name === "image");
    const seen = new Set();
    for (let depth = 0; depth < 64; depth++) {
        const linkId = current.inputs?.[slot]?.link;
        if (linkId == null) return null;
        const graph = current.graph || app.graph;
        const link = graph.links?.get?.(linkId) || graph.links?.[linkId];
        if (!link || seen.has(link.origin_id)) return null;
        seen.add(link.origin_id);
        const upstream = graph.getNodeById(link.origin_id);
        if (!upstream) return null;
        if (upstream.comfyClass === "LoadImage" || upstream.type === "LoadImage") {
            const filename = upstream.widgets?.find(widget => widget.name === "image")?.value;
            if (typeof filename !== "string" || !filename) return null;
            let path = filename.replace(/\\/g, "/"), type = "input";
            const annotation = path.match(/ \[(input|output|temp)\]$/);
            if (annotation) { type = annotation[1]; path = path.slice(0, -annotation[0].length); }
            const slash = path.lastIndexOf("/");
            const params = new URLSearchParams({ filename: path.slice(slash + 1), subfolder: slash < 0 ? "" : path.slice(0, slash), type });
            return { key: `${upstream.id}:${filename}`, url: api.apiURL(`/view?${params}`) };
        }
        // Only transparent reroutes can use the original file as an exact preview.
        if (!/reroute/i.test(upstream.comfyClass || upstream.type || "")) return null;
        current = upstream; slot = 0;
    }
    return null;
}

app.registerExtension({
    name: "VisualCanvas.InteractiveExpand",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "VisualCanvasExpand") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            const stateWidget = this.widgets?.find(widget => widget.name === "canvas_state");
            if (!stateWidget || typeof this.addDOMWidget !== "function") {
                console.warn("[VisualCanvas] 未找到 canvas_state 或 addDOMWidget，请检查前端版本与节点输入。");
                return result;
            }
            stateWidget.type = "hidden";
            stateWidget.computeSize = () => [0, -4];
            stateWidget.serializeValue = () => stateWidget.value;
            // Hide the stock input element as well on older frontends.
            if (stateWidget.inputEl) stateWidget.inputEl.style.display = "none";
            const editor = new CanvasEditor({
                raw: stateWidget.value,
                save: raw => {
                    if (stateWidget.value === raw) return;
                    stateWidget.value = raw;
                    this.graph?.change?.(); this.setDirtyCanvas?.(true, true);
                },
                loadSource: () => sourceFor(this),
            });
            this.visualCanvasEditor = editor;
            const widget = this.addDOMWidget("visual_canvas_editor", "visual_canvas", editor.root, {
                serialize: false, hideOnZoom: false, getMinHeight: () => 610, getHeight: () => 610,
            });
            widget.options.serialize = false;
            this.setSize([Math.max(this.size[0], 580), Math.max(this.size[1], 700)]);
            const configure = this.onConfigure;
            this.onConfigure = function () {
                const result = configure?.apply(this, arguments);
                editor.restore(stateWidget.value); return result;
            };
            const removed = this.onRemoved;
            this.onRemoved = function () { editor.destroy(); return removed?.apply(this, arguments); };
            return result;
        };
    },
});
