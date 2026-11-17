import { initialCorners, iphoneRadius, isConvex } from "./geometry.js";
import { Renderer } from "./renderer.js";

const $ = selector => document.querySelector(selector);
const canvas = $("#preview");
const wrap = $("#canvas-wrap");
const area = $("#drop-zone");
const loupe = $("#loupe");
const loupeContext = $("#loupe-canvas").getContext("2d");
const state = { mockup: null, screenshot: null, corners: [], radius: 48, opacity: 1, blend: "source-over", format: "png", demo: true };
let renderer;
let frame = 0;
let drag = null;
let toastTimer;
let exportInProgress = false;
let loadRevision = 0;
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

function render() {
  if (!renderer || !state.mockup || !state.screenshot) return;
  const style = getComputedStyle(area);
  const availableWidth = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availableHeight = area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const ratio = Math.min(availableWidth / state.mockup.width, availableHeight / state.mockup.height);
  const width = Math.max(1, state.mockup.width * ratio);
  const height = Math.max(1, state.mockup.height * ratio);
  wrap.style.width = `${width}px`;
  wrap.style.height = `${height}px`;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  renderer.compose(canvas, state, Math.round(width * pixelRatio), Math.round(height * pixelRatio));
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
  return loadImage(URL.createObjectURL(file), file.name, true);
}

function release(asset) {
  if (asset?.owned) URL.revokeObjectURL(asset.url);
}

async function importFiles(files, slot) {
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
    if (loaded.length === 2) {
      let [mockup, screenshot] = loaded;
      const firstIsScreen = /screenshot|screen.?shot|app.?screen/i.test(mockup.name);
      const secondIsMockup = /mockup|background|scene/i.test(screenshot.name);
      const firstPortraitOnly = mockup.width / mockup.height < 0.8 && screenshot.width / screenshot.height >= 1;
      if (firstIsScreen || secondIsMockup || firstPortraitOnly) [mockup, screenshot] = [screenshot, mockup];
      release(state.mockup);
      release(state.screenshot);
      Object.assign(state, { mockup, screenshot });
    } else {
      const asset = loaded[0];
      const target = slot || (/screen.?shot/i.test(asset.name) || asset.height > asset.width * 1.4 ? "screenshot" : "mockup");
      resetPlacement = target === "mockup";
      release(state[target]);
      state[target] = asset;
    }
    state.demo = false;
    if (resetPlacement) state.corners = initialCorners(state.mockup, state.screenshot);
    $("#demo-badge").hidden = true;
    syncAssets();
    syncRadius();
    scheduleRender();
    notify(loaded.length === 2 ? "Both images are ready. Drag the corners to fit your screenshot." : `${slot || (loaded[0] === state.mockup ? "Mockup" : "Screenshot")} image updated.`);
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

$("#blend").addEventListener("change", event => { state.blend = event.target.value; scheduleRender(); });
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
$("#export-scale").addEventListener("change", syncDimensions);
$("#quality").addEventListener("input", event => {
  $("#quality-value").textContent = `${event.target.value}%`;
  paintRange(event.target);
});
document.querySelectorAll("[data-format]").forEach(button => button.addEventListener("click", () => {
  state.format = button.dataset.format;
  document.querySelectorAll("[data-format]").forEach(item => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", active);
  });
  $("#quality-control").hidden = state.format !== "jpeg";
}));
$("#reset").addEventListener("click", () => {
  if (!state.mockup) return;
  state.corners = state.demo ? demoCorners.map(p => ({ ...p })) : initialCorners(state.mockup, state.screenshot);
  scheduleRender();
  notify("Screenshot placement reset.");
});
$("#fit").addEventListener("click", () => { scheduleRender(); notify("Preview fitted to your workspace."); });

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

async function init() {
  try {
    renderer = new Renderer();
    const [mockup, screenshot] = await Promise.all([
      loadImage(`${import.meta.env.BASE_URL}demo-mockup.svg`, "Studio lavender.svg"),
      loadImage(`${import.meta.env.BASE_URL}demo-screenshot.svg`, "A little headspace.svg"),
    ]);
    Object.assign(state, { mockup, screenshot, corners: demoCorners.map(p => ({ ...p })) });
    syncAssets();
    syncRadius();
    document.querySelectorAll("input[type=range]").forEach(paintRange);
    render();
  } catch (error) {
    $("#download").disabled = true;
    report(error);
  }
}
init();
