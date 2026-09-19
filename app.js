const $ = id => document.getElementById(id);
const canvas = $('previewCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const SCENE_SIZE = 400;
const FRAME_TOTAL = 12;
const BASE_FRAME_MS = 100;

const state = {
  subject: { img: null, x: 200, y: 220, scale: 1, baseScale: 1, baseW: 0, baseH: 0, opacity: 1 },
  hand: { img: null, x: 286, y: 305, scale: 0.56 },
  text: { x: 200, y: 48 },
  textValue: '嗨！',
  fontSize: 42,
  fontWeight: 700,
  textColor: '#ffffff',
  strokeColor: '#111111',
  speed: 100,
  background: 'transparent',
  outputSize: 400,
  activeLayer: 'subject',
  playing: true,
  currentFrame: 0,
  resultUrl: null
};

const layerLabel = { subject: '圖片', hand: '手掌', text: '文字' };
let lastTick = 0;
let pointer = null;
let resultGeneration = 0;

function setCanvasSize(size = SCENE_SIZE) {
  canvas.width = size;
  canvas.height = size;
  render();
}

function resetSceneForSubject() {
  if (!state.subject.img) return;
  const maxW = SCENE_SIZE * 0.78;
  const maxH = SCENE_SIZE * 0.72;
  const fitScale = Math.min(maxW / state.subject.img.naturalWidth, maxH / state.subject.img.naturalHeight, 1);
  state.subject.baseScale = fitScale;
  state.subject.scale = fitScale;
  state.subject.baseW = state.subject.img.naturalWidth;
  state.subject.baseH = state.subject.img.naturalHeight;
  state.subject.x = SCENE_SIZE / 2;
  state.subject.y = SCENE_SIZE * 0.58;
  $('imageSize').value = 100;
  $('imageOpacity').value = 100;
  state.hand.x = SCENE_SIZE * 0.72;
  state.hand.y = SCENE_SIZE * 0.76;
  state.text.x = SCENE_SIZE / 2;
  state.text.y = Math.max(42, SCENE_SIZE * 0.12);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function loadDefaultHand() {
  try {
    state.hand.img = await loadImage('assets/hand.gif');
    state.hand.frameW = state.hand.img.naturalWidth;
    state.hand.frameH = state.hand.img.naturalHeight;
    render();
    const decoded = await decodeGifFrames('assets/hand.gif');
    state.hand.frames = decoded.frames;
    state.hand.frameW = decoded.width;
    state.hand.frameH = decoded.height;
    state.hand.totalDuration = decoded.frames.reduce((sum, f) => sum + (f.delay || 100), 0) || 100;
    state.hand.frameIndex = 0;
    state.hand.playhead = 0;
    render();
  } catch {
    $('statusText').textContent = '找不到 assets/hand.gif';
  }
}

// --- Minimal GIF decoder (so hand.gif playback speed can be driven manually) ---

async function decodeGifFrames(url) {
  const resp = await fetch(url);
  const buf = new Uint8Array(await resp.arrayBuffer());
  return parseGif(buf);
}

function parseGif(buf) {
  let p = 0;
  const readByte = () => buf[p++];
  const readU16 = () => { const v = buf[p] | (buf[p + 1] << 8); p += 2; return v; };
  const skipSubBlocks = () => {
    let size;
    while ((size = readByte()) !== 0) p += size;
  };
  const readSubBlocksBytes = () => {
    const bytes = [];
    let size;
    while ((size = readByte()) !== 0) {
      for (let i = 0; i < size; i++) bytes.push(readByte());
    }
    return bytes;
  };

  p = 6;
  const width = readU16();
  const height = readU16();
  const packed = readByte();
  const gctFlag = (packed & 0x80) !== 0;
  const gctSize = 2 << (packed & 0x07);
  readByte();
  readByte();
  let gct = null;
  if (gctFlag) {
    gct = [];
    for (let i = 0; i < gctSize; i++) gct.push([readByte(), readByte(), readByte()]);
  }

  const frames = [];
  let transparentIndex = -1;
  let delay = 100;
  let disposal = 0;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const cctx = canvas.getContext('2d');

  while (p < buf.length) {
    const block = readByte();
    if (block === 0x21) {
      const label = readByte();
      if (label === 0xF9) {
        readByte();
        const packedGCE = readByte();
        disposal = (packedGCE >> 2) & 0x07;
        const transFlag = packedGCE & 0x01;
        delay = readU16() * 10;
        transparentIndex = transFlag ? readByte() : -1;
        readByte();
      } else {
        skipSubBlocks();
      }
    } else if (block === 0x2C) {
      const left = readU16();
      const top = readU16();
      const w = readU16();
      const h = readU16();
      const packedImg = readByte();
      const lctFlag = (packedImg & 0x80) !== 0;
      const interlace = (packedImg & 0x40) !== 0;
      const lctSize = 2 << (packedImg & 0x07);
      let lct = gct;
      if (lctFlag) {
        lct = [];
        for (let i = 0; i < lctSize; i++) lct.push([readByte(), readByte(), readByte()]);
      }
      const minCodeSize = readByte();
      const data = readSubBlocksBytes();
      const indices = lzwDecode(data, minCodeSize, w * h);

      let disposalCanvas = null;
      if (disposal === 3) {
        disposalCanvas = document.createElement('canvas');
        disposalCanvas.width = width;
        disposalCanvas.height = height;
        disposalCanvas.getContext('2d').drawImage(canvas, 0, 0);
      }

      const frameImageData = cctx.getImageData(0, 0, width, height);
      writeIndicesToImageData(frameImageData, indices, lct, left, top, w, h, interlace, transparentIndex);
      cctx.putImageData(frameImageData, 0, 0);

      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = width;
      frameCanvas.height = height;
      frameCanvas.getContext('2d').drawImage(canvas, 0, 0);
      frames.push({ canvas: frameCanvas, delay: delay || 100 });

      if (disposal === 2) {
        cctx.clearRect(left, top, w, h);
      } else if (disposal === 3 && disposalCanvas) {
        cctx.clearRect(0, 0, width, height);
        cctx.drawImage(disposalCanvas, 0, 0);
      }
      disposal = 0;
      transparentIndex = -1;
    } else if (block === 0x3B) {
      break;
    } else {
      break;
    }
  }

  return { width, height, frames };
}

function lzwDecode(data, minCodeSize, pixelCount) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  const resetDict = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict[i] = [i];
    dict[clearCode] = [];
    dict[eoiCode] = null;
    codeSize = minCodeSize + 1;
  };
  resetDict();

  const output = new Uint8Array(pixelCount);
  let outPos = 0;
  let bitBuffer = 0, bitCount = 0, bytePos = 0;
  const readCode = () => {
    while (bitCount < codeSize) {
      bitBuffer |= (data[bytePos++] || 0) << bitCount;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << codeSize) - 1);
    bitBuffer >>= codeSize;
    bitCount -= codeSize;
    return code;
  };

  let prev = null;
  while (outPos < pixelCount) {
    const code = readCode();
    if (code === clearCode) { resetDict(); prev = null; continue; }
    if (code === eoiCode) break;
    let entry;
    if (dict[code]) entry = dict[code];
    else if (code === dict.length && prev) entry = prev.concat(prev[0]);
    else break;
    for (let i = 0; i < entry.length && outPos < pixelCount; i++) output[outPos++] = entry[i];
    if (prev) {
      dict.push(prev.concat(entry[0]));
      if (dict.length >= (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return output;
}

function writeIndicesToImageData(imageData, indices, palette, left, top, w, h, interlace, transparentIndex) {
  const data = imageData.data;
  const fullW = imageData.width;
  let idx = 0;
  const setPixel = (x, y) => {
    const colorIndex = indices[idx++];
    if (colorIndex === transparentIndex) return;
    const c = (palette && palette[colorIndex]) || [0, 0, 0];
    const di = ((top + y) * fullW + (left + x)) * 4;
    data[di] = c[0];
    data[di + 1] = c[1];
    data[di + 2] = c[2];
    data[di + 3] = 255;
  };
  if (!interlace) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(x, y);
  } else {
    const rows = [];
    for (let y = 0; y < h; y += 8) rows.push(y);
    for (let y = 4; y < h; y += 8) rows.push(y);
    for (let y = 2; y < h; y += 4) rows.push(y);
    for (let y = 1; y < h; y += 2) rows.push(y);
    for (const y of rows) for (let x = 0; x < w; x++) setPixel(x, y);
  }
}

function handIndexAtTime(t) {
  const hand = state.hand;
  if (!hand.frames || !hand.frames.length) return 0;
  const total = hand.totalDuration || 1;
  let tt = t % total;
  if (tt < 0) tt += total;
  let acc = 0;
  for (let i = 0; i < hand.frames.length; i++) {
    acc += hand.frames[i].delay || 100;
    if (tt < acc) return i;
  }
  return hand.frames.length - 1;
}

function advanceHandGif(dt) {
  const hand = state.hand;
  if (!hand.frames || !hand.frames.length) return;
  hand.playhead = (hand.playhead || 0) + dt * speedMultiplier();
  hand.frameIndex = handIndexAtTime(hand.playhead);
}

function clearCanvas(c) {
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  if (state.background !== 'transparent') {
    c.fillStyle = state.background;
    c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  }
}

function getSubjectSize() {
  if (!state.subject.img) return { w: 0, h: 0 };
  return {
    w: state.subject.baseW * state.subject.scale,
    h: state.subject.baseH * state.subject.scale
  };
}

function drawSubject(c, scale = 1) {
  if (!state.subject.img) return;
  const { w, h } = getSubjectSize();
  c.save();
  c.globalAlpha = state.subject.opacity;
  c.drawImage(
    state.subject.img,
    state.subject.x - w / 2,
    state.subject.y - h / 2,
    w,
    h
  );
  c.restore();
}

function waveTransform(frame) {
  const t = frame / FRAME_TOTAL;
  const angle = Math.sin(t * Math.PI * 2) * 16;
  const dx = Math.sin(t * Math.PI * 2 * 1.3) * SCENE_SIZE * 0.015;
  const dy = (Math.cos(t * Math.PI * 2) * 0.5 + 0.5) * SCENE_SIZE * 0.008;
  const scale = 1 + Math.sin(t * Math.PI * 4) * 0.025;
  return { angle, dx, dy, scale };
}

function drawHand(c, frame, handIndexOverride) {
  const hand = state.hand;
  const idx = handIndexOverride !== undefined ? handIndexOverride : (hand.frameIndex || 0);
  const source = (hand.frames && hand.frames[idx]) ? hand.frames[idx].canvas : hand.img;
  if (!source) return;
  const transform = waveTransform(frame);
  const baseW = hand.frameW || source.naturalWidth || source.width;
  const baseH = hand.frameH || source.naturalHeight || source.height;
  const w = baseW * hand.scale * transform.scale;
  const h = baseH * hand.scale * transform.scale;
  const pivotX = w * 0.43;
  const pivotY = h * 0.78;
  c.save();
  c.translate(hand.x + transform.dx, hand.y + transform.dy);
  c.rotate(transform.angle * Math.PI / 180);
  c.drawImage(source, -pivotX, -pivotY, w, h);
  c.restore();
}

function drawText(c) {
  if (!state.textValue) return;
  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `${state.fontWeight} ${state.fontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif`;
  c.lineJoin = 'round';
  const lines = state.textValue.split('\n');
  const lineH = state.fontSize * 1.1;
  const startY = state.text.y - ((lines.length - 1) * lineH) / 2;
  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineH;
    c.lineWidth = Math.max(5, state.fontSize * 0.18);
    c.strokeStyle = state.strokeColor;
    c.strokeText(lines[i], state.text.x, y);
    c.fillStyle = state.textColor;
    c.fillText(lines[i], state.text.x, y);
  }
  c.restore();
}

function render(frame = state.currentFrame) {
  clearCanvas(ctx);
  drawSubject(ctx);
  drawHand(ctx, frame);
  drawText(ctx);
  updateLabels();
}

function speedMultiplier() {
  return state.speed / 100;
}

function updateLabels() {
  $('activeLayerLabel').textContent = `目前：${layerLabel[state.activeLayer]}`;
  $('frameCount').textContent = `${FRAME_TOTAL} frames`;
  $('speedValue').textContent = `${Number(speedMultiplier().toFixed(2)).toString().replace(/\.00$/, '')}×`;
  $('fontSizeValue').textContent = `${state.fontSize}`;
  $('fontWeightValue').textContent = `${state.fontWeight}`;
  $('imageSizeValue').textContent = `${Math.round((state.subject.baseScale ? state.subject.scale / state.subject.baseScale : 1) * 100)}%`;
  $('imageOpacityValue').textContent = `${Math.round(state.subject.opacity * 100)}%`;
  $('outputSizeValue').textContent = `${state.outputSize} × ${state.outputSize}`;
  $('playToggle').textContent = state.playing ? '❚❚' : '▶';
}

function animate(now) {
  if (!lastTick) lastTick = now;
  const dt = Math.min(250, now - lastTick);
  lastTick = now;
  if (state.playing) {
    const interval = BASE_FRAME_MS / speedMultiplier();
    state.waveAcc = (state.waveAcc || 0) + dt;
    while (state.waveAcc >= interval) {
      state.currentFrame = (state.currentFrame + 1) % FRAME_TOTAL;
      state.waveAcc -= interval;
    }
    advanceHandGif(dt);
    render();
  }
  requestAnimationFrame(animate);
}

function canvasPoint(ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left) * SCENE_SIZE / rect.width,
    y: (ev.clientY - rect.top) * SCENE_SIZE / rect.height
  };
}

function approxTextBox() {
  if (!state.textValue) return null;
  ctx.save();
  ctx.font = `${state.fontWeight} ${state.fontSize}px ui-sans-serif, system-ui, sans-serif`;
  const widths = state.textValue.split('\n').map(line => ctx.measureText(line).width);
  ctx.restore();
  const width = Math.max(...widths, 0);
  return {
    x: state.text.x - width / 2 - 14,
    y: state.text.y - state.fontSize,
    w: width + 28,
    h: Math.max(1, state.textValue.split('\n').length) * state.fontSize * 1.1
  };
}

function hitTest(p) {
  const textBox = approxTextBox();
  if (textBox && p.x >= textBox.x && p.x <= textBox.x + textBox.w && p.y >= textBox.y && p.y <= textBox.y + textBox.h) return 'text';
  if (state.hand.img || state.hand.frames) {
    const w = (state.hand.frameW || state.hand.img.naturalWidth) * state.hand.scale;
    const h = (state.hand.frameH || state.hand.img.naturalHeight) * state.hand.scale;
    const box = { x: state.hand.x - w * 0.43, y: state.hand.y - h * 0.78, w, h };
    if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) return 'hand';
  }
  if (state.subject.img) {
    const { w, h } = getSubjectSize();
    const box = { x: state.subject.x - w / 2, y: state.subject.y - h / 2, w, h };
    if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) return 'subject';
  }
  return null;
}

function setActiveLayer(layer) {
  state.activeLayer = layer;
  document.querySelectorAll('.layer').forEach(btn => btn.classList.toggle('active', btn.dataset.layer === layer));
  $('activeLayerLabel').textContent = `目前：${layerLabel[layer]}`;
}

function getLayerPos(layer) {
  const obj = layer === 'subject' ? state.subject : layer === 'hand' ? state.hand : state.text;
  return { x: obj.x, y: obj.y };
}

function setLayerPos(layer, x, y) {
  const obj = layer === 'subject' ? state.subject : layer === 'hand' ? state.hand : state.text;
  obj.x = Math.max(-SCENE_SIZE, Math.min(SCENE_SIZE * 2, x));
  obj.y = Math.max(-SCENE_SIZE, Math.min(SCENE_SIZE * 2, y));
}

canvas.addEventListener('pointerdown', ev => {
  const p = canvasPoint(ev);
  const hit = hitTest(p);
  if (!hit) return;
  setActiveLayer(hit);
  const pos = getLayerPos(hit);
  pointer = { layer: hit, start: p, ox: pos.x, oy: pos.y };
  canvas.setPointerCapture(ev.pointerId);
});

canvas.addEventListener('pointermove', ev => {
  if (!pointer) return;
  const p = canvasPoint(ev);
  setLayerPos(pointer.layer, pointer.ox + p.x - pointer.start.x, pointer.oy + p.y - pointer.start.y);
  render();
});

canvas.addEventListener('pointerup', () => { pointer = null; });
canvas.addEventListener('pointercancel', () => { pointer = null; });

document.querySelectorAll('.layer').forEach(btn => {
  btn.addEventListener('click', () => setActiveLayer(btn.dataset.layer));
});

$('playToggle').addEventListener('click', () => {
  state.playing = !state.playing;
  lastTick = performance.now();
  updateLabels();
});

$('speed').addEventListener('input', e => {
  state.speed = Number(e.target.value);
  lastTick = performance.now();
  updateLabels();
  render();
});

$('imageSize').addEventListener('input', e => {
  state.subject.scale = state.subject.baseScale * Number(e.target.value) / 100;
  updateLabels();
  render();
});

$('imageOpacity').addEventListener('input', e => {
  state.subject.opacity = Number(e.target.value) / 100;
  updateLabels();
  render();
});

$('fontSize').addEventListener('input', e => {
  state.fontSize = Number(e.target.value);
  updateLabels();
  render();
});

$('fontWeight').addEventListener('input', e => {
  state.fontWeight = Number(e.target.value);
  updateLabels();
  render();
});

$('textInput').addEventListener('input', e => {
  state.textValue = e.target.value;
  render();
});

$('textColor').addEventListener('input', e => {
  state.textColor = e.target.value;
  render();
});

$('strokeColor').addEventListener('input', e => {
  state.strokeColor = e.target.value;
  render();
});

$('background').addEventListener('change', e => {
  state.background = e.target.value;
  render();
});

$('outputSize').addEventListener('input', e => {
  state.outputSize = Number(e.target.value);
  updateLabels();
});

function wireDropzone(zone, input, handler) {
  ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, e => {
    e.preventDefault();
    zone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, e => {
    e.preventDefault();
    zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', e => {
    const file = e.dataTransfer.files?.[0];
    if (file) handler(file);
  });
  input.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) handler(file);
  });
}

async function handleSubjectFile(file) {
  if (!file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  try {
    state.subject.img = await loadImage(url);
    resetSceneForSubject();
    $('imageFileLabel').textContent = file.name;
    $('emptyOverlay').hidden = true;
    $('statusText').textContent = '預覽中';
    setActiveLayer('subject');
    render();
  } finally {
    URL.revokeObjectURL(url);
  }
}

wireDropzone($('imageDropzone'), $('imageInput'), handleSubjectFile);

$('resetImageBtn').addEventListener('click', () => {
  if (!state.subject.img) return;
  resetSceneForSubject();
  state.subject.opacity = 1;
  $('imageOpacity').value = 100;
  setActiveLayer('subject');
  render();
});

$('resetTextBtn').addEventListener('click', () => {
  state.text.x = SCENE_SIZE / 2;
  state.text.y = Math.max(42, SCENE_SIZE * 0.12);
  setActiveLayer('text');
  render();
});

function makeExportCanvas(size) {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = size;
  exportCanvas.height = size;
  return exportCanvas;
}

function drawSceneAtSize(c, frame, size, handIndex) {
  const scale = size / SCENE_SIZE;
  clearCanvasOn(c, size);
  c.save();
  c.scale(scale, scale);
  drawSubject(c);
  drawHand(c, frame, handIndex);
  drawText(c);
  c.restore();
}

function clearCanvasOn(c, size) {
  c.clearRect(0, 0, size, size);
  if (state.background !== 'transparent') {
    c.fillStyle = state.background;
    c.fillRect(0, 0, size, size);
  }
}

function renderFrameToImageData(exportCanvas, frame, handIndex) {
  drawSceneAtSize(exportCanvas, frame, state.outputSize, handIndex);
  return exportCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, state.outputSize, state.outputSize);
}

class GIFEncoder {
  constructor(width, height, options = {}) {
    this.width = width;
    this.height = height;
    this.frames = [];
    this.repeat = options.repeat ?? 0;
    this.delay = options.delay ?? 100;
    this.transparent = !!options.transparent;
  }

  addFrame(imageData, delay = this.delay) {
    this.frames.push({ pixels: imageData.data, delay });
  }

  encode(onProgress = () => {}) {
    const palette = buildPalette(this.frames, this.width, this.height, this.transparent);
    const out = [];
    pushASCII(out, 'GIF89a');
    pushU16(out, this.width);
    pushU16(out, this.height);
    out.push(0x80 | 0x70 | 7, 0, 0);
    for (let i = 0; i < 256; i++) {
      const c = palette.colors[i] || [0, 0, 0];
      out.push(c[0], c[1], c[2]);
    }
    out.push(0x21, 0xFF, 0x0B);
    pushASCII(out, 'NETSCAPE2.0');
    out.push(0x03, 0x01);
    pushU16(out, this.repeat);
    out.push(0x00);

    for (let fi = 0; fi < this.frames.length; fi++) {
      const fr = this.frames[fi];
      const delayCs = Math.max(1, Math.round(fr.delay / 10));
      out.push(0x21, 0xF9, 0x04);
      out.push(this.transparent ? 0x01 : 0x00);
      pushU16(out, delayCs);
      out.push(0, 0);
      out.push(0x2C);
      pushU16(out, 0);
      pushU16(out, 0);
      pushU16(out, this.width);
      pushU16(out, this.height);
      out.push(0x00);
      const indexed = mapPixels(fr.pixels, palette, this.transparent);
      const compressed = lzwEncode(indexed, 8);
      out.push(8);
      for (let i = 0; i < compressed.length; i += 255) {
        const n = Math.min(255, compressed.length - i);
        out.push(n);
        for (let j = 0; j < n; j++) out.push(compressed[i + j]);
      }
      out.push(0x00);
      onProgress((fi + 1) / this.frames.length);
    }
    out.push(0x3B);
    return new Uint8Array(out);
  }
}

function pushASCII(arr, s) {
  for (let i = 0; i < s.length; i++) arr.push(s.charCodeAt(i));
}

function pushU16(arr, n) {
  arr.push(n & 255, (n >> 8) & 255);
}

function collectSamples(frames, w, h, transparent) {
  const maxSamples = 22000;
  const total = Math.max(1, w * h * frames.length);
  const step = Math.max(1, Math.ceil(Math.sqrt(total / maxSamples)));
  const samples = [];
  for (const fr of frames) {
    const p = fr.pixels;
    for (let y = 0; y < h; y += step) {
      const row = y * w * 4;
      for (let x = 0; x < w; x += step) {
        const i = row + x * 4;
        if (transparent && p[i + 3] < 128) continue;
        samples.push((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]);
      }
    }
  }
  return samples.length ? samples : [0x808080];
}

function bucketStats(data) {
  let r0 = 255, r1 = 0, g0 = 255, g1 = 0, b0 = 255, b1 = 0;
  for (const v of data) {
    const r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    g0 = Math.min(g0, g); g1 = Math.max(g1, g);
    b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  return { r0, r1, g0, g1, b0, b1 };
}

function buildPalette(frames, w, h, transparent) {
  const samples = collectSamples(frames, w, h, transparent);
  const target = transparent ? 255 : 256;
  const buckets = [samples];
  while (buckets.length < target) {
    let idx = -1, best = -1, channel = 0;
    for (let i = 0; i < buckets.length; i++) {
      const d = bucketStats(buckets[i]);
      const ranges = [d.r1 - d.r0, d.g1 - d.g0, d.b1 - d.b0];
      const score = Math.max(...ranges);
      if (buckets[i].length > 1 && score > best) {
        best = score;
        idx = i;
        channel = ranges.indexOf(score);
      }
    }
    if (idx < 0) break;
    const data = buckets[idx];
    if (channel === 0) data.sort((a, b) => (a >> 16) - (b >> 16));
    else if (channel === 1) data.sort((a, b) => ((a >> 8) & 255) - ((b >> 8) & 255));
    else data.sort((a, b) => (a & 255) - (b & 255));
    const mid = Math.floor(data.length / 2);
    buckets.splice(idx, 1, data.slice(0, mid), data.slice(mid));
  }
  const colors = [];
  if (transparent) colors.push([0, 0, 0]);
  for (const bucket of buckets) {
    let rs = 0, gs = 0, bs = 0;
    for (const v of bucket) {
      rs += v >> 16;
      gs += (v >> 8) & 255;
      bs += v & 255;
    }
    const n = bucket.length;
    colors.push([Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)]);
  }
  while (colors.length < 256) colors.push(colors[colors.length - 1] || [0, 0, 0]);
  return { colors, lookup: buildLookup(colors, transparent) };
}

function buildLookup(colors, transparent) {
  const lookup = new Uint8Array(32768);
  const start = transparent ? 1 : 0;
  for (let r5 = 0; r5 < 32; r5++) {
    for (let g5 = 0; g5 < 32; g5++) {
      for (let b5 = 0; b5 < 32; b5++) {
        const r = r5 * 8 + 4, g = g5 * 8 + 4, b = b5 * 8 + 4;
        let bi = start, bd = Infinity;
        for (let i = start; i < 256; i++) {
          const c = colors[i];
          const dr = r - c[0], dg = g - c[1], db = b - c[2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) {
            bd = d;
            bi = i;
            if (d === 0) break;
          }
        }
        lookup[(r5 << 10) | (g5 << 5) | b5] = bi;
      }
    }
  }
  return lookup;
}

function mapPixels(p, palette, transparent) {
  const out = new Uint8Array(p.length / 4);
  const lookup = palette.lookup;
  for (let i = 0, o = 0; i < p.length; i += 4, o++) {
    if (transparent && p[i + 3] < 128) {
      out[o] = 0;
      continue;
    }
    out[o] = lookup[((p[i] >> 3) << 10) | ((p[i + 1] >> 3) << 5) | (p[i + 2] >> 3)];
  }
  return out;
}

function lzwEncode(data, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let next = end + 1;
  const dict = new Map();
  const bytes = [];
  let cur = 0, bits = 0;
  const emit = code => {
    cur |= code << bits;
    bits += minCodeSize + 1;
    while (bits >= 8) {
      bytes.push(cur & 255);
      cur >>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = data[0] ?? 0;
  for (let i = 1; i < data.length; i++) {
    const k = data[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 512) {
      dict.set(key, next++);
      if (next >= 512) {
        emit(clear);
        dict.clear();
        next = end + 1;
      }
    } else {
      emit(clear);
      dict.clear();
      next = end + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (bits > 0) bytes.push(cur & 255);
  return bytes;
}

async function exportGif() {
  if (!state.subject.img) {
    alert('請先上傳一張圖片');
    return;
  }
  const run = ++resultGeneration;
  $('exportBtn').disabled = true;
  $('progressArea').hidden = false;
  $('resultArea').hidden = true;
  $('statusText').textContent = '正在合成 GIF';
  $('progressText').textContent = '建立動畫幀…';
  $('progressBar').style.width = '0%';

  await new Promise(requestAnimationFrame);
  const frames = [];
  const exportCanvas = makeExportCanvas(state.outputSize);
  const delay = BASE_FRAME_MS / speedMultiplier();

  for (let i = 0; i < FRAME_TOTAL; i++) {
    const handIndex = handIndexAtTime(i * BASE_FRAME_MS * speedMultiplier());
    frames.push(renderFrameToImageData(exportCanvas, i, handIndex));
    $('progressBar').style.width = `${Math.round((i + 1) / FRAME_TOTAL * 25)}%`;
    await new Promise(r => setTimeout(r, 0));
  }

  const encoder = new GIFEncoder(state.outputSize, state.outputSize, {
    repeat: 0,
    transparent: state.background === 'transparent'
  });
  frames.forEach(imageData => encoder.addFrame(imageData, delay));
  const bytes = encoder.encode(progress => {
    $('progressBar').style.width = `${25 + Math.round(progress * 70)}%`;
    $('progressText').textContent = `編碼 GIF… ${Math.round(progress * 100)}%`;
  });

  const blob = new Blob([bytes], { type: 'image/gif' });
  const url = URL.createObjectURL(blob);
  if (run !== resultGeneration) return;
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultUrl = url;
  $('resultImage').src = url;
  $('downloadLink').href = url;
  $('resultArea').hidden = false;
  $('progressBar').style.width = '100%';
  $('progressText').textContent = `完成 · ${(blob.size / 1024).toFixed(0)} KB`;
  $('statusText').textContent = 'GIF 已完成';
  $('exportBtn').disabled = false;
}

$('exportBtn').addEventListener('click', exportGif);

setCanvasSize();
loadDefaultHand();
updateLabels();
render();
requestAnimationFrame(animate);

window.petwave = { state, render, exportGif, handleSubjectFile, loadImage };
