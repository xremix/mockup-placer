import { initialCorners, iphoneRadius, isConvex } from "./geometry.js";
import { Renderer } from "./renderer.js";
import { originalExportFormat } from "./export-format.js";
import { openProjects, listProjects, saveProject } from "./projects.js";
import { colorDefaults, findMatchingProject, screenshotSettings } from "./project-settings.js";

const $ = selector => document.querySelector(selector);
const canvas = $("#preview");
const wrap = $("#canvas-wrap");
const area = $("#drop-zone");
const loupe = $("#loupe");
const loupeContext = $("#loupe-canvas").getContext("2d");
const state = { mockup: null, screenshot: null, corners: [], radius: 48, opacity: 1, blend: "source-over", format: "png", demo: true, ...colorDefaults };
let renderer;
let frame = 0;
let drag = null;
let toastTimer;
let exportInProgress = false;
let loadRevision = 0;
let projectDatabase;
let projectId = null;
let projectBusy = false;
let dirty = false;
let saveTimer;
let saveQueue = Promise.resolve();
let editRevision = 0;
const previewModes = {};
let zoom = 1;
let zoomX = 0;
let zoomY = 0;
const handles = [];
const labels = ["Top left", "Top right", "Bottom right", "Bottom left"];
const demoCorners = [
  { x: 565.44 / 1600, y: 237.28 / 1200 },
  { x: 943.32 / 1600, y: 148.84 / 1200 },
  { x: 1047.96 / 1600, y: 968.52 / 1200 },
  { x: 670.08 / 1600, y: 1056.96 / 1200 },
];

function notify(message, error = false) {
  const status = $("#status");
  clearTimeout(toastTimer);
  status.textContent = message;
  status.className = error ? "visible error" : "visible";
  toastTimer = setTimeout(() => { status.className = ""; }, error ? 8500 : 4500);
}

function report(error) {
  console.error(error);
  notify(error.message || "Something went wrong. Please try again.", true);
}

function scheduleRender() {
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    try { render(); } catch (error) { report(error); }
  });
}

function render(preview = true) {
  if (!renderer || !state.mockup || !state.screenshot) return;
  const style = getComputedStyle(area);
  const availableWidth = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availableHeight = area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const ratio = Math.min(availableWidth / state.mockup.width, availableHeight / state.mockup.height);
  const width = Math.max(1, state.mockup.width * ratio);
  const height = Math.max(1, state.mockup.height * ratio);
  wrap.style.width = `${width}px`;
  wrap.style.height = `${height}px`;
  const pixelRatio = Math.min((window.devicePixelRatio || 1) * zoom, 6, renderer.maxSize / width, renderer.maxSize / height, Math.sqrt(60_000_000 / (width * height)));
  renderer.compose(canvas, preview ? { ...state, ...previewModes } : state, Math.max(1, Math.floor(width * pixelRatio)), Math.max(1, Math.floor(height * pixelRatio)));
  $("#corner-overlay").setAttribute("viewBox", `0 0 ${width} ${height}`);
  $("#selection").setAttribute("points", state.corners.map(p => `${p.x * width},${p.y * height}`).join(" "));
  handles.forEach((handle, i) => {
    const p = state.corners[i];
    handle.style.left = `${p.x * 100}%`;
    handle.style.top = `${p.y * 100}%`;
    handle.setAttribute("aria-label", `${labels[i]} corner, ${Math.round(p.x * state.mockup.width)}, ${Math.round(p.y * state.mockup.height)} pixels. Use arrow keys to adjust.`);
  });
  if (drag) updateLoupe();
}

function resetZoom() {
  zoom = 1;
  zoomX = 0;
  zoomY = 0;
  wrap.style.transform = "";
  canvas.title = "Click to zoom in";
  canvas.style.cursor = "zoom-in";
  scheduleRender();
}

canvas.addEventListener("click", event => {
  if (!state.mockup || drag) return;
  if (zoom === 4) return resetZoom();
  const rect = wrap.getBoundingClientRect();
  const areaRect = area.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  const width = rect.width / zoom;
  const height = rect.height / zoom;
  const baseLeft = rect.left - zoomX;
  const baseTop = rect.top - zoomY;
  zoom *= 2;
  zoomX = areaRect.left + areaRect.width / 2 - baseLeft - x * width * zoom;
  zoomY = areaRect.top + areaRect.height / 2 - baseTop - y * height * zoom;
  wrap.style.transform = `translate(${zoomX}px, ${zoomY}px) scale(${zoom})`;
  canvas.title = zoom === 4 ? "Click to fit" : "Click to zoom in";
  canvas.style.cursor = zoom === 4 ? "zoom-out" : "zoom-in";
  scheduleRender();
});

function updateLoupe() {
  const { index, clientX, clientY } = drag;
  const p = state.corners[index];
  const rect = canvas.getBoundingClientRect();
  const zoom = 4;
  const sampleWidth = 144 / zoom * canvas.width / rect.width;
  const sampleHeight = 144 / zoom * canvas.height / rect.height;
  loupeContext.clearRect(0, 0, 240, 240);
  loupeContext.fillStyle = "#eeedf2";
  loupeContext.fillRect(0, 0, 240, 240);
  loupeContext.imageSmoothingEnabled = true;
  loupeContext.imageSmoothingQuality = "high";
  loupeContext.drawImage(canvas, p.x * canvas.width - sampleWidth / 2, p.y * canvas.height - sampleHeight / 2, sampleWidth, sampleHeight, 0, 0, 240, 240);
  const left = Math.min(window.innerWidth - 152, Math.max(8, clientX - 72));
  // Keep the precision view above the pointer, switching below near the top edge.
  const top = clientY > 174 ? clientY - 170 : clientY + 28;
  loupe.style.left = `${left}px`;
  loupe.style.top = `${Math.max(8, Math.min(window.innerHeight - 152, top))}px`;
}

function moveCorner(index, x, y) {
  const next = state.corners.map((p, i) => i === index ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : p);
  if (isConvex(next)) {
    state.corners = next;
    markProjectChanged();
    scheduleRender();
  }
}

labels.forEach((label, index) => {
  const handle = document.createElement("button");
  handle.className = "corner-handle";
  handle.type = "button";
  handle.setAttribute("aria-label", `${label} corner`);
  handle.addEventListener("pointerdown", event => {
    if (!state.mockup || event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const p = state.corners[index];
    drag = {
      index, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      offsetX: event.clientX - (rect.left + p.x * rect.width),
      offsetY: event.clientY - (rect.top + p.y * rect.height),
    };
    wrap.classList.add("is-dragging");
    loupe.hidden = false;
    updateLoupe();
  });
  handle.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    moveCorner(index, (event.clientX - rect.left - drag.offsetX) / rect.width, (event.clientY - rect.top - drag.offsetY) / rect.height);
    updateLoupe();
  });
  const stop = () => { drag = null; wrap.classList.remove("is-dragging"); loupe.hidden = true; };
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
  handle.addEventListener("lostpointercapture", stop);
  handle.addEventListener("keydown", event => {
    if (!state.mockup) return;
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const p = state.corners[index];
    moveCorner(index, p.x + offset[0] * amount / state.mockup.width, p.y + offset[1] * amount / state.mockup.height);
  });
  $("#handles").append(handle);
  handles.push(handle);
});

function loadImage(url, name, owned = false) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height || width > 32768 || height > 32768 || width * height > 100_000_000) {
        if (owned) URL.revokeObjectURL(url);
        reject(new Error(`${name} is too large or has no usable dimensions. Use an image under 100 megapixels and 32768px per side.`));
      } else {
        resolve({ image, width, height, url, name, owned });
      }
    };
    image.onerror = () => {
      if (owned) URL.revokeObjectURL(url);
      reject(new Error(`Couldn't open "${name}". Please use a valid PNG, JPG, WebP, AVIF or SVG image.`));
    };
    image.src = url;
  });
}

async function loadFile(file) {
  if ((!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|avif|svg|gif|bmp)$/i.test(file.name)) || file.size > 100 * 1024 * 1024) {
    throw new Error("Choose an image file under 100 MB (PNG, JPG, WebP, AVIF or SVG).");
  }
  const asset = await loadImage(URL.createObjectURL(file), file.name, true);
  return { ...asset, type: file.type, blob: file };
}

function release(asset) {
  if (asset?.owned) URL.revokeObjectURL(asset.url);
}

async function importFiles(files, slot) {
  if (projectBusy) return notify("Please wait for the project to finish opening.");
  if (!renderer || !state.mockup || !state.screenshot) return notify("The editor is still starting. Please try again in a moment.");
  if (exportInProgress) return notify("Please wait for the export to finish before changing images.");
  if (!files.length) return;
  if (files.length > (slot ? 1 : 2)) return notify(slot ? "Drop one image on each image card." : "Drop up to two images: a mockup and a screenshot.", true);
  const revision = ++loadRevision;
  let loaded = [];
  try {
    const results = await Promise.allSettled(Array.from(files, loadFile));
    loaded = results.filter(result => result.status === "fulfilled").map(result => result.value);
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
    if (revision !== loadRevision) {
      loaded.forEach(release);
      return;
    }
    if (loaded.some(asset => asset.width > renderer.maxSize || asset.height > renderer.maxSize || asset.width * asset.height > 60_000_000)) {
      throw new Error(`This browser supports images up to ${renderer.maxSize}px per side and 60 megapixels. Resize the image before importing.`);
    }
    let resetPlacement = loaded.length === 2;
    let incomingMockup = null;
    if (loaded.length === 2) {
      let [mockup, screenshot] = loaded;
      const firstIsScreen = /screenshot|screen.?shot|app.?screen/i.test(mockup.name);
      const secondIsMockup = /mockup|background|scene/i.test(screenshot.name);
      const firstPortraitOnly = mockup.width / mockup.height < 0.8 && screenshot.width / screenshot.height >= 1;
      if (firstIsScreen || secondIsMockup || firstPortraitOnly) [mockup, screenshot] = [screenshot, mockup];
      incomingMockup = mockup;
    } else {
      const target = slot || (/screen.?shot/i.test(loaded[0].name) || loaded[0].height > loaded[0].width * 1.4 ? "screenshot" : "mockup");
      resetPlacement = target === "mockup";
      if (resetPlacement) incomingMockup = loaded[0];
    }
    let remembered = null;
    if (incomingMockup && projectDatabase) {
      await flushProject();
      const projects = await listProjects(projectDatabase);
      if (revision !== loadRevision) {
        loaded.forEach(release);
        return;
      }
      remembered = findMatchingProject(projects, incomingMockup.name);
    }
    if (loaded.length === 2) {
      const mockup = incomingMockup;
      const screenshot = loaded.find(image => image !== mockup);
      release(state.mockup);
      release(state.screenshot);
      Object.assign(state, { mockup, screenshot });
    } else {
      const asset = loaded[0];
      const target = slot || (/screen.?shot/i.test(asset.name) || asset.height > asset.width * 1.4 ? "screenshot" : "mockup");
      release(state[target]);
      state[target] = asset;
    }
    state.demo = false;
    if (resetPlacement) setExportFormat(originalExportFormat(state.mockup));
    if (resetPlacement) {
      resetZoom();
      state.corners = initialCorners(state.mockup, state.screenshot);
      if (remembered) {
        applyScreenshotSettings(remembered);
        notify("Previous screenshot settings restored for this mockup.");
      }
    }
    $("#demo-badge").hidden = true;
    syncSettings();
    scheduleRender();
    markProjectChanged();
    if (!remembered) notify(loaded.length === 2 ? "Both images are ready. Drag the corners to fit your screenshot." : `${slot || (loaded[0] === state.mockup ? "Mockup" : "Screenshot")} image updated.`);
  } catch (error) {
    loaded.forEach(release);
    report(error);
  }
}

function syncAssets() {
  for (const slot of ["mockup", "screenshot"]) {
    const asset = state[slot];
    $(`#${slot}-thumb`).src = asset.url;
    $(`#${slot}-name`).textContent = asset.name;
    $(`#${slot}-name`).title = asset.name;
    $(`#${slot}-meta`).textContent = `${asset.width} × ${asset.height} · ${slot === "mockup" ? "Original resolution" : "Ready to place"}`;
  }
  $("#coordinate").textContent = `${state.mockup.width} × ${state.mockup.height} px`;
  syncDimensions();
}

function syncDimensions() {
  if (!state.mockup) return;
  const scale = Number($("#export-scale").value);
  $("#export-dimensions").textContent = `${state.mockup.width * scale} × ${state.mockup.height * scale}`;
}

function paintRange(input) {
  const fill = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
  input.style.setProperty("--fill", `${fill}%`);
}

function syncRadius() {
  if (!state.screenshot) return;
  const maximum = Math.floor(Math.min(state.screenshot.width, state.screenshot.height) / 2);
  state.radius = $("#iphone").checked ? iphoneRadius(state.screenshot.width, state.screenshot.height) : Math.min(state.radius, maximum);
  for (const selector of ["#radius", "#radius-number"]) {
    $(selector).max = maximum;
    $(selector).value = state.radius;
  }
  paintRange($("#radius"));
}

for (const slot of ["mockup", "screenshot"]) {
  const input = $(`#${slot}-input`);
  const card = $(`#${slot}-card`);
  card.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    importFiles(input.files, slot);
    input.value = "";
  });
  card.addEventListener("dragover", event => {
    event.preventDefault();
    card.classList.add("dragging");
  });
  card.addEventListener("dragleave", () => card.classList.remove("dragging"));
  card.addEventListener("drop", event => {
    event.preventDefault();
    event.stopPropagation();
    card.classList.remove("dragging");
    importFiles(event.dataTransfer.files, slot);
  });
}

let dragDepth = 0;
area.addEventListener("dragenter", event => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  dragDepth++;
  area.classList.add("dragging");
});
area.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) { dragDepth = 0; area.classList.remove("dragging"); }
});
area.addEventListener("dragover", event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; });
area.addEventListener("drop", event => {
  event.preventDefault();
  dragDepth = 0;
  area.classList.remove("dragging");
  importFiles(event.dataTransfer.files);
});
// Keep an accidental drop outside the editor from navigating away from the work.
window.addEventListener("dragover", event => event.preventDefault());
window.addEventListener("drop", event => {
  event.preventDefault();
  if (!area.contains(event.target) && !event.target.closest("[data-slot]")) importFiles(event.dataTransfer.files);
});

let hoveredSlot = null;
document.querySelectorAll("[data-slot]").forEach(card => {
  card.addEventListener("pointerenter", () => { hoveredSlot = card.dataset.slot; });
  card.addEventListener("pointerleave", () => { hoveredSlot = null; });
});
document.addEventListener("paste", event => {
  const items = Array.from(event.clipboardData?.items || []).filter(item => item.kind === "file" && item.type.startsWith("image/"));
  if (!items.length) return;
  event.preventDefault();
  const files = items.slice(0, 2).map((item, index) => {
    const file = item.getAsFile();
    const extension = (file.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
    const name = file.name && file.name !== "image.png" ? file.name : `Pasted image${items.length > 1 ? ` ${index + 1}` : ""}.${extension}`;
    return new File([file], name, { type: file.type });
  });
  const slot = files.length === 1 ? document.activeElement?.closest?.("[data-slot]")?.dataset.slot || hoveredSlot : undefined;
  importFiles(files, slot);
});

function setupBlendMenu(id, key) {
  const select = $(`#${id}`);
  const menu = $(`#${id}-menu`);
  const options = $(`#${id}-options`);
  const sync = () => {
    select.value = state[key];
    $(`#${id}-selection`).textContent = select.selectedOptions[0].textContent;
    options.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.value === state[key])));
  };
  const clearPreview = () => {
    if (key in previewModes) {
      delete previewModes[key];
      scheduleRender();
    }
  };
  for (const option of select.options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.textContent;
    button.dataset.value = option.value;
    button.addEventListener("pointerenter", () => { previewModes[key] = option.value; scheduleRender(); });
    button.addEventListener("focus", () => { previewModes[key] = option.value; scheduleRender(); });
    button.addEventListener("click", () => {
      state[key] = option.value;
      clearPreview();
      sync();
      menu.open = false;
      menu.querySelector("summary").focus();
      markProjectChanged();
      scheduleRender();
    });
    options.append(button);
  }
  options.addEventListener("pointerleave", clearPreview);
  menu.addEventListener("focusout", event => { if (!menu.contains(event.relatedTarget)) clearPreview(); });
  menu.addEventListener("toggle", () => { if (!menu.open) clearPreview(); });
  document.addEventListener("click", event => { if (!menu.contains(event.target)) menu.open = false; });
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.open) {
      event.preventDefault();
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
  select.addEventListener("change", event => { state[key] = event.target.value; sync(); scheduleRender(); });
  sync();
  return sync;
}
const syncBlend = setupBlendMenu("blend", "blend");
const syncOverlayBlend = setupBlendMenu("overlay-blend", "overlayBlend");
$("#opacity").addEventListener("input", event => {
  state.opacity = Number(event.target.value) / 100;
  $("#opacity-value").innerHTML = `${event.target.value}<span>%</span>`;
  paintRange(event.target);
  scheduleRender();
});
for (const selector of ["#radius", "#radius-number"]) {
  $(selector).addEventListener("input", event => {
    if (event.target.value === "") return;
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    state.radius = Math.round(Math.max(0, Math.min(Number(event.target.max), value)));
    $("#iphone").checked = false;
    syncRadius();
    scheduleRender();
  });
}
$("#iphone").addEventListener("change", () => { syncRadius(); scheduleRender(); });
for (const [id, key] of [["warmth", "warmth"], ["tint", "tint"], ["overlay-opacity", "overlayOpacity"]]) {
  $(`#${id}`).addEventListener("input", event => {
    state[key] = Number(event.target.value);
    $(`#${id}-value`).textContent = `${event.target.value}${id === "overlay-opacity" ? "%" : ""}`;
    paintRange(event.target);
    scheduleRender();
  });
}
$("#overlay-color").addEventListener("input", event => { state.overlayColor = event.target.value; scheduleRender(); });
$("#export-scale").addEventListener("change", syncDimensions);
$("#quality").addEventListener("input", event => {
  $("#quality-value").textContent = `${event.target.value}%`;
  paintRange(event.target);
});
function setExportFormat(format) {
  state.format = format;
  document.querySelectorAll("[data-format]").forEach(item => {
    const active = item.dataset.format === format;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", active);
  });
  $("#quality-control").hidden = state.format !== "jpeg";
}
document.querySelectorAll("[data-format]").forEach(button => button.addEventListener("click", () => {
  setExportFormat(button.dataset.format);
  markProjectChanged();
}));
$("#reset").addEventListener("click", () => {
  if (!state.mockup) return;
  state.corners = state.demo ? demoCorners.map(p => ({ ...p })) : initialCorners(state.mockup, state.screenshot);
  scheduleRender();
  markProjectChanged();
  notify("Screenshot placement reset.");
});
$("#fit").addEventListener("click", () => { resetZoom(); scheduleRender(); notify("Preview fitted to your workspace."); });

$("#download").addEventListener("click", async () => {
  if (exportInProgress || !state.mockup || !renderer) return;
  exportInProgress = true;
  const button = $("#download");
  const exportState = { ...state, corners: state.corners.map(point => ({ ...point })) };
  const scale = Number($("#export-scale").value);
  const quality = Number($("#quality").value) / 100;
  button.disabled = true;
  button.querySelector("span").textContent = "Creating your mockup…";
  try {
    // Let the busy state paint before the synchronous high-resolution render.
    await new Promise(resolve => setTimeout(resolve, 35));
    const output = document.createElement("canvas");
    const width = exportState.mockup.width * scale;
    const height = exportState.mockup.height * scale;
    renderer.compose(output, exportState, width, height, exportState.format === "jpeg");
    const blob = await new Promise((resolve, reject) => output.toBlob(
      result => result ? resolve(result) : reject(new Error("The browser couldn't encode this image. Try the original export size.")),
      `image/${exportState.format}`, quality,
    ));
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportState.mockup.name.replace(/\.[^.]+$/, "")}-mockup.${exportState.format === "jpeg" ? "jpg" : "png"}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    output.width = 1;
    output.height = 1;
    notify(`Your ${width} × ${height} ${exportState.format === "jpeg" ? "JPG" : "PNG"} is ready.`);
  } catch (error) {
    report(error);
  } finally {
    exportInProgress = false;
    button.disabled = false;
    button.querySelector("span").textContent = "Download mockup";
    scheduleRender();
  }
});

new ResizeObserver(scheduleRender).observe(area);
window.addEventListener("renderer-error", event => {
  $("#download").disabled = true;
  notify(event.detail, true);
});

function markProjectChanged() {
  if (projectBusy || !state.mockup || !state.screenshot) return;
  projectId ||= crypto.randomUUID();
  dirty = true;
  editRevision++;
  clearTimeout(saveTimer);
  if (!projectDatabase) {
    $("#save-status").textContent = "Not saved — browser storage unavailable";
    $("#save-status").dataset.error = "";
    return;
  }
  $("#save-status").textContent = "Saving…";
  saveTimer = setTimeout(() => flushProject().catch(reportSaveError), 500);
}

function reportSaveError(error) {
  $("#save-status").textContent = "Not saved — try Recent projects to retry";
  $("#save-status").dataset.error = "";
  console.error(error);
  notify(`Your project could not be saved locally: ${error.message}. Keep this tab open.`, true);
}

async function flushProject() {
  clearTimeout(saveTimer);
  if (!dirty) return saveQueue;
  if (!projectDatabase) return Promise.reject(new Error("Browser storage is unavailable"));
  const revision = editRevision;
  const asset = value => ({ name: value.name, type: value.type, blob: value.blob });
  const project = {
    id: projectId, updatedAt: Date.now(),
    mockup: asset(state.mockup), screenshot: asset(state.screenshot),
    corners: state.corners.map(point => ({ ...point })),
    radius: state.radius, opacity: state.opacity, blend: state.blend, format: state.format,
    warmth: state.warmth, tint: state.tint, overlayColor: state.overlayColor, overlayOpacity: state.overlayOpacity, overlayBlend: state.overlayBlend,
    iphone: $("#iphone").checked, scale: $("#export-scale").value, quality: $("#quality").value,
    demo: state.demo,
  };
  const thumbnail = document.createElement("canvas");
  const thumbnailScale = Math.min(240 / state.mockup.width, 160 / state.mockup.height);
  thumbnail.width = Math.max(1, Math.round(state.mockup.width * thumbnailScale));
  thumbnail.height = Math.max(1, Math.round(state.mockup.height * thumbnailScale));
  render(false);
  thumbnail.getContext("2d").drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
  if (Object.keys(previewModes).length) scheduleRender();
  dirty = false;
  const write = async () => {
    try {
      project.thumbnail = await new Promise((resolve, reject) => thumbnail.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("Could not create project thumbnail")),
        "image/jpeg", 0.8,
      ));
      await saveProject(projectDatabase, project);
      if (projectId === project.id && revision === editRevision) {
        dirty = false;
        $("#save-status").textContent = "All changes saved on this device";
        delete $("#save-status").dataset.error;
      }
      await refreshRecentProjects().catch(report);
    } catch (error) {
      if (projectId === project.id) dirty = true;
      throw error;
    }
  };
  saveQueue = saveQueue.then(write, write);
  return saveQueue;
}

function syncSettings() {
  syncBlend();
  $("#opacity").value = Math.round(state.opacity * 100);
  $("#opacity-value").innerHTML = `${Math.round(state.opacity * 100)}<span>%</span>`;
  $("#quality-value").textContent = `${$("#quality").value}%`;
  for (const [id, key] of [["warmth", "warmth"], ["tint", "tint"], ["overlay-opacity", "overlayOpacity"]]) {
    $(`#${id}`).value = state[key];
    $(`#${id}-value`).textContent = `${state[key]}${id === "overlay-opacity" ? "%" : ""}`;
  }
  $("#overlay-color").value = state.overlayColor;
  syncOverlayBlend();
  setExportFormat(state.format);
  syncRadius();
  syncAssets();
  $("#demo-badge").hidden = !state.demo;
  document.querySelectorAll("input[type=range]").forEach(paintRange);
  render();
}

function applyScreenshotSettings(project) {
  Object.assign(state, screenshotSettings(project));
  $("#iphone").checked = project.iphone;
}

async function decodeProject(project) {
  const results = await Promise.allSettled(["mockup", "screenshot"].map(async slot => {
    const saved = project[slot];
    return loadFile(new File([saved.blob], saved.name, { type: saved.type || saved.blob.type }));
  }));
  const loaded = results.filter(result => result.status === "fulfilled").map(result => result.value);
  const failed = results.find(result => result.status === "rejected");
  if (failed) {
    loaded.forEach(release);
    throw failed.reason;
  }
  if (loaded.some(image => image.width > renderer.maxSize || image.height > renderer.maxSize)) {
    loaded.forEach(release);
    throw new Error("This project's images exceed this browser's graphics limit.");
  }
  return loaded;
}

async function restoreProject(project) {
  const [mockup, screenshot] = await decodeProject(project);
  release(state.mockup);
  release(state.screenshot);
  Object.assign(state, {
    mockup, screenshot, corners: project.corners.map(point => ({ ...point })),
    radius: project.radius, opacity: project.opacity, blend: project.blend,
    format: project.format, demo: project.demo,
  });
  applyScreenshotSettings(project);
  resetZoom();
  projectId = project.id;
  dirty = false;
  $("#iphone").checked = project.iphone;
  $("#export-scale").value = project.scale;
  $("#quality").value = project.quality;
  syncSettings();
  $("#save-status").textContent = "All changes saved on this device";
  delete $("#save-status").dataset.error;
}

async function demoImages() {
  return Promise.all(["mockup", "screenshot"].map(async slot => {
    const response = await fetch(`${import.meta.env.BASE_URL}demo-${slot}.svg`);
    if (!response.ok) throw new Error(`Could not load the demo ${slot} (${response.status}).`);
    return loadFile(new File([await response.blob()], slot === "mockup" ? "Studio lavender.svg" : "A little headspace.svg", { type: "image/svg+xml" }));
  }));
}

$(".settings").addEventListener("input", markProjectChanged);
$(".settings").addEventListener("change", markProjectChanged);
window.addEventListener("pagehide", () => { flushProject().catch(reportSaveError); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushProject().catch(reportSaveError);
});
window.addEventListener("beforeunload", event => {
  if (dirty || $("#save-status").textContent === "Saving…") {
    event.preventDefault();
    event.returnValue = "";
  }
});

let recentUrls = [];
function releaseRecentUrls() {
  recentUrls.forEach(url => URL.revokeObjectURL(url));
  recentUrls = [];
}
let recentRevision = 0;
async function refreshRecentProjects() {
    const revision = ++recentRevision;
    const projects = await listProjects(projectDatabase);
    if (revision !== recentRevision) return;
    const focusedId = document.activeElement?.closest("[data-project-id]")?.dataset.projectId;
    releaseRecentUrls();
    $("#projects-list").replaceChildren();
    if (!projects.length) {
      const empty = document.createElement("li");
      empty.className = "projects-empty";
      empty.textContent = "Nothing here yet. Add images or adjust a setting to save your first project.";
      $("#projects-list").append(empty);
    }
    for (const project of projects) {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "project-entry";
      button.dataset.projectId = project.id;
      if (project.id === projectId) button.setAttribute("aria-current", "true");
      const image = document.createElement("img");
      image.alt = "";
      image.src = URL.createObjectURL(project.thumbnail);
      recentUrls.push(image.src);
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = project.mockup.name;
      const description = document.createElement("small");
      description.textContent = `${project.screenshot.name} · ${new Date(project.updatedAt).toLocaleString()}`;
      text.append(title, description);
      if (project.id === projectId) {
        const current = document.createElement("em");
        current.textContent = "Current project";
        text.append(current);
      }
      button.append(image, text);
      button.addEventListener("click", async () => {
        if (projectBusy || exportInProgress) return notify("Please wait for the current operation to finish.");
        if (project.id === projectId) {
          wrap.scrollIntoView({ block: "center" });
          handles[0].focus({ preventScroll: true });
          return;
        }
        projectBusy = true;
        ++loadRevision;
        button.disabled = true;
        try {
          await flushProject();
          await restoreProject(project);
          projectBusy = false;
          markProjectChanged();
          wrap.scrollIntoView({ block: "center" });
          handles[0].focus({ preventScroll: true });
          notify("Project restored. Pick up where you left off.");
        } catch (error) {
          report(error);
        } finally {
          projectBusy = false;
          button.disabled = false;
        }
      });
      row.append(button);
      $("#projects-list").append(row);
      if (project.id === focusedId) button.focus({ preventScroll: true });
    }
}

$("#recent-projects").addEventListener("click", async () => {
  if (projectBusy || exportInProgress) return notify("Please wait for the current operation to finish.");
  projectBusy = true;
  ++loadRevision;
  try {
    await flushProject();
    if (!projectDatabase) throw new Error("Browser storage is unavailable.");
    await refreshRecentProjects();
    $("#recent-projects-panel").scrollIntoView({ block: "start" });
    $("#recent-projects-panel").focus({ preventScroll: true });
  } catch (error) {
    reportSaveError(error);
  } finally {
    projectBusy = false;
  }
});

$("#new-project").addEventListener("click", async () => {
  if (projectBusy || exportInProgress) return notify("Please wait for the current operation to finish.");
  projectBusy = true;
  $("#new-project").disabled = true;
  ++loadRevision;
  try {
    await flushProject();
    const [mockup, screenshot] = await demoImages();
    release(state.mockup);
    release(state.screenshot);
    Object.assign(state, {
      mockup, screenshot, corners: demoCorners.map(point => ({ ...point })),
      radius: 48, opacity: 1, blend: "source-over", format: "png", demo: true,
      ...colorDefaults,
    });
    resetZoom();
    projectId = null;
    dirty = false;
    $("#iphone").checked = true;
    $("#export-scale").value = "1";
    $("#quality").value = "98";
    syncSettings();
    if (projectDatabase) await refreshRecentProjects();
    $("#save-status").textContent = "New project — add your images to begin";
    notify("New project ready. Your previous work is in Recent projects.");
  } catch (error) {
    report(error);
  } finally {
    projectBusy = false;
    $("#new-project").disabled = false;
  }
});

async function init() {
  try {
    projectBusy = true;
    renderer = new Renderer();
    const [mockup, screenshot] = await demoImages();
    Object.assign(state, { mockup, screenshot, corners: demoCorners.map(p => ({ ...p })) });
    syncAssets();
    syncRadius();
    document.querySelectorAll("input[type=range]").forEach(paintRange);
    render();
    try {
      projectDatabase = await openProjects();
      const projects = await listProjects(projectDatabase);
      if (projects.length) await restoreProject(projects[0]);
      await refreshRecentProjects();
    } catch (error) {
      reportSaveError(error);
      $("#projects-list").textContent = "Recent projects could not be loaded. Use Recent projects above to retry.";
    }
  } catch (error) {
    $("#download").disabled = true;
    report(error);
  } finally {
    projectBusy = false;
  }
}
init();
