from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class CropRect(BaseModel):
    x: float = 0.0
    y: float = 0.0
    w: float = 1.0
    h: float = 1.0
    mode: str = "rect"  # rect, circle, rounded


class TransformState(BaseModel):
    rotate_deg: float = 0.0
    straighten_deg: float = 0.0
    flip_h: bool = False
    flip_v: bool = False
    crop: CropRect = Field(default_factory=CropRect)


class ImageLayer(BaseModel):
    id: str
    data_url: str
    x: float = 0.5  # normalized center x (0..1)
    y: float = 0.5  # normalized center y (0..1)
    scale: float = 0.35  # relative to canvas width
    rotation: float = 0.0
    opacity: float = 1.0


class TextLayer(BaseModel):
    id: str
    text: str = "TOP TEXT"
    x: float = 0.5
    y: float = 0.15
    font_size: float = 0.06  # relative to image height
    color: str = "#ffffff"
    stroke: bool = True
    bg_mode: str = "none"  # none, solid, blur
    bg_color: str = "#000000"
    bg_opacity: float = 0.65
    padding: int = 14


class HSLChannel(BaseModel):
    h: float = 0.0
    s: float = 0.0
    l: float = 0.0


class SplitToneState(BaseModel):
    shadow_hue: float = 220.0
    shadow_sat: float = 0.0
    highlight_hue: float = 40.0
    highlight_sat: float = 0.0
    balance: float = 0.0


class CurvePoints(BaseModel):
    rgb: List[List[float]] = Field(default_factory=lambda: [[0.0, 0.0], [1.0, 1.0]])
    r: List[List[float]] = Field(default_factory=lambda: [[0.0, 0.0], [1.0, 1.0]])
    g: List[List[float]] = Field(default_factory=lambda: [[0.0, 0.0], [1.0, 1.0]])
    b: List[List[float]] = Field(default_factory=lambda: [[0.0, 0.0], [1.0, 1.0]])


class EditGraph(BaseModel):
    exposure: float = 0.0
    contrast: float = 0.0
    highlights: float = 0.0
    shadows: float = 0.0
    whites: float = 0.0
    blacks: float = 0.0
    temp: float = 0.0
    tint: float = 0.0
    vibrance: float = 0.0
    saturation: float = 0.0
    clarity: float = 0.0
    dehaze: float = 0.0
    vignette: float = 0.0
    vignette_midpoint: float = 50.0
    grain: float = 0.0
    sharpen: float = 0.0
    blur: float = 0.0
    bw: bool = False
    split_tone: SplitToneState = Field(default_factory=SplitToneState)
    hsl: Dict[str, HSLChannel] = Field(default_factory=dict)
    curves: CurvePoints = Field(default_factory=CurvePoints)
    transform: TransformState = Field(default_factory=TransformState)
    image_layers: List[ImageLayer] = Field(default_factory=list)
    text_layers: List[TextLayer] = Field(default_factory=list)


class ExportRequest(BaseModel):
    image_id: str
    edits: EditGraph
    format: str = "jpeg"
    quality: int = 92
    max_dimension: Optional[int] = None


class InpaintRequest(BaseModel):
    image_id: str
    mask_data_url: str
    radius: int = 5


class HeavyOpRequest(BaseModel):
    image_id: str
    strength: float = 1.0
