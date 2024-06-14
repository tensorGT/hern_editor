import base64
import io
import os
import shutil
import uuid
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

Image.MAX_IMAGE_PIXELS = 100_000_000  # Guard against decompression bombs

CACHE_DIR = Path(".picha_cache")
CACHE_DIR.mkdir(exist_ok=True)
PROXY_MAX_EDGE = 2048

HSL_CENTERS = {
    "red": 0.0,
    "orange": 30.0,
    "yellow": 60.0,
    "green": 120.0,
    "aqua": 180.0,
    "blue": 240.0,
    "purple": 280.0,
    "magenta": 320.0,
}


def _session_dir(image_id: str) -> Path:
    safe_id = "".join(c for c in image_id if c.isalnum() or c in "-_")
    return CACHE_DIR / safe_id


def _working_path(image_id: str) -> Path:
    return _session_dir(image_id) / "working.png"


def _proxy_path(image_id: str) -> Path:
    return _session_dir(image_id) / "proxy.png"


def _create_proxy(working_img: Image.Image, out_path: Path) -> Tuple[int, int]:
    w, h = working_img.size
    scale = min(1.0, PROXY_MAX_EDGE / max(w, h))
    if scale < 1.0:
        pw = max(1, int(round(w * scale)))
        ph = max(1, int(round(h * scale)))
        proxy = working_img.resize((pw, ph), Image.Resampling.LANCZOS)
    else:
        proxy = working_img
    proxy.save(out_path, format="PNG", optimize=False)
    return proxy.size


def save_uploaded_image(raw_bytes: bytes) -> Dict:
    image_id = uuid.uuid4().hex[:12]
    sdir = _session_dir(image_id)
    sdir.mkdir(parents=True, exist_ok=True)

    img = Image.open(io.BytesIO(raw_bytes))
    exif_summary = {}
    try:
        raw_exif = img.getexif()
        if raw_exif:
            for k, v in list(raw_exif.items())[:12]:
                exif_summary[str(k)] = str(v)[:64]
    except Exception:
        pass

    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")

    img.save(sdir / "original.png", format="PNG")
    img.save(_working_path(image_id), format="PNG")
    pw, ph = _create_proxy(img, _proxy_path(image_id))

    return {
        "image_id": image_id,
        "width": img.width,
        "height": img.height,
        "proxy_width": pw,
        "proxy_height": ph,
        "proxy_url": f"/api/proxy/{image_id}?v=0",
        "exif": exif_summary,
    }


def generate_sample_image() -> bytes:
    """Create a rich synthetic Kenyan sunset landscape if user wants to test fast."""
    w, h = 1600, 1067
    y = np.linspace(0.0, 1.0, h)[:, None]
    x = np.linspace(0.0, 1.0, w)[None, :]

    # Warm Rift Valley sunset sky gradient
    r = np.clip(0.95 * (1.0 - y * 0.7) + 0.25 * np.sin(x * 3.14), 0.0, 1.0)
    g = np.clip(0.55 * (1.0 - y * 1.1) + 0.15 * np.cos(x * 2.5), 0.0, 1.0)
    b = np.clip(0.32 * (1.0 - y * 1.3) + 0.38 * (1.0 - y), 0.0, 1.0)

    # Sun glow
    dist = np.sqrt((x - 0.62) ** 2 + ((y - 0.42) * (h / w)) ** 2)
    sun = np.exp(-dist * 12.0)
    r = np.clip(r + sun * 0.9, 0.0, 1.0)
    g = np.clip(g + sun * 0.75, 0.0, 1.0)
    b = np.clip(b + sun * 0.35, 0.0, 1.0)

    # Distant hills and savanna ground
    hill1 = 0.56 + 0.04 * np.sin(x * 7.0) + 0.02 * np.cos(x * 15.0)
    hill2 = 0.64 + 0.03 * np.sin(x * 5.0 + 1.2)
    mask1 = y > hill1
    mask2 = y > hill2

    r[mask1], g[mask1], b[mask1] = 0.18, 0.14, 0.20
    r[mask2], g[mask2], b[mask2] = 0.08, 0.07, 0.06

    arr = (np.stack([r, g, b], axis=-1) * 255).astype(np.uint8)
    img = Image.fromarray(arr, mode="RGB")
    draw = ImageDraw.Draw(img)

    # Acacia tree silhouette on the left
    tx, ty = 360, int(h * 0.65)
    draw.rectangle([tx - 10, ty - 140, tx + 10, ty + 60], fill=(16, 13, 12))
    draw.ellipse([tx - 150, ty - 190, tx + 150, ty - 120], fill=(16, 13, 12))
    draw.ellipse([tx - 95, ty - 225, tx + 115, ty - 155], fill=(16, 13, 12))

    # Small bright object on ground to test Magic Eraser
    draw.ellipse([1120, 820, 1175, 875], fill=(235, 220, 190))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=94)
    return buf.getvalue()


def reset_working_to_original(image_id: str) -> Dict:
    sdir = _session_dir(image_id)
    orig = sdir / "original.png"
    work = _working_path(image_id)
    shutil.copyfile(orig, work)
    img = Image.open(work)
    pw, ph = _create_proxy(img, _proxy_path(image_id))
    return {"width": img.width, "height": img.height, "proxy_width": pw, "proxy_height": ph}


def _save_and_refresh_proxy(image_id: str, img: Image.Image) -> Dict:
    img.save(_working_path(image_id), format="PNG")
    pw, ph = _create_proxy(img, _proxy_path(image_id))
    return {"width": img.width, "height": img.height, "proxy_width": pw, "proxy_height": ph}


def heavy_denoise(image_id: str, strength: float = 1.0) -> Dict:
    img = Image.open(_working_path(image_id))
    has_alpha = img.mode == "RGBA"
    alpha = img.getchannel("A") if has_alpha else None
    rgb = np.array(img.convert("RGB"))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    h_val = float(np.clip(6.0 * strength, 2.0, 18.0))
    denoised = cv2.fastNlMeansDenoisingColored(bgr, None, h_val, h_val, 7, 21)
    out = Image.fromarray(cv2.cvtColor(denoised, cv2.COLOR_BGR2RGB), mode="RGB")
    if alpha is not None:
        out = out.convert("RGBA")
        out.putalpha(alpha)
    return _save_and_refresh_proxy(image_id, out)


def heavy_upscale_2x(image_id: str) -> Dict:
    img = Image.open(_working_path(image_id))
    new_w, new_h = img.width * 2, img.height * 2
    if new_w * new_h > 64_000_000:
        raise ValueError("This image is too big for 2x upscale (max 64MP).")
    up = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    has_alpha = up.mode == "RGBA"
    alpha = up.getchannel("A") if has_alpha else None
    arr = np.array(up.convert("RGB")).astype(np.float32)
    blurred = cv2.GaussianBlur(arr, (0, 0), 1.2)
    sharpened = np.clip(arr + 0.45 * (arr - blurred), 0, 255).astype(np.uint8)
    out = Image.fromarray(sharpened, mode="RGB")
    if alpha is not None:
        out = out.convert("RGBA")
        out.putalpha(alpha)
    return _save_and_refresh_proxy(image_id, out)


def heavy_remove_bg(image_id: str) -> Dict:
    img = Image.open(_working_path(image_id)).convert("RGB")
    arr = np.array(img)
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]

    # Run GrabCut on a manageable working copy for speed, then upscale alpha
    scale = min(1.0, 800.0 / max(h, w))
    sw, sh = max(16, int(w * scale)), max(16, int(h * scale))
    small = cv2.resize(bgr, (sw, sh), interpolation=cv2.INTER_AREA)

    mask = np.zeros((sh, sw), np.uint8)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    margin_x = max(4, int(sw * 0.08))
    margin_y = max(4, int(sh * 0.08))
    rect = (margin_x, margin_y, sw - 2 * margin_x, sh - 2 * margin_y)
    cv2.grabCut(small, mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)

    fg_mask = np.where((mask == 2) | (mask == 0), 0, 255).astype(np.uint8)
    fg_mask = cv2.GaussianBlur(fg_mask, (7, 7), 0)
    full_alpha = cv2.resize(fg_mask, (w, h), interpolation=cv2.INTER_LINEAR)

    rgba = Image.fromarray(arr, mode="RGB").convert("RGBA")
    rgba.putalpha(Image.fromarray(full_alpha, mode="L"))
    return _save_and_refresh_proxy(image_id, rgba)


def heavy_inpaint(image_id: str, mask_data_url: str, radius: int = 5) -> Dict:
    img = Image.open(_working_path(image_id))
    has_alpha = img.mode == "RGBA"
    alpha = img.getchannel("A") if has_alpha else None
    rgb = np.array(img.convert("RGB"))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]

    if "," in mask_data_url:
        mask_data_url = mask_data_url.split(",", 1)[1]
    mask_bytes = base64.b64decode(mask_data_url)
    mask_img = Image.open(io.BytesIO(mask_bytes)).convert("L").resize((w, h), Image.Resampling.NEAREST)
    mask_arr = (np.array(mask_img) > 25).astype(np.uint8) * 255
    mask_arr = cv2.dilate(mask_arr, np.ones((5, 5), np.uint8), iterations=1)

    inpainted = cv2.inpaint(bgr, mask_arr, max(2, min(radius, 25)), cv2.INPAINT_TELEA)
    out = Image.fromarray(cv2.cvtColor(inpainted, cv2.COLOR_BGR2RGB), mode="RGB")
    if alpha is not None:
        out = out.convert("RGBA")
        out.putalpha(alpha)
    return _save_and_refresh_proxy(image_id, out)


def auto_enhance_suggest(image_id: str) -> Dict[str, float]:
    """Analyze image histogram and return suggested slider values."""
    img = Image.open(_proxy_path(image_id)).convert("RGB")
    arr = np.array(img).astype(np.float32) / 255.0
    luma = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]

    mean_l = float(np.mean(luma))
    p5, p95 = float(np.percentile(luma, 5)), float(np.percentile(luma, 95))

    exposure = float(np.clip((0.46 - mean_l) * 2.2, -1.2, 1.2))
    contrast = float(np.clip((0.75 - (p95 - p5)) * 55.0, -15.0, 35.0))

    # Gray-world white balance check
    mean_rgb = np.mean(arr, axis=(0, 1))
    avg = float(np.mean(mean_rgb)) + 1e-5
    temp = float(np.clip((mean_rgb[2] - mean_rgb[0]) / avg * 45.0, -35.0, 35.0))
    tint = float(np.clip((mean_rgb[1] - (mean_rgb[0] + mean_rgb[2]) * 0.5) / avg * 35.0, -25.0, 25.0))

    return {
        "exposure": round(exposure, 2),
        "contrast": round(contrast, 1),
        "highlights": -18.0 if p95 > 0.88 else 0.0,
        "shadows": 22.0 if p5 < 0.12 else 8.0,
        "temp": round(temp, 1),
        "tint": round(tint, 1),
        "vibrance": 16.0,
        "clarity": 12.0,
    }


def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, np.power(np.clip((c + 0.055) / 1.055, 0.0, None), 2.4))


def _linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def _eval_curve_lut(points: List[List[float]]) -> np.ndarray:
    pts = sorted(points, key=lambda p: p[0])
    xs = np.array([p[0] for p in pts], dtype=np.float32)
    ys = np.array([p[1] for p in pts], dtype=np.float32)
    grid = np.linspace(0.0, 1.0, 256, dtype=np.float32)
    return np.clip(np.interp(grid, xs, ys), 0.0, 1.0)


def _rgb_to_hsv_np(rgb: np.ndarray) -> np.ndarray:
    bgr = rgb[..., ::-1].astype(np.float32)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    # OpenCV HSV: H in [0..360] when float32, S in [0..1], V in [0..1]
    return hsv


def _hsv_to_rgb_np(hsv: np.ndarray) -> np.ndarray:
    bgr = cv2.cvtColor(hsv.astype(np.float32), cv2.COLOR_HSV2BGR)
    return np.clip(bgr[..., ::-1], 0.0, 1.0)


def _hsl_to_rgb_single(h_deg: float, s: float, l: float) -> np.ndarray:
    c = (1.0 - abs(2.0 * l - 1.0)) * s
    x = c * (1.0 - abs((h_deg / 60.0) % 2.0 - 1.0))
    m = l - c / 2.0
    if h_deg < 60:
        r, g, b = c, x, 0.0
    elif h_deg < 120:
        r, g, b = x, c, 0.0
    elif h_deg < 180:
        r, g, b = 0.0, c, x
    elif h_deg < 240:
        r, g, b = 0.0, x, c
    elif h_deg < 300:
        r, g, b = x, 0.0, c
    else:
        r, g, b = c, 0.0, x
    return np.array([r + m, g + m, b + m], dtype=np.float32)


def replay_full_res_export(req) -> Tuple[bytes, str, str]:
    edits = req.edits
    img = Image.open(_working_path(req.image_id))
    has_alpha = img.mode == "RGBA"
    alpha_img = img.getchannel("A") if has_alpha else None
    rgb_img = img.convert("RGB")

    # 1. Transforms (Flip, Rotate, Straighten, Crop)
    tr = edits.transform
    if tr.flip_h:
        rgb_img = ImageOps.mirror(rgb_img)
        if alpha_img:
            alpha_img = ImageOps.mirror(alpha_img)
    if tr.flip_v:
        rgb_img = ImageOps.flip(rgb_img)
        if alpha_img:
            alpha_img = ImageOps.flip(alpha_img)

    total_angle = -(tr.rotate_deg + tr.straighten_deg)
    if abs(total_angle) > 0.01:
        rgb_img = rgb_img.rotate(total_angle, resample=Image.Resampling.BICUBIC, expand=True)
        if alpha_img:
            alpha_img = alpha_img.rotate(total_angle, resample=Image.Resampling.BICUBIC, expand=True)

    c = tr.crop
    if c.w < 0.999 or c.h < 0.999 or c.x > 0.001 or c.y > 0.001:
        w, h = rgb_img.size
        left = int(round(np.clip(c.x, 0.0, 0.99) * w))
        top = int(round(np.clip(c.y, 0.0, 0.99) * h))
        right = int(round(np.clip(c.x + c.w, 0.01, 1.0) * w))
        bottom = int(round(np.clip(c.y + c.h, 0.01, 1.0) * h))
        if right > left + 2 and bottom > top + 2:
            rgb_img = rgb_img.crop((left, top, right, bottom))
            if alpha_img:
                alpha_img = alpha_img.crop((left, top, right, bottom))

    # Optional export resize
    if req.max_dimension and max(rgb_img.size) > req.max_dimension:
        scale = req.max_dimension / max(rgb_img.size)
        nw = max(1, int(round(rgb_img.width * scale)))
        nh = max(1, int(round(rgb_img.height * scale)))
        rgb_img = rgb_img.resize((nw, nh), Image.Resampling.LANCZOS)
        if alpha_img:
            alpha_img = alpha_img.resize((nw, nh), Image.Resampling.LANCZOS)

    # 2. Pixel Pipeline (Linear RGB)
    srgb = np.array(rgb_img, dtype=np.float32) / 255.0
    lin = _srgb_to_linear(srgb)

    # White Balance (Temp / Tint)
    t_val = edits.temp / 100.0
    n_val = edits.tint / 100.0
    wb_gains = np.array([1.0 + t_val * 0.28 + n_val * 0.12, 1.0 - n_val * 0.22, 1.0 - t_val * 0.28 + n_val * 0.12], dtype=np.float32)
    lin = lin * np.clip(wb_gains, 0.2, 3.0)

    # Exposure
    if abs(edits.exposure) > 1e-4:
        lin = lin * (2.0 ** edits.exposure)

    # Dehaze (simple atmospheric dark-channel style contrast boost)
    if abs(edits.dehaze) > 0.5:
        dh = edits.dehaze / 100.0
        lin = np.clip((lin - 0.04 * dh) / max(0.2, 1.0 - 0.18 * dh), 0.0, None)

    out_srgb = _linear_to_srgb(lin)

    # Contrast around mid-gray
    if abs(edits.contrast) > 0.5:
        cf = 1.0 + (edits.contrast / 100.0) * 0.85
        out_srgb = np.clip((out_srgb - 0.5) * cf + 0.5, 0.0, 1.0)

    # Highlights / Shadows / Whites / Blacks
    luma = 0.2126 * out_srgb[..., 0] + 0.7152 * out_srgb[..., 1] + 0.0722 * out_srgb[..., 2]
    if abs(edits.highlights) > 0.5:
        hl_mask = np.clip((luma - 0.5) * 2.0, 0.0, 1.0)[..., None]
        out_srgb = np.clip(out_srgb + hl_mask * (edits.highlights / 100.0) * 0.35, 0.0, 1.0)
    if abs(edits.shadows) > 0.5:
        sh_mask = np.clip((0.5 - luma) * 2.0, 0.0, 1.0)[..., None]
        out_srgb = np.clip(out_srgb + sh_mask * (edits.shadows / 100.0) * 0.38, 0.0, 1.0)
    if abs(edits.whites) > 0.5:
        w_mask = np.clip((luma - 0.75) * 4.0, 0.0, 1.0)[..., None]
        out_srgb = np.clip(out_srgb + w_mask * (edits.whites / 100.0) * 0.25, 0.0, 1.0)
    if abs(edits.blacks) > 0.5:
        b_mask = np.clip((0.25 - luma) * 4.0, 0.0, 1.0)[..., None]
        out_srgb = np.clip(out_srgb + b_mask * (edits.blacks / 100.0) * 0.25, 0.0, 1.0)

    # Clarity (unsharp midtone contrast)
    if abs(edits.clarity) > 0.5:
        blur_c = cv2.GaussianBlur(out_srgb, (0, 0), max(3.0, min(out_srgb.shape[:2]) * 0.015))
        out_srgb = np.clip(out_srgb + (out_srgb - blur_c) * (edits.clarity / 100.0) * 0.65, 0.0, 1.0)

    # Tone Curves
    lut_rgb = _eval_curve_lut(edits.curves.rgb)
    lut_r = _eval_curve_lut(edits.curves.r)
    lut_g = _eval_curve_lut(edits.curves.g)
    lut_b = _eval_curve_lut(edits.curves.b)
    idx = np.clip((out_srgb * 255.0).astype(np.int32), 0, 255)
    out_srgb[..., 0] = lut_rgb[np.clip((lut_r[idx[..., 0]] * 255.0).astype(np.int32), 0, 255)]
    out_srgb[..., 1] = lut_rgb[np.clip((lut_g[idx[..., 1]] * 255.0).astype(np.int32), 0, 255)]
    out_srgb[..., 2] = lut_rgb[np.clip((lut_b[idx[..., 2]] * 255.0).astype(np.int32), 0, 255)]

    # HSL Mixer
    if any(abs(ch.h) > 0.5 or abs(ch.s) > 0.5 or abs(ch.l) > 0.5 for ch in edits.hsl.values()):
        hsv = _rgb_to_hsv_np(out_srgb)
        h_deg = hsv[..., 0]
        for cname, ch in edits.hsl.items():
            if cname not in HSL_CENTERS or (abs(ch.h) < 0.5 and abs(ch.s) < 0.5 and abs(ch.l) < 0.5):
                continue
            center = HSL_CENTERS[cname]
            diff = np.abs((h_deg - center + 180.0) % 360.0 - 180.0)
            w_mask = np.clip(1.0 - diff / 35.0, 0.0, 1.0) * np.clip(hsv[..., 1] * 4.0, 0.0, 1.0)
            hsv[..., 0] = (hsv[..., 0] + w_mask * (ch.h * 0.45)) % 360.0
            hsv[..., 1] = np.clip(hsv[..., 1] * (1.0 + w_mask * (ch.s / 100.0)), 0.0, 1.0)
            hsv[..., 2] = np.clip(hsv[..., 2] + w_mask * (ch.l / 100.0) * 0.35, 0.0, 1.0)
        out_srgb = _hsv_to_rgb_np(hsv)

    # Vibrance & Saturation
    if abs(edits.vibrance) > 0.5 or abs(edits.saturation) > 0.5 or edits.bw:
        luma = (0.2126 * out_srgb[..., 0] + 0.7152 * out_srgb[..., 1] + 0.0722 * out_srgb[..., 2])[..., None]
        if edits.bw:
            out_srgb = np.repeat(luma, 3, axis=-1)
        else:
            sat_factor = 1.0 + edits.saturation / 100.0
            max_c = np.max(out_srgb, axis=-1, keepdims=True)
            min_c = np.min(out_srgb, axis=-1, keepdims=True)
            cur_sat = max_c - min_c
            vib_factor = (edits.vibrance / 100.0) * (1.0 - cur_sat)
            out_srgb = np.clip(luma + (out_srgb - luma) * (sat_factor + vib_factor), 0.0, 1.0)

    # Split Toning
    st = edits.split_tone
    if st.shadow_sat > 0.5 or st.highlight_sat > 0.5:
        luma = 0.2126 * out_srgb[..., 0] + 0.7152 * out_srgb[..., 1] + 0.0722 * out_srgb[..., 2]
        pivot = 0.5 - (st.balance / 200.0)
        sh_w = np.clip((pivot - luma) / max(0.05, pivot), 0.0, 1.0)[..., None] * (st.shadow_sat / 100.0) * 0.35
        hl_w = np.clip((luma - pivot) / max(0.05, 1.0 - pivot), 0.0, 1.0)[..., None] * (st.highlight_sat / 100.0) * 0.35
        sh_col = _hsl_to_rgb_single(st.shadow_hue, 1.0, 0.5)
        hl_col = _hsl_to_rgb_single(st.highlight_hue, 1.0, 0.5)
        out_srgb = np.clip(out_srgb * (1.0 - sh_w) + sh_col * sh_w, 0.0, 1.0)
        out_srgb = np.clip(out_srgb * (1.0 - hl_w) + hl_col * hl_w, 0.0, 1.0)

    # Blur & Sharpen
    if edits.blur > 0.2:
        out_srgb = cv2.GaussianBlur(out_srgb, (0, 0), edits.blur * 0.6)
    if edits.sharpen > 0.5:
        blur_s = cv2.GaussianBlur(out_srgb, (0, 0), 1.1)
        out_srgb = np.clip(out_srgb + (out_srgb - blur_s) * (edits.sharpen / 100.0) * 1.4, 0.0, 1.0)

    # Vignette
    if abs(edits.vignette) > 0.5:
        hh, ww = out_srgb.shape[:2]
        yy, xx = np.mgrid[0:hh, 0:ww]
        nx = (xx / max(1, ww - 1)) * 2.0 - 1.0
        ny = (yy / max(1, hh - 1)) * 2.0 - 1.0
        dist = np.sqrt(nx * nx + ny * ny)
        mid = edits.vignette_midpoint / 100.0
        vig = np.clip((dist - mid) / max(0.1, 1.45 - mid), 0.0, 1.0)[..., None]
        out_srgb = np.clip(out_srgb + vig * (edits.vignette / 100.0) * 0.75, 0.0, 1.0)

    # Film Grain
    if edits.grain > 0.5:
        rng = np.random.default_rng(42)
        noise = rng.normal(0.0, (edits.grain / 100.0) * 0.075, out_srgb.shape).astype(np.float32)
        out_srgb = np.clip(out_srgb + noise, 0.0, 1.0)

    final_img = Image.fromarray((out_srgb * 255.0).astype(np.uint8), mode="RGB")
    if alpha_img is not None and req.format.lower() in ("png", "webp"):
        final_img = final_img.convert("RGBA")
        final_img.putalpha(alpha_img)

    out_buf = io.BytesIO()
    fmt = req.format.lower()
    if fmt == "png":
        final_img.save(out_buf, format="PNG")
        return out_buf.getvalue(), "image/png", "picha_edited.png"
    if fmt == "webp":
        final_img.save(out_buf, format="WEBP", quality=req.quality)
        return out_buf.getvalue(), "image/webp", "picha_edited.webp"

    final_img.convert("RGB").save(out_buf, format="JPEG", quality=req.quality, optimize=True)
    return out_buf.getvalue(), "image/jpeg", "picha_edited.jpg"
