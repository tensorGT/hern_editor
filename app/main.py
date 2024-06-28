from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.models import ExportRequest, HeavyOpRequest, InpaintRequest
from app.processor import (
    _proxy_path,
    auto_enhance_suggest,
    generate_sample_image,
    heavy_denoise,
    heavy_inpaint,
    heavy_remove_bg,
    heavy_upscale_2x,
    replay_full_res_export,
    reset_working_to_original,
    save_uploaded_image,
)

app = FastAPI(title="Photo Editor API", version="0.1.0")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "message": "Python server is ready!"}


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="This file is empty.")
    try:
        return save_uploaded_image(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to open the photo: {exc}")


@app.post("/api/sample")
def load_sample() -> dict:
    raw = generate_sample_image()
    return save_uploaded_image(raw)


@app.get("/api/proxy/{image_id}")
def get_proxy(image_id: str):
    path = _proxy_path(image_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Proxy was not found.")
    return FileResponse(path, media_type="image/png")


@app.post("/api/reset/{image_id}")
def reset_image(image_id: str) -> dict:
    try:
        return reset_working_to_original(image_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Photo was not found.")


@app.post("/api/heavy/auto-enhance")
def api_auto_enhance(req: HeavyOpRequest) -> dict:
    try:
        return {"suggested": auto_enhance_suggest(req.image_id)}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Photo was not found.")


@app.post("/api/heavy/denoise")
def api_denoise(req: HeavyOpRequest) -> dict:
    try:
        return heavy_denoise(req.image_id, req.strength)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Photo was not found.")


@app.post("/api/heavy/upscale")
def api_upscale(req: HeavyOpRequest) -> dict:
    try:
        return heavy_upscale_2x(req.image_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Photo was not found.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/heavy/remove-bg")
def api_remove_bg(req: HeavyOpRequest) -> dict:
    try:
        return heavy_remove_bg(req.image_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Photo was not found.")


@app.post("/api/heavy/inpaint")
def api_inpaint(req: InpaintRequest) -> dict:
    try:
        return heavy_inpaint(req.image_id, req.mask_data_url, req.radius)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Photo was not found.")


@app.post("/api/export")
def api_export(req: ExportRequest):
    try:
        data, media_type, filename = replay_full_res_export(req)
        return Response(
            content=data,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Photo was not found.")


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
