"""Interactive outpainting: the serialized confirmation is the only output authority."""
import json
import re

import torch


MAX_SIDE = 16384
MAX_BATCH_PIXELS = 64 * 1024 * 1024


def confirmed_settings(raw, source_width, source_height, batch=1):
    try:
        state = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("扩图画布设置损坏，请重置节点并重新确认。") from exc
    if not isinstance(state, dict) or state.get("version") != 1:
        raise ValueError("不支持的扩图画布设置，请重置后重新确认。")
    locked = state.get("locked")
    if not isinstance(locked, dict):
        raise ValueError("画布尚未确认或已取消。请在节点中调整画布并点击「确认」。")
    if locked.get("sourceWidth") != source_width or locked.get("sourceHeight") != source_height:
        raise ValueError("输入图片尺寸与确认时不同。请点击「取消」或「重置」，再重新确认。")
    rect = locked.get("rect")
    if not isinstance(rect, dict):
        raise ValueError("确认的画布区域无效，请重新确认。")
    values = [rect.get(k) for k in ("x", "y", "width", "height")]
    if any(type(v) is not int for v in values):
        raise ValueError("画布坐标和尺寸必须为整数像素。")
    x, y, width, height = values
    if not (1 <= width <= MAX_SIDE and 1 <= height <= MAX_SIDE):
        raise ValueError(f"画布尺寸必须在 1–{MAX_SIDE} 像素范围内。")
    if x > 0 or y > 0 or x + width < source_width or y + height < source_height:
        raise ValueError("扩图画布必须完整包含原图，不能裁切原图。")
    if width * height * batch > MAX_BATCH_PIXELS:
        raise ValueError("画布与批次数的总像素超过 6400 万，请缩小画布或减少批次。")
    color = locked.get("color")
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("画布颜色必须是 #RRGGBB 格式。")
    rgb = [int(color[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    return x, y, width, height, rgb


class VisualCanvasExpand:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE",),
            "canvas_state": ("STRING", {"default": '{"version":1,"locked":null}', "multiline": False}),
        }}

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "expand"
    CATEGORY = "image/Visual Canvas"
    DESCRIPTION = "拖拽画布后确认。白色遮罩为新增区域，黑色为原图。取消或重置后才能重新确认。"

    def expand(self, image, canvas_state):
        if image.ndim != 4 or image.shape[-1] != 3 or not image.is_floating_point():
            raise ValueError("需要 ComfyUI RGB IMAGE 张量，形状为 [B,H,W,3]。")
        batch, source_height, source_width, channels = image.shape
        if batch < 1 or source_width < 1 or source_height < 1:
            raise ValueError("输入图片不能为空。")
        x, y, width, height, rgb = confirmed_settings(canvas_state, source_width, source_height, batch)
        # Every run uses locked, never draft. ComfyUI hashes canvas_state normally;
        # no process-global first-result cache and no IS_CHANGED override are needed.
        output = image.new_empty((batch, height, width, channels))
        output[:] = image.new_tensor(rgb)
        left, top = -x, -y
        output[:, top:top + source_height, left:left + source_width, :] = image
        mask = torch.ones((batch, height, width), device=image.device, dtype=image.dtype)
        mask[:, top:top + source_height, left:left + source_width] = 0
        return output, mask
