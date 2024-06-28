# Hybrid Photo Editor

Welcome, this is a fast plug and play photo editor where the easy real-time sliders run straight on your browser GPU (HTML5 + WebGL2 + JS) and the heavy work runs on Python (FastAPI + OpenCV + Pillow + NumPy).

No Redis, no Docker, no Node build step, no stress. Just start the server in terminal and start editing your photos.

## Stack & Versions (June 2024)
- Python 3.12+
- FastAPI 0.111.0 + Uvicorn 0.30.1
- OpenCV 4.10.0.84 + Pillow 10.3.0 + NumPy 1.26.4
- Frontend: Vanilla JS, WebGL2 Fragment Shaders, Canvas 2D

## How to Run
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Start this badboi:
   ```bash
   python run.py
   ```
3. Open your browser at `http://127.0.0.1:8000` and drop your photo here!

## What Runs Where
- **Browser (JS + WebGL2, 60fps):** Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Temp/Tint, Vibrance, Saturation, Clarity, Dehaze, RGB/Channel Tone Curve, 8-Channel HSL Mixer, Split Toning, Vignette, Grain, Sharpen, Blur, Crop & Straighten, Live Histogram, Before/After Compare, Undo/Redo.
- **Python Server (Heavy Ops & Full-Res Export):** EXIF orientation normalization, Full-Res non-destructive Edit Graph export (JPEG/PNG/WebP), Auto-Enhance (CLAHE + Gray-World WB), Heavy Denoise (`fastNlMeansDenoisingColored`), 2x Detail Upscale, Magic Eraser (Inpainting via mask), Background Removal (GrabCut).
