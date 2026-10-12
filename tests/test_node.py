import importlib.util
import json
from pathlib import Path
import unittest

import torch

spec = importlib.util.spec_from_file_location("visual_canvas_nodes", Path(__file__).parents[1] / "nodes.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def settings(x=-2, y=-1, width=8, height=6, color="#123456", **extra):
    locked = {"sourceWidth": 4, "sourceHeight": 3, "rect": {"x": x, "y": y, "width": width, "height": height}, "color": color}
    return json.dumps({"version": 1, "locked": locked, **extra})


class NodeTests(unittest.TestCase):
    def setUp(self):
        self.node = module.VisualCanvasExpand()
        self.image = torch.arange(2 * 3 * 4 * 3, dtype=torch.float32).reshape(2, 3, 4, 3) / 72

    def test_geometry_color_and_mask_for_batch(self):
        image, mask = self.node.expand(self.image, settings())
        self.assertEqual(tuple(image.shape), (2, 6, 8, 3))
        self.assertEqual(tuple(mask.shape), (2, 6, 8))
        self.assertTrue(torch.equal(image[:, 1:4, 2:6], self.image))
        self.assertTrue(torch.equal(image[0, 0, 0], torch.tensor([0x12, 0x34, 0x56]) / 255))
        self.assertEqual(mask.sum().item(), 2 * (6 * 8 - 3 * 4))
        self.assertTrue(torch.all(mask[:, 1:4, 2:6] == 0))
        self.assertEqual(image.dtype, self.image.dtype)
        self.assertEqual(image.device, self.image.device)
        self.assertTrue(torch.equal(self.image, torch.arange(72, dtype=torch.float32).reshape(2, 3, 4, 3) / 72))

    def test_lock_ignores_draft_and_repeated_execution(self):
        raw = settings(draft={"rect": {"width": 9999}, "color": "#ff0000"})
        first = self.node.expand(self.image, raw)
        for _ in range(3):
            for actual, expected in zip(self.node.expand(self.image, raw), first):
                self.assertTrue(torch.equal(actual, expected))

    def test_new_confirmation_replaces_old_result(self):
        self.node.expand(self.image, settings())
        image, mask = self.node.expand(self.image, settings(x=-1, y=-2, width=5, height=5, color="#ff0000"))
        self.assertEqual(tuple(image.shape), (2, 5, 5, 3))
        self.assertTrue(torch.equal(image[:, 2:5, 1:5], self.image))
        self.assertTrue(torch.equal(image[0, 0, 0], torch.tensor([1., 0., 0.])))
        self.assertEqual(mask.sum().item(), 26)

    def test_reset_has_identity_geometry(self):
        image, mask = self.node.expand(self.image, settings(x=0, y=0, width=4, height=3))
        self.assertTrue(torch.equal(image, self.image))
        self.assertTrue(torch.all(mask == 0))

    def test_no_confirmation_cannot_generate(self):
        for raw in ('{"version":1,"locked":null}', '{"version":1,"locked":null,"status":"cancelled"}'):
            with self.assertRaisesRegex(ValueError, "确认"):
                self.node.expand(self.image, raw)

    def test_source_dimensions_cannot_silently_change(self):
        with self.assertRaisesRegex(ValueError, "尺寸"):
            self.node.expand(torch.zeros((1, 4, 4, 3)), settings())

    def test_rejects_crop_invalid_sizes_and_color(self):
        bad = [settings(x=1), settings(y=1), settings(width=3), settings(height=2),
               settings(width=20000), settings(x=-20000), settings(width=0),
               settings(width=True), settings(color="#zz0000"), "null", "[]", "bad json",
               settings(x=-8000, y=-8000, width=16384, height=16384)]
        for raw in bad:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                self.node.expand(self.image, raw)

    def test_upstream_pixels_are_live_while_geometry_is_locked(self):
        changed = torch.ones_like(self.image)
        image, mask = self.node.expand(changed, settings())
        self.assertTrue(torch.equal(image[:, 1:4, 2:6], changed))
        self.assertEqual(mask.sum().item(), 72)


if __name__ == "__main__":
    unittest.main()
