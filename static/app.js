// Hybrid Photo Editor Frontend Controller

(function () {
  const SLIDER_CONFIG = {
    tone: [
      { key: "exposure", label: "Exposure (EV)", min: -3.0, max: 3.0, step: 0.05, def: 0 },
      { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, def: 0 },
      { key: "highlights", label: "Highlights", min: -100, max: 100, step: 1, def: 0 },
      { key: "shadows", label: "Shadows", min: -100, max: 100, step: 1, def: 0 },
      { key: "whites", label: "Whites", min: -100, max: 100, step: 1, def: 0 },
      { key: "blacks", label: "Blacks", min: -100, max: 100, step: 1, def: 0 },
      { key: "clarity", label: "Clarity", min: -100, max: 100, step: 1, def: 0 },
      { key: "dehaze", label: "Dehaze", min: -100, max: 100, step: 1, def: 0 },
    ],
    color: [
      { key: "temp", label: "Temp (WB)", min: -100, max: 100, step: 1, def: 0 },
      { key: "tint", label: "Tint (WB)", min: -100, max: 100, step: 1, def: 0 },
      { key: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1, def: 0 },
      { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, def: 0 },
    ],
    fx: [
      { key: "sharpen", label: "Sharpen (USM)", min: 0, max: 100, step: 1, def: 0 },
      { key: "blur", label: "Gaussian Blur", min: 0, max: 20, step: 0.5, def: 0 },
      { key: "vignette", label: "Vignette", min: -100, max: 100, step: 1, def: 0 },
      { key: "vignette_midpoint", label: "Vignette Midpoint", min: 10, max: 90, step: 1, def: 50 },
      { key: "grain", label: "Film Grain", min: 0, max: 100, step: 1, def: 0 },
    ],
  };

  function defaultEdits() {
    return {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
      temp: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, dehaze: 0,
      vignette: 0, vignette_midpoint: 50, grain: 0, sharpen: 0, blur: 0, bw: false,
      split_tone: { shadow_hue: 220, shadow_sat: 0, highlight_hue: 40, highlight_sat: 0, balance: 0 },
      hsl: {
        red: { h: 0, s: 0, l: 0 }, orange: { h: 0, s: 0, l: 0 },
        yellow: { h: 0, s: 0, l: 0 }, green: { h: 0, s: 0, l: 0 },
        aqua: { h: 0, s: 0, l: 0 }, blue: { h: 0, s: 0, l: 0 },
        purple: { h: 0, s: 0, l: 0 }, magenta: { h: 0, s: 0, l: 0 },
      },
      curves: {
        rgb: [[0, 0], [1, 1]],
        r: [[0, 0], [1, 1]],
        g: [[0, 0], [1, 1]],
        b: [[0, 0], [1, 1]],
      },
      transform: {
        rotate_deg: 0, straighten_deg: 0, flip_h: false, flip_v: false,
        crop: { x: 0, y: 0, w: 1, h: 1, mode: "rect" },
      },
      image_layers: [],
      text_layers: [],
    };
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  const state = {
    imageId: null,
    origWidth: 0,
    origHeight: 0,
    edits: defaultEdits(),
    history: [],
    historyIdx: -1,
    activeTool: "move",
    activeCurveCh: "rgb",
    activeHslCh: "red",
    selectedImgId: null,
    selectedTxtId: null,
    brushSize: 28,
    view: { zoom: 1, panX: 0, panY: 0, compareOriginal: false, showClipping: false },
  };

  // Cache decoded HTMLImageElement objects for collage layers
  const collageImgCache = new Map();

  // DOM refs
  const workspaceEl = document.getElementById("workspace");
  const glCanvas = document.getElementById("gl-canvas");
  const overlayCanvas = document.getElementById("overlay-canvas");
  const overlayCtx = overlayCanvas.getContext("2d");
  const histCanvas = document.getElementById("histogram-canvas");
  const curveCanvas = document.getElementById("curve-canvas");
  const viewportEl = document.getElementById("viewport");
  const emptyState = document.getElementById("empty-state");
  const canvasStage = document.getElementById("canvas-stage");
  const zoomPill = document.getElementById("zoom-pill");
  const toastEl = document.getElementById("status-toast");

  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");

  let glEngine = null;
  try {
    glEngine = new PichaWebGL(glCanvas);
  } catch (err) {
    alert(err.message);
  }

  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  function pushHistory() {
    state.history = state.history.slice(0, state.historyIdx + 1);
    state.history.push(deepClone(state.edits));
    if (state.history.length > 60) state.history.shift();
    state.historyIdx = state.history.length - 1;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    document.getElementById("btn-undo").disabled = state.historyIdx <= 0;
    document.getElementById("btn-redo").disabled = state.historyIdx >= state.history.length - 1;
    const total = Math.max(0, state.history.length - 1);
    const current = Math.max(0, state.historyIdx);
    document.getElementById("history-badge").textContent = `${current}/${total}`;
  }

  function undo() {
    if (state.historyIdx > 0) {
      state.historyIdx--;
      state.edits = deepClone(state.history[state.historyIdx]);
      syncUIFromState();
      scheduleRender(true);
      updateHistoryButtons();
      showToast(state.historyIdx === 0 ? "Back to original!" : `Reset last action (${state.historyIdx}/${state.history.length - 1})`);
    }
  }

  function redo() {
    if (state.historyIdx < state.history.length - 1) {
      state.historyIdx++;
      state.edits = deepClone(state.history[state.historyIdx]);
      syncUIFromState();
      scheduleRender(true);
      updateHistoryButtons();
    }
  }

  // Collapsible Toolbars
  document.getElementById("btn-toggle-left").addEventListener("click", () => {
    workspaceEl.classList.toggle("left-collapsed");
    setTimeout(resizeCanvases, 30);
  });
  document.getElementById("btn-toggle-right").addEventListener("click", () => {
    workspaceEl.classList.toggle("right-collapsed");
    setTimeout(resizeCanvases, 30);
  });
  if (window.innerWidth <= 960) {
    workspaceEl.classList.add("left-collapsed", "right-collapsed");
  }

  // Curve LUT evaluation
  function evalCurveLUT(pts) {
    const sorted = [...pts].sort((a, b) => a[0] - b[0]);
    const lut = new Float32Array(256);
    let idx = 0;
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      while (idx < sorted.length - 2 && x > sorted[idx + 1][0]) idx++;
      const p0 = sorted[idx];
      const p1 = sorted[Math.min(sorted.length - 1, idx + 1)];
      const dx = Math.max(1e-5, p1[0] - p0[0]);
      const t = Math.max(0, Math.min(1, (x - p0[0]) / dx));
      lut[i] = Math.max(0, Math.min(1, p0[1] + t * (p1[1] - p0[1])));
    }
    return lut;
  }

  function syncCurvesToGPU() {
    if (!glEngine) return;
    glEngine.updateCurveLUT(
      evalCurveLUT(state.edits.curves.r),
      evalCurveLUT(state.edits.curves.g),
      evalCurveLUT(state.edits.curves.b),
      evalCurveLUT(state.edits.curves.rgb)
    );
  }

  let renderQueued = false;
  let histTimer = null;
  function scheduleRender(updateHist = false) {
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        if (glEngine && state.imageId) {
          syncCurvesToGPU();
          glEngine.render(state.edits, state.view);
          drawOverlay();
        }
      });
    }
    if (updateHist && state.imageId) {
      clearTimeout(histTimer);
      histTimer = setTimeout(drawHistogram, 90);
    }
  }

  function drawHistogram() {
    if (!glEngine || !state.imageId) return;
    const ctx = histCanvas.getContext("2d");
    const w = histCanvas.width;
    const h = histCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const tmp = document.createElement("canvas");
    tmp.width = 160;
    tmp.height = 90;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(glCanvas, 0, 0, glCanvas.width, glCanvas.height, 0, 0, 160, 90);
    const pixels = tctx.getImageData(0, 0, 160, 90).data;

    const rBins = new Uint32Array(64);
    const gBins = new Uint32Array(64);
    const bBins = new Uint32Array(64);
    for (let i = 0; i < pixels.length; i += 4) {
      rBins[pixels[i] >> 2]++;
      gBins[pixels[i + 1] >> 2]++;
      bBins[pixels[i + 2] >> 2]++;
    }
    let maxVal = 1;
    for (let i = 1; i < 63; i++) maxVal = Math.max(maxVal, rBins[i], gBins[i], bBins[i]);

    ctx.globalCompositeOperation = "screen";
    const drawChannel = (bins, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < 64; i++) {
        ctx.lineTo((i / 63) * w, h - Math.min(1, bins[i] / maxVal) * (h - 4));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    };
    drawChannel(rBins, "rgba(239, 68, 68, 0.65)");
    drawChannel(gBins, "rgba(34, 197, 94, 0.65)");
    drawChannel(bBins, "rgba(59, 130, 246, 0.65)");
    ctx.globalCompositeOperation = "source-over";
  }

  function resizeCanvases() {
    const rect = viewportEl.getBoundingClientRect();
    glCanvas.width = Math.max(1, Math.floor(rect.width));
    glCanvas.height = Math.max(1, Math.floor(rect.height));
    overlayCanvas.width = glCanvas.width;
    overlayCanvas.height = glCanvas.height;
    scheduleRender(false);
  }
  window.addEventListener("resize", resizeCanvases);

  // Build Sliders UI
  function buildSliders() {
    Object.entries(SLIDER_CONFIG).forEach(([group, items]) => {
      const container = document.querySelector(`[data-sliders="${group}"]`);
      container.innerHTML = "";
      items.forEach((cfg) => {
        const row = document.createElement("div");
        row.className = "slider-row";
        row.innerHTML = `
          <div class="slider-meta">
            <span>${cfg.label}</span>
            <span class="slider-val" id="val-${cfg.key}">${cfg.def}</span>
          </div>
          <input type="range" id="sl-${cfg.key}" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${cfg.def}" />
        `;
        const input = row.querySelector("input");
        input.addEventListener("input", () => {
          const val = parseFloat(input.value);
          state.edits[cfg.key] = val;
          document.getElementById(`val-${cfg.key}`).textContent = val;
          scheduleRender(true);
        });
        input.addEventListener("change", () => pushHistory());
        input.addEventListener("dblclick", () => {
          input.value = cfg.def;
          state.edits[cfg.key] = cfg.def;
          document.getElementById(`val-${cfg.key}`).textContent = cfg.def;
          pushHistory();
          scheduleRender(true);
        });
        container.appendChild(row);
      });
    });

    const hslContainer = document.getElementById("hsl-sliders");
    ["h", "s", "l"].forEach((prop) => {
      const labelMap = { h: "Hue", s: "Saturation", l: "Luminance" };
      const row = document.createElement("div");
      row.className = "slider-row";
      row.innerHTML = `
        <div class="slider-meta">
          <span>${labelMap[prop]}</span>
          <span class="slider-val" id="val-hsl-${prop}">0</span>
        </div>
        <input type="range" id="sl-hsl-${prop}" min="-100" max="100" step="1" value="0" />
      `;
      const input = row.querySelector("input");
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        state.edits.hsl[state.activeHslCh][prop] = v;
        document.getElementById(`val-hsl-${prop}`).textContent = v;
        scheduleRender(true);
      });
      input.addEventListener("change", () => pushHistory());
      hslContainer.appendChild(row);
    });

    const splitContainer = document.getElementById("split-sliders");
    const splitItems = [
      { key: "shadow_hue", label: "Shadow Hue", min: 0, max: 360, def: 220 },
      { key: "shadow_sat", label: "Shadow Sat", min: 0, max: 100, def: 0 },
      { key: "highlight_hue", label: "Highlight Hue", min: 0, max: 360, def: 40 },
      { key: "highlight_sat", label: "Highlight Sat", min: 0, max: 100, def: 0 },
      { key: "balance", label: "Balance", min: -100, max: 100, def: 0 },
    ];
    splitItems.forEach((cfg) => {
      const row = document.createElement("div");
      row.className = "slider-row";
      row.innerHTML = `
        <div class="slider-meta">
          <span>${cfg.label}</span>
          <span class="slider-val" id="val-st-${cfg.key}">${cfg.def}</span>
        </div>
        <input type="range" id="sl-st-${cfg.key}" min="${cfg.min}" max="${cfg.max}" step="1" value="${cfg.def}" />
      `;
      const input = row.querySelector("input");
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        state.edits.split_tone[cfg.key] = v;
        document.getElementById(`val-st-${cfg.key}`).textContent = v;
        scheduleRender(true);
      });
      input.addEventListener("change", () => pushHistory());
      splitContainer.appendChild(row);
    });
  }

  function syncUIFromState() {
    Object.values(SLIDER_CONFIG).flat().forEach((cfg) => {
      const val = state.edits[cfg.key];
      const inp = document.getElementById(`sl-${cfg.key}`);
      const lbl = document.getElementById(`val-${cfg.key}`);
      if (inp) inp.value = val;
      if (lbl) lbl.textContent = val;
    });

    const hsl = state.edits.hsl[state.activeHslCh] || { h: 0, s: 0, l: 0 };
    ["h", "s", "l"].forEach((p) => {
      document.getElementById(`sl-hsl-${p}`).value = hsl[p];
      document.getElementById(`val-hsl-${p}`).textContent = hsl[p];
    });

    Object.entries(state.edits.split_tone).forEach(([k, v]) => {
      const inp = document.getElementById(`sl-st-${k}`);
      const lbl = document.getElementById(`val-st-${k}`);
      if (inp) inp.value = v;
      if (lbl) lbl.textContent = v;
    });

    document.getElementById("straighten-slider").value = state.edits.transform.straighten_deg;
    document.getElementById("val-straighten").textContent = state.edits.transform.straighten_deg;
    document.getElementById("crop-mode").value = state.edits.transform.crop.mode || "rect";
    document.getElementById("zoom-label").textContent = `${Math.round(state.view.zoom * 100)}%`;

    syncLayerPanels();
    drawCurveEditor();
  }

  function syncLayerPanels() {
    const imgL = state.edits.image_layers.find((l) => l.id === state.selectedImgId);
    const imgProps = document.getElementById("collage-layer-props");
    if (imgL) {
      imgProps.style.display = "block";
      document.getElementById("img-scale").value = Math.round(imgL.scale * 100);
      document.getElementById("val-img-scale").textContent = Math.round(imgL.scale * 100);
      document.getElementById("img-rot").value = Math.round(imgL.rotation);
      document.getElementById("val-img-rot").textContent = Math.round(imgL.rotation);
      document.getElementById("img-op").value = Math.round(imgL.opacity * 100);
      document.getElementById("val-img-op").textContent = Math.round(imgL.opacity * 100);
    } else {
      imgProps.style.display = "none";
    }

    const txtL = state.edits.text_layers.find((l) => l.id === state.selectedTxtId);
    const txtProps = document.getElementById("text-layer-props");
    if (txtL) {
      txtProps.style.display = "block";
      document.getElementById("txt-content").value = txtL.text;
      document.getElementById("txt-size").value = Math.round(txtL.font_size * 1000) / 10;
      document.getElementById("val-txt-size").textContent = Math.round(txtL.font_size * 1000) / 10;
      document.getElementById("txt-color").value = txtL.color;
      document.getElementById("txt-stroke").checked = txtL.stroke;
      document.getElementById("txt-bg-mode").value = txtL.bg_mode;
      document.getElementById("txt-bg-solid-opts").style.display = txtL.bg_mode === "solid" ? "block" : "none";
      document.getElementById("txt-bg-color").value = txtL.bg_color;
      document.getElementById("txt-bg-op").value = Math.round(txtL.bg_opacity * 100);
      document.getElementById("val-txt-bg-op").textContent = Math.round(txtL.bg_opacity * 100);
    } else {
      txtProps.style.display = "none";
    }
  }

  // Interactive Tone Curve Editor
  let dragCurveIdx = -1;
  function drawCurveEditor() {
    const ctx = curveCanvas.getContext("2d");
    const w = curveCanvas.width;
    const h = curveCanvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "#252530";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((w * i) / 4, 0);
      ctx.lineTo((w * i) / 4, h);
      ctx.moveTo(0, (h * i) / 4);
      ctx.lineTo(w, (h * i) / 4);
      ctx.stroke();
    }

    const pts = [...state.edits.curves[state.activeCurveCh]].sort((a, b) => a[0] - b[0]);
    const colorMap = { rgb: "#f59e0b", r: "#ef4444", g: "#22c55e", b: "#3b82f6" };
    ctx.strokeStyle = colorMap[state.activeCurveCh];
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, idx) => {
      const x = p[0] * w;
      const y = (1 - p[1]) * h;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    pts.forEach((p) => {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p[0] * w, (1 - p[1]) * h, 4.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  curveCanvas.addEventListener("mousedown", (e) => {
    const rect = curveCanvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    const pts = state.edits.curves[state.activeCurveCh];
    dragCurveIdx = pts.findIndex((p) => Math.hypot(p[0] - nx, p[1] - ny) < 0.06);
    if (dragCurveIdx === -1) {
      pts.push([nx, ny]);
      pts.sort((a, b) => a[0] - b[0]);
      dragCurveIdx = pts.findIndex((p) => p[0] === nx && p[1] === ny);
    }
    drawCurveEditor();
    scheduleRender(true);
  });

  window.addEventListener("mousemove", (e) => {
    if (dragCurveIdx === -1) return;
    const rect = curveCanvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    const pts = state.edits.curves[state.activeCurveCh];
    if (dragCurveIdx === 0) pts[0][1] = ny;
    else if (dragCurveIdx === pts.length - 1) pts[pts.length - 1][1] = ny;
    else pts[dragCurveIdx] = [nx, ny];
    drawCurveEditor();
    scheduleRender(true);
  });

  window.addEventListener("mouseup", () => {
    if (dragCurveIdx !== -1) {
      dragCurveIdx = -1;
      pushHistory();
    }
  });

  curveCanvas.addEventListener("dblclick", (e) => {
    const rect = curveCanvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = 1 - (e.clientY - rect.top) / rect.height;
    const pts = state.edits.curves[state.activeCurveCh];
    const idx = pts.findIndex((p, i) => i > 0 && i < pts.length - 1 && Math.hypot(p[0] - nx, p[1] - ny) < 0.07);
    if (idx !== -1) {
      pts.splice(idx, 1);
      drawCurveEditor();
      pushHistory();
      scheduleRender(true);
    }
  });

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) || 0;
    const g = parseInt(h.slice(2, 4), 16) || 0;
    const b = parseInt(h.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Overlay Drawing: Crop Shape Mask, Collage Images, Meme Text, Eraser Mask
  let cropBox = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  function drawOverlay() {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!glEngine || !state.imageId) return;
    const rect = glEngine.getImageScreenRect(state.edits, state.view);

    // 1. Crop Shape Preview (Circle / Rounded)
    const cropMode = state.edits.transform.crop.mode || "rect";
    if (cropMode !== "rect" && !state.view.compareOriginal) {
      overlayCtx.save();
      overlayCtx.fillStyle = "rgba(17, 17, 21, 0.82)";
      overlayCtx.beginPath();
      overlayCtx.rect(rect.x, rect.y, rect.w, rect.h);
      if (cropMode === "circle") {
        overlayCtx.ellipse(rect.x + rect.w * 0.5, rect.y + rect.h * 0.5, rect.w * 0.5, rect.h * 0.5, 0, 0, Math.PI * 2, true);
      } else {
        const rad = Math.max(8, Math.min(rect.w, rect.h) * 0.08);
        overlayCtx.roundRect(rect.x, rect.y, rect.w, rect.h, rad);
      }
      overlayCtx.fill("evenodd");
      overlayCtx.restore();
    }

    // 2. Collage Image Layers
    if (!state.view.compareOriginal) {
      state.edits.image_layers.forEach((layer) => {
        const img = collageImgCache.get(layer.id);
        if (!img) return;
        const dw = rect.w * layer.scale;
        const dh = dw * (img.naturalHeight / Math.max(1, img.naturalWidth));
        const cx = rect.x + layer.x * rect.w;
        const cy = rect.y + layer.y * rect.h;
        overlayCtx.save();
        overlayCtx.globalAlpha = layer.opacity;
        overlayCtx.translate(cx, cy);
        overlayCtx.rotate((layer.rotation * Math.PI) / 180);
        overlayCtx.drawImage(img, -dw * 0.5, -dh * 0.5, dw, dh);
        if (state.activeTool === "collage" && layer.id === state.selectedImgId) {
          overlayCtx.strokeStyle = "#f59e0b";
          overlayCtx.lineWidth = 2;
          overlayCtx.strokeRect(-dw * 0.5, -dh * 0.5, dw, dh);
        }
        overlayCtx.restore();
      });

      // 3. Meme / Text Layers
      state.edits.text_layers.forEach((tl) => {
        if (!tl.text.trim()) return;
        const pxSize = Math.max(12, rect.h * tl.font_size);
        overlayCtx.save();
        overlayCtx.font = `900 ${pxSize}px Impact, "Arial Black", sans-serif`;
        overlayCtx.textAlign = "center";
        overlayCtx.textBaseline = "middle";

        const lines = tl.text.split("\n");
        const lineH = pxSize * 1.15;
        let maxW = 0;
        lines.forEach((ln) => (maxW = Math.max(maxW, overlayCtx.measureText(ln).width)));
        const boxW = maxW + tl.padding * 2;
        const boxH = lines.length * lineH + tl.padding * 1.4;
        const cx = rect.x + tl.x * rect.w;
        const cy = rect.y + tl.y * rect.h;
        const bx = cx - boxW * 0.5;
        const by = cy - boxH * 0.5;

        if (tl.bg_mode === "blur") {
          overlayCtx.save();
          overlayCtx.beginPath();
          overlayCtx.roundRect(bx, by, boxW, boxH, 8);
          overlayCtx.clip();
          overlayCtx.filter = "blur(10px)";
          overlayCtx.drawImage(glCanvas, 0, 0);
          overlayCtx.filter = "none";
          overlayCtx.fillStyle = "rgba(0,0,0,0.18)";
          overlayCtx.fillRect(bx, by, boxW, boxH);
          overlayCtx.restore();
        } else if (tl.bg_mode === "solid") {
          overlayCtx.fillStyle = hexToRgba(tl.bg_color, tl.bg_opacity);
          overlayCtx.beginPath();
          overlayCtx.roundRect(bx, by, boxW, boxH, 8);
          overlayCtx.fill();
        }

        const startY = cy - ((lines.length - 1) * lineH) * 0.5;
        lines.forEach((ln, i) => {
          const ly = startY + i * lineH;
          if (tl.stroke) {
            overlayCtx.lineWidth = Math.max(2, pxSize / 10);
            overlayCtx.strokeStyle = "#000000";
            overlayCtx.lineJoin = "round";
            overlayCtx.strokeText(ln, cx, ly);
          }
          overlayCtx.fillStyle = tl.color;
          overlayCtx.fillText(ln, cx, ly);
        });

        if (state.activeTool === "text" && tl.id === state.selectedTxtId) {
          overlayCtx.strokeStyle = "#f59e0b";
          overlayCtx.lineWidth = 1.5;
          overlayCtx.strokeRect(bx - 2, by - 2, boxW + 4, boxH + 4);
        }
        overlayCtx.restore();
      });
    }

    // 4. Eraser Mask or Crop Box
    if (state.activeTool === "erase") {
      overlayCtx.save();
      overlayCtx.globalAlpha = 0.55;
      overlayCtx.drawImage(maskCanvas, rect.x, rect.y, rect.w, rect.h);
      overlayCtx.restore();
    } else if (state.activeTool === "crop") {
      const cx = rect.x + cropBox.x * rect.w;
      const cy = rect.y + cropBox.y * rect.h;
      const cw = cropBox.w * rect.w;
      const ch = cropBox.h * rect.h;

      overlayCtx.fillStyle = "rgba(0,0,0,0.55)";
      overlayCtx.fillRect(rect.x, rect.y, rect.w, cy - rect.y);
      overlayCtx.fillRect(rect.x, cy + ch, rect.w, rect.y + rect.h - (cy + ch));
      overlayCtx.fillRect(rect.x, cy, cx - rect.x, ch);
      overlayCtx.fillRect(cx + cw, cy, rect.x + rect.w - (cx + cw), ch);

      overlayCtx.strokeStyle = "#f59e0b";
      overlayCtx.lineWidth = 2;
      if (cropMode === "circle") {
        overlayCtx.beginPath();
        overlayCtx.ellipse(cx + cw * 0.5, cy + ch * 0.5, cw * 0.5, ch * 0.5, 0, 0, Math.PI * 2);
        overlayCtx.stroke();
      } else {
        overlayCtx.strokeRect(cx, cy, cw, ch);
      }

      overlayCtx.strokeStyle = "rgba(255,255,255,0.35)";
      overlayCtx.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        overlayCtx.beginPath();
        overlayCtx.moveTo(cx + (cw * i) / 3, cy);
        overlayCtx.lineTo(cx + (cw * i) / 3, cy + ch);
        overlayCtx.moveTo(cx, cy + (ch * i) / 3);
        overlayCtx.lineTo(cx + cw, cy + (ch * i) / 3);
        overlayCtx.stroke();
      }
    }
  }

  // Viewport Mouse Interactions
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let cropDragStart = null;
  let draggingLayer = null;

  overlayCanvas.addEventListener("mousedown", (e) => {
    if (!state.imageId) return;
    isDragging = true;
    const rect = overlayCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    dragStart = { x: mx, y: my, panX: state.view.panX, panY: state.view.panY };
    const imgRect = glEngine.getImageScreenRect(state.edits, state.view);
    const nx = (mx - imgRect.x) / imgRect.w;
    const ny = (my - imgRect.y) / imgRect.h;

    if (state.activeTool === "erase") {
      paintMaskAt(mx, my);
    } else if (state.activeTool === "crop") {
      cropDragStart = { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)) };
    } else if (state.activeTool === "collage") {
      // Pick closest collage layer
      let found = null;
      let best = 0.25;
      state.edits.image_layers.forEach((l) => {
        const d = Math.hypot(l.x - nx, l.y - ny);
        if (d < best) { best = d; found = l; }
      });
      if (found) {
        state.selectedImgId = found.id;
        draggingLayer = { type: "img", layer: found, ox: found.x - nx, oy: found.y - ny };
        syncLayerPanels();
        drawOverlay();
      }
    } else if (state.activeTool === "text") {
      let found = null;
      let best = 0.25;
      state.edits.text_layers.forEach((l) => {
        const d = Math.hypot(l.x - nx, l.y - ny);
        if (d < best) { best = d; found = l; }
      });
      if (found) {
        state.selectedTxtId = found.id;
        draggingLayer = { type: "txt", layer: found, ox: found.x - nx, oy: found.y - ny };
        syncLayerPanels();
        drawOverlay();
      }
    }
  });

  overlayCanvas.addEventListener("mousemove", (e) => {
    if (!isDragging || !state.imageId) return;
    const rect = overlayCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const imgRect = glEngine.getImageScreenRect(state.edits, state.view);
    const nx = (mx - imgRect.x) / imgRect.w;
    const ny = (my - imgRect.y) / imgRect.h;

    if (state.activeTool === "move") {
      state.view.panX = dragStart.panX + (mx - dragStart.x);
      state.view.panY = dragStart.panY + (my - dragStart.y);
      scheduleRender(false);
    } else if (state.activeTool === "erase") {
      paintMaskAt(mx, my);
    } else if (draggingLayer) {
      draggingLayer.layer.x = Math.max(0, Math.min(1, nx + draggingLayer.ox));
      draggingLayer.layer.y = Math.max(0, Math.min(1, ny + draggingLayer.oy));
      drawOverlay();
    } else if (state.activeTool === "crop" && cropDragStart) {
      const cnx = Math.max(0, Math.min(1, nx));
      const cny = Math.max(0, Math.min(1, ny));
      let x = Math.min(cropDragStart.nx, cnx);
      let y = Math.min(cropDragStart.ny, cny);
      let w = Math.max(0.05, Math.abs(cnx - cropDragStart.nx));
      let h = Math.max(0.05, Math.abs(cny - cropDragStart.ny));
      const aspect = document.getElementById("crop-aspect").value;
      if (aspect !== "free") {
        const ratio = parseFloat(aspect) / (imgRect.w / imgRect.h);
        h = Math.min(1 - y, w / ratio);
      }
      cropBox = { x, y, w, h };
      drawOverlay();
    }
  });

  window.addEventListener("mouseup", () => {
    if (!isDragging) return;
    isDragging = false;
    if (draggingLayer) {
      draggingLayer = null;
      pushHistory();
    }
    if (state.activeTool === "crop" && cropDragStart) {
      cropDragStart = null;
      const cur = state.edits.transform.crop;
      state.edits.transform.crop = {
        x: cur.x + cropBox.x * cur.w,
        y: cur.y + cropBox.y * cur.h,
        w: cropBox.w * cur.w,
        h: cropBox.h * cur.h,
        mode: cur.mode || "rect",
      };
      cropBox = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
      pushHistory();
      setTool("move");
      scheduleRender(true);
    }
  });

  overlayCanvas.addEventListener("wheel", (e) => {
    if (!state.imageId) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    state.view.zoom = Math.max(0.2, Math.min(8.0, state.view.zoom * factor));
    document.getElementById("zoom-label").textContent = `${Math.round(state.view.zoom * 100)}%`;
    scheduleRender(false);
  }, { passive: false });

  function paintMaskAt(mx, my) {
    const imgRect = glEngine.getImageScreenRect(state.edits, state.view);
    const ix = ((mx - imgRect.x) / imgRect.w) * maskCanvas.width;
    const iy = ((my - imgRect.y) / imgRect.h) * maskCanvas.height;
    const r = (state.brushSize / imgRect.w) * maskCanvas.width * 0.5;
    maskCtx.fillStyle = "#ef4444";
    maskCtx.beginPath();
    maskCtx.arc(ix, iy, Math.max(2, r), 0, Math.PI * 2);
    maskCtx.fill();
    drawOverlay();
  }

  function loadProxyUrl(url, width, height) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      glEngine.loadImage(img);
      maskCanvas.width = img.naturalWidth;
      maskCanvas.height = img.naturalHeight;
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

      state.origWidth = width || img.naturalWidth;
      state.origHeight = height || img.naturalHeight;
      document.getElementById("img-dims").textContent = `${state.origWidth} x ${state.origHeight}`;

      emptyState.style.display = "none";
      canvasStage.style.display = "block";
      zoomPill.style.display = "flex";

      ["btn-export-open", "btn-auto-enhance", "btn-denoise", "btn-upscale", "btn-remove-bg", "btn-revert-base"]
        .forEach((id) => (document.getElementById(id).disabled = false));

      resizeCanvases();
      scheduleRender(true);
    };
    img.src = url;
  }

  async function uploadFile(file) {
    showToast("Uploading photo to the Python server...");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) return showToast(data.detail || "Upload failed.");

    state.imageId = data.image_id;
    state.edits = defaultEdits();
    state.history = [];
    state.historyIdx = -1;
    state.view.zoom = 1;
    state.view.panX = 0;
    state.view.panY = 0;
    pushHistory();
    syncUIFromState();
    loadProxyUrl(data.proxy_url, data.width, data.height);
    showToast("Photo is ready! You can start editing.");
  }

  document.getElementById("file-input").addEventListener("change", (e) => {
    if (e.target.files[0]) uploadFile(e.target.files[0]);
  });

  viewportEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    viewportEl.classList.add("dragover");
  });
  viewportEl.addEventListener("dragleave", () => viewportEl.classList.remove("dragover"));
  viewportEl.addEventListener("drop", (e) => {
    e.preventDefault();
    viewportEl.classList.remove("dragover");
    if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
  });

  document.getElementById("btn-sample").addEventListener("click", async () => {
    showToast("Generating sample sunset photo...");
    const res = await fetch("/api/sample", { method: "POST" });
    const data = await res.json();
    state.imageId = data.image_id;
    state.edits = defaultEdits();
    state.history = [];
    state.historyIdx = -1;
    pushHistory();
    syncUIFromState();
    loadProxyUrl(data.proxy_url, data.width, data.height);
    showToast("Sample photo is ready!");
  });

  function setTool(tool) {
    state.activeTool = tool;
    document.querySelectorAll(".tool-btn").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    document.getElementById("erase-controls").style.display = tool === "erase" ? "block" : "none";
    document.getElementById("collage-controls").style.display = tool === "collage" ? "block" : "none";
    document.getElementById("text-controls").style.display = tool === "text" ? "block" : "none";
    overlayCanvas.style.cursor = tool === "move" ? "grab" : "crosshair";
    drawOverlay();
  }
  document.querySelectorAll(".tool-btn").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));

  // Collage Layer Controls
  document.getElementById("collage-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file || !state.imageId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const id = "img_" + Date.now();
      const img = new Image();
      img.onload = () => {
        collageImgCache.set(id, img);
        state.edits.image_layers.push({ id, data_url: reader.result, x: 0.5, y: 0.5, scale: 0.35, rotation: 0, opacity: 1.0 });
        state.selectedImgId = id;
        pushHistory();
        syncLayerPanels();
        drawOverlay();
        showToast("Image added on top! Drag it to position.");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  });

  ["img-scale", "img-rot", "img-op"].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => {
      const l = state.edits.image_layers.find((x) => x.id === state.selectedImgId);
      if (!l) return;
      if (id === "img-scale") l.scale = parseFloat(el.value) / 100;
      if (id === "img-rot") l.rotation = parseFloat(el.value);
      if (id === "img-op") l.opacity = parseFloat(el.value) / 100;
      syncLayerPanels();
      drawOverlay();
    });
    el.addEventListener("change", () => pushHistory());
  });

  document.getElementById("btn-del-img-layer").addEventListener("click", () => {
    state.edits.image_layers = state.edits.image_layers.filter((x) => x.id !== state.selectedImgId);
    state.selectedImgId = null;
    pushHistory();
    syncLayerPanels();
    drawOverlay();
  });

  // Meme / Text Layer Controls
  document.getElementById("btn-add-text").addEventListener("click", () => {
    if (!state.imageId) return showToast("Open a photo first!");
    const id = "txt_" + Date.now();
    state.edits.text_layers.push({
      id, text: "TOP TEXT", x: 0.5, y: 0.16, font_size: 0.07,
      color: "#ffffff", stroke: true, bg_mode: "none", bg_color: "#000000", bg_opacity: 0.65, padding: 14,
    });
    state.selectedTxtId = id;
    pushHistory();
    syncLayerPanels();
    drawOverlay();
  });

  document.getElementById("txt-content").addEventListener("input", (e) => {
    const l = state.edits.text_layers.find((x) => x.id === state.selectedTxtId);
    if (!l) return;
    l.text = e.target.value;
    drawOverlay();
  });
  document.getElementById("txt-content").addEventListener("change", () => pushHistory());

  document.getElementById("txt-size").addEventListener("input", (e) => {
    const l = state.edits.text_layers.find((x) => x.id === state.selectedTxtId);
    if (!l) return;
    l.font_size = parseFloat(e.target.value) / 100;
    document.getElementById("val-txt-size").textContent = e.target.value;
    drawOverlay();
  });
  document.getElementById("txt-size").addEventListener("change", () => pushHistory());

  document.getElementById("txt-color").addEventListener("input", (e) => {
    const l = state.edits.text_layers.find((x) => x.id === state.selectedTxtId);
    if (!l) return;
    l.color = e.target.value;
    drawOverlay();
  });
  document.getElementById("txt-stroke").addEventListener("change", (e) => {
    const l = state.edits.text_layers.find((x) => x.id === state.selectedTxtId);
    if (!l) return;
    l.stroke = e.target.checked;
    pushHistory();
    drawOverlay();
  });
  document.getElementById("txt-bg-mode").addEventListener("change", (e) => {
    const l = state.edits.text_layers.find((x) => x.id === state.selectedTxtId);
    if (!l) return;
    l.bg_mode = e.target.value;
    pushHistory();
    syncLayerPanels();
    drawOverlay();
  });
  document.getElementById("txt-bg-color").addEventListener("input", (e) => {
    const l = state.edits.text_layers.find((x) => x.id === state.selectedTxtId);
    if (!l) return;
    l.bg_color = e.target.value;
    drawOverlay();
  });
  document.getElementById("txt-bg-op").addEventListener("input", (e) => {
    const l = state.edits.text_layers.find((x) => x.id === state.selectedTxtId);
    if (!l) return;
    l.bg_opacity = parseFloat(e.target.value) / 100;
    document.getElementById("val-txt-bg-op").textContent = e.target.value;
    drawOverlay();
  });
  document.getElementById("btn-del-text-layer").addEventListener("click", () => {
    state.edits.text_layers = state.edits.text_layers.filter((x) => x.id !== state.selectedTxtId);
    state.selectedTxtId = null;
    pushHistory();
    syncLayerPanels();
    drawOverlay();
  });

  // Brush & Mask
  document.getElementById("brush-size").addEventListener("input", (e) => {
    state.brushSize = parseInt(e.target.value, 10);
    document.getElementById("val-brush-size").textContent = state.brushSize;
  });
  document.getElementById("btn-clear-mask").addEventListener("click", () => {
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    drawOverlay();
  });

  // Tabs
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "curve") drawCurveEditor();
    });
  });

  document.querySelectorAll(".curve-ch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".curve-ch-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeCurveCh = btn.dataset.ch;
      drawCurveEditor();
    });
  });
  document.getElementById("btn-reset-curve").addEventListener("click", () => {
    state.edits.curves[state.activeCurveCh] = [[0, 0], [1, 1]];
    drawCurveEditor();
    pushHistory();
    scheduleRender(true);
  });

  document.getElementById("hsl-channel").addEventListener("change", (e) => {
    state.activeHslCh = e.target.value;
    syncUIFromState();
  });

  // Transform & Crop Modes
  document.getElementById("btn-rot-left").addEventListener("click", () => {
    state.edits.transform.rotate_deg = (state.edits.transform.rotate_deg - 90) % 360;
    pushHistory();
    scheduleRender(true);
  });
  document.getElementById("btn-rot-right").addEventListener("click", () => {
    state.edits.transform.rotate_deg = (state.edits.transform.rotate_deg + 90) % 360;
    pushHistory();
    scheduleRender(true);
  });
  document.getElementById("btn-flip-h").addEventListener("click", () => {
    state.edits.transform.flip_h = !state.edits.transform.flip_h;
    pushHistory();
    scheduleRender(true);
  });
  document.getElementById("btn-flip-v").addEventListener("click", () => {
    state.edits.transform.flip_v = !state.edits.transform.flip_v;
    pushHistory();
    scheduleRender(true);
  });
  document.getElementById("straighten-slider").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    state.edits.transform.straighten_deg = v;
    document.getElementById("val-straighten").textContent = v;
    scheduleRender(true);
  });
  document.getElementById("straighten-slider").addEventListener("change", () => pushHistory());
  document.getElementById("crop-mode").addEventListener("change", (e) => {
    state.edits.transform.crop.mode = e.target.value;
    pushHistory();
    drawOverlay();
  });
  document.getElementById("btn-reset-crop").addEventListener("click", () => {
    state.edits.transform = defaultEdits().transform;
    pushHistory();
    syncUIFromState();
    scheduleRender(true);
  });

  // Top Bar actions
  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-redo").addEventListener("click", redo);
  document.getElementById("btn-reset").addEventListener("click", () => {
    state.edits = defaultEdits();
    state.selectedImgId = null;
    state.selectedTxtId = null;
    pushHistory();
    syncUIFromState();
    scheduleRender(true);
    showToast("All edits have been reset.");
  });

  const btnCompare = document.getElementById("btn-compare");
  btnCompare.addEventListener("click", () => {
    state.view.compareOriginal = !state.view.compareOriginal;
    btnCompare.classList.toggle("active", state.view.compareOriginal);
    scheduleRender(false);
  });

  const btnClip = document.getElementById("btn-clipping");
  btnClip.addEventListener("click", () => {
    state.view.showClipping = !state.view.showClipping;
    btnClip.classList.toggle("active", state.view.showClipping);
    scheduleRender(false);
  });

  document.getElementById("btn-zoom-in").addEventListener("click", () => {
    state.view.zoom = Math.min(8, state.view.zoom * 1.25);
    syncUIFromState();
    scheduleRender(false);
  });
  document.getElementById("btn-zoom-out").addEventListener("click", () => {
    state.view.zoom = Math.max(0.2, state.view.zoom * 0.8);
    syncUIFromState();
    scheduleRender(false);
  });
  document.getElementById("btn-zoom-fit").addEventListener("click", () => {
    state.view.zoom = 1;
    state.view.panX = 0;
    state.view.panY = 0;
    syncUIFromState();
    scheduleRender(false);
  });

  // Server Heavy Ops
  async function runServerOp(endpoint, label, extraBody = {}) {
    if (!state.imageId) return;
    showToast(`Server is doing ${label}...`);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_id: state.imageId, ...extraBody }),
    });
    const data = await res.json();
    if (!res.ok) return showToast(data.detail || `${label} has failed.`);

    if (data.suggested) {
      Object.assign(state.edits, data.suggested);
      pushHistory();
      syncUIFromState();
      scheduleRender(true);
      showToast("Auto Enhance is done!");
      return;
    }

    loadProxyUrl(`/api/proxy/${state.imageId}?v=${Date.now()}`, data.width, data.height);
    showToast(`${label} has finished!`);
  }

  document.getElementById("btn-auto-enhance").addEventListener("click", () => runServerOp("/api/heavy/auto-enhance", "Auto Enhance"));
  document.getElementById("btn-denoise").addEventListener("click", () => runServerOp("/api/heavy/denoise", "Heavy Denoise"));
  document.getElementById("btn-upscale").addEventListener("click", () => runServerOp("/api/heavy/upscale", "2x Upscale"));
  document.getElementById("btn-remove-bg").addEventListener("click", () => runServerOp("/api/heavy/remove-bg", "Background Removal"));
  document.getElementById("btn-revert-base").addEventListener("click", async () => {
    if (!state.imageId) return;
    const res = await fetch(`/api/reset/${state.imageId}`, { method: "POST" });
    const data = await res.json();
    loadProxyUrl(`/api/proxy/${state.imageId}?v=${Date.now()}`, data.width, data.height);
    showToast("Server base has been returned to original.");
  });

  document.getElementById("btn-run-inpaint").addEventListener("click", () => {
    runServerOp("/api/heavy/inpaint", "Magic Eraser", {
      mask_data_url: maskCanvas.toDataURL("image/png"),
      radius: 6,
    });
  });

  // Export Modal
  const exportModal = document.getElementById("export-modal");
  document.getElementById("btn-export-open").addEventListener("click", () => (exportModal.style.display = "flex"));
  document.getElementById("btn-export-cancel").addEventListener("click", () => (exportModal.style.display = "none"));
  document.getElementById("export-quality").addEventListener("input", (e) => {
    document.getElementById("val-export-quality").textContent = e.target.value;
  });

  document.getElementById("btn-export-go").addEventListener("click", async () => {
    if (!state.imageId) return;
    const fmt = document.getElementById("export-format").value;
    const quality = parseInt(document.getElementById("export-quality").value, 10);
    const maxDimRaw = document.getElementById("export-max-dim").value;
    const maxDim = maxDimRaw ? parseInt(maxDimRaw, 10) : null;

    showToast("Python server is exporting your full-res photo...");
    exportModal.style.display = "none";

    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_id: state.imageId,
        edits: state.edits,
        format: fmt,
        quality,
        max_dimension: maxDim,
      }),
    });
    if (!res.ok) return showToast("Export has failed.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `photo_edited.${fmt === "jpeg" ? "jpg" : fmt}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Export has finished! Check your downloads.");
  });

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "\\") {
      state.view.compareOriginal = true;
      scheduleRender(false);
    } else if (e.key.toLowerCase() === "j") {
      btnClip.click();
    } else if (e.key.toLowerCase() === "v") {
      setTool("move");
    } else if (e.key.toLowerCase() === "c") {
      setTool("crop");
    } else if (e.key.toLowerCase() === "b") {
      setTool("erase");
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "\\") {
      state.view.compareOriginal = false;
      scheduleRender(false);
    }
  });

  buildSliders();
  syncUIFromState();
})();
