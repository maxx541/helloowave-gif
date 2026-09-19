
const $ = (id) => document.getElementById(id);
const canvas = $('previewCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const state = {
  subject: { img: null, x: 200, y: 220, scale: 1, baseScale: 1, baseW: 0, baseH: 0, opacity: 1 },
  hand: { img: null, x: 248, y: 86, scale: .56, angle: 0, opacity: 1 },
  text: { x: 200, y: 48 },
  textValue: '嗨！',
  fontSize: 42,
  fontWeight: 700,
  textColor: '#ffffff',
  strokeColor: '#111111',
  fps: 12,
  wave: 18,
  background: 'transparent',
  size: 400,
  activeLayer: 'subject',
  playing: true,
  currentFrame: 0,
  resultUrl: null,
};

const layerLabel = { subject: '圖片', hand: '手掌', text: '文字' };
let raf = 0;
let lastTick = 0;
let pointer = null;
let resultGeneration = 0;

function setCanvasSize(size) {
  canvas.width = size;
  canvas.height = size;
  $('frameCount').textContent = `${frameTotal()} frames`;
  fitInitialPositions(false);
}

function frameTotal() { return Math.max(6, Math.round(state.fps)); }

function fitInitialPositions(force = false) {
  if (!state.subject.img) return;
  const maxW = state.size * 0.78;
  const maxH = state.size * 0.72;
  const s = Math.min(maxW / state.subject.img.naturalWidth, maxH / state.subject.img.naturalHeight, 1);
  if (force || !state.subject.baseW) {
    state.subject.baseScale = s;
    state.subject.scale = s;
    if ($('imageSize')) $('imageSize').value = 100;
    state.subject.baseW = state.subject.img.naturalWidth;
    state.subject.baseH = state.subject.img.naturalHeight;
    state.subject.x = state.size / 2;
    state.subject.y = state.size * 0.58;
  }
  if (force) {
    state.hand.x = state.size * .72;
    state.hand.y = state.size * .70;
    state.hand.scale = Math.max(.36, state.size / 770);
    if ($('handSize')) $('handSize').value = 100;
    state.text.x = state.size / 2;
    state.text.y = Math.max(42, state.size * .12);
  }
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
    render();
  } catch (e) {
    $('statusText').textContent = '找不到 assets/hand.gif，請直接上傳手掌素材';
  }
}

function drawCheckerOrBackground(c) {
  if (state.background === 'transparent') return;
  c.save();
  c.fillStyle = state.background;
  c.fillRect(0, 0, state.size, state.size);
  c.restore();
}

function getSubjectSize() {
  if (!state.subject.img) return { w: 0, h: 0 };
  return { w: state.subject.baseW * state.subject.scale, h: state.subject.baseH * state.subject.scale };
}

function drawSubject(c) {
  if (!state.subject.img) return;
  const { w, h } = getSubjectSize();
  c.save();
  c.globalAlpha = state.subject.opacity;
  c.drawImage(state.subject.img, state.subject.x - w / 2, state.subject.y - h / 2, w, h);
  c.restore();
}

function waveTransform(frame) {
  const n = frameTotal();
  const t = n <= 1 ? 0 : frame / (n - 1);
  const radians = (t * Math.PI * 2) - Math.PI / 2;
  const angle = Math.sin(radians) * state.wave;
  const dx = Math.sin(radians * 1.3) * state.size * 0.015;
  const dy = (Math.cos(radians) * 0.5 + 0.5) * state.size * 0.008;
  const scale = 1 + Math.sin(radians * 2) * 0.025;
  return { angle, dx, dy, scale };
}

function drawHand(c, frame) {
  if (!state.hand.img) return;
  const img = state.hand.img;
  const transform = waveTransform(frame);
  const w = img.naturalWidth * state.hand.scale * transform.scale;
  const h = img.naturalHeight * state.hand.scale * transform.scale;
  const pivotX = w * 0.43;
  const pivotY = h * 0.78;
  c.save();
  c.globalAlpha = state.hand.opacity;
  c.translate(state.hand.x + transform.dx, state.hand.y + transform.dy);
  c.rotate(transform.angle * Math.PI / 180);
  c.drawImage(img, -pivotX, -pivotY, w, h);
  c.restore();
}

function drawText(c) {
  const text = state.textValue;
  if (!text) return;
  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `${state.fontWeight} ${state.fontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif`;
  c.lineJoin = 'round';
  const lines = text.split('\n');
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

function drawSelection(c) {
  if (!pointer || $('emptyOverlay').hasAttribute('hidden') === false) return;
  let box = null;
  if (state.activeLayer === 'subject' && state.subject.img) {
    const { w, h } = getSubjectSize();
    box = { x: state.subject.x - w/2, y: state.subject.y - h/2, w, h };
  } else if (state.activeLayer === 'hand' && state.hand.img) {
    const w = state.hand.img.naturalWidth * state.hand.scale;
    const h = state.hand.img.naturalHeight * state.hand.scale;
    box = { x: state.hand.x - w*.43, y: state.hand.y - h*.78, w, h };
  } else if (state.activeLayer === 'text' && state.textValue) {
    ctx.save();
    ctx.font = `${state.fontWeight} ${state.fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const width = Math.max(...state.textValue.split('\n').map(x => c.measureText(x).width));
    ctx.restore();
  }
  if (!box) return;
  c.save();
  c.strokeStyle = 'rgba(255,106,61,.95)';
  c.lineWidth = 2;
  c.setLineDash([6,5]);
  c.strokeRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
  c.restore();
}

function render(frame = state.currentFrame) {
  ctx.clearRect(0, 0, state.size, state.size);
  drawCheckerOrBackground(ctx);
  drawSubject(ctx);
  drawHand(ctx, frame);
  drawText(ctx);
  updateLabels();
}

function updateLabels() {
  $('activeLayerLabel').textContent = `目前：${layerLabel[state.activeLayer]}`;
  $('frameCount').textContent = `${frameTotal()} frames`;
  $('fpsValue').textContent = `${state.fps} FPS`;
  $('waveValue').textContent = `${state.wave}°`;
  $('fontSizeValue').textContent = `${state.fontSize}`;
  $('fontWeightValue').textContent = `${state.fontWeight}`;
  $('imageSizeValue').textContent = `${Math.round(state.subject.scale / state.subject.baseScale * 100)}%`;
  $('imageOpacityValue').textContent = `${Math.round(state.subject.opacity * 100)}%`;
  $('handSizeValue').textContent = `${Math.round(state.hand.scale / Math.max(.36, state.size / 770) * 100)}%`;
  $('handOpacityValue').textContent = `${Math.round(state.hand.opacity * 100)}%`;
  $('outputSizeValue').textContent = `${state.size} × ${state.size}`;
  $('playToggle').textContent = state.playing ? '❚❚' : '▶';
}

function animate(now) {
  const interval = 1000 / state.fps;
  if (!lastTick) lastTick = now;
  if (state.playing && now - lastTick >= interval) {
    state.currentFrame = (state.currentFrame + Math.max(1, Math.floor((now-lastTick)/interval))) % frameTotal();
    lastTick = now;
    render();
  }
  raf = requestAnimationFrame(animate);
}

function canvasPoint(ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left) * canvas.width / rect.width,
    y: (ev.clientY - rect.top) * canvas.height / rect.height,
  };
}

function approxTextBox() {
  ctx.save();
  ctx.font = `${state.fontWeight} ${state.fontSize}px ui-sans-serif, system-ui, sans-serif`;
  const widths = state.textValue.split('\n').map(line => ctx.measureText(line).width);
  ctx.restore();
  return { x: state.text.x - Math.max(...widths, 0)/2 - 12, y: state.text.y - state.fontSize, w: Math.max(...widths, 0) + 24, h: Math.max(1, state.textValue.split('\n').length) * state.fontSize * 1.1 };
}

function hitTest(p) {
  if (state.textValue) {
    const b = approxTextBox();
    if (p.x >= b.x && p.x <= b.x+b.w && p.y >= b.y && p.y <= b.y+b.h) return 'text';
  }
  if (state.hand.img) {
    const w = state.hand.img.naturalWidth * state.hand.scale;
    const h = state.hand.img.naturalHeight * state.hand.scale;
    const b = { x:state.hand.x-w*.43, y:state.hand.y-h*.78, w, h };
    if (p.x >= b.x && p.x <= b.x+b.w && p.y >= b.y && p.y <= b.y+b.h) return 'hand';
  }
  if (state.subject.img) {
    const {w,h}=getSubjectSize();
    const b = {x:state.subject.x-w/2,y:state.subject.y-h/2,w,h};
    if (p.x >= b.x && p.x <= b.x+b.w && p.y >= b.y && p.y <= b.y+b.h) return 'subject';
  }
  return null;
}

function setActiveLayer(layer) {
  state.activeLayer = layer;
  document.querySelectorAll('.layer').forEach(btn => btn.classList.toggle('active', btn.dataset.layer === layer));
  $('activeLayerLabel').textContent = `目前：${layerLabel[layer]}`;
}

canvas.addEventListener('pointerdown', (ev) => {
  const p = canvasPoint(ev);
  const hit = hitTest(p);
  if (!hit) return;
  setActiveLayer(hit);
  pointer = { layer:hit, start:p, ox: getLayerPos(hit).x, oy:getLayerPos(hit).y };
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', (ev) => {
  if (!pointer) return;
  const p = canvasPoint(ev);
  const dx = p.x - pointer.start.x;
  const dy = p.y - pointer.start.y;
  setLayerPos(pointer.layer, pointer.ox + dx, pointer.oy + dy);
  render();
});
function endPointer() { pointer = null; }
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function getLayerPos(layer) {
  if (layer==='subject') return {x:state.subject.x,y:state.subject.y};
  if (layer==='hand') return {x:state.hand.x,y:state.hand.y};
  return {x:state.text.x,y:state.text.y};
}
function setLayerPos(layer,x,y) {
  const obj = layer==='subject' ? state.subject : layer==='hand' ? state.hand : state.text;
  obj.x = Math.max(-state.size, Math.min(state.size*2, x));
  obj.y = Math.max(-state.size, Math.min(state.size*2, y));
}

document.querySelectorAll('.layer').forEach(btn => btn.addEventListener('click', () => setActiveLayer(btn.dataset.layer)));
$('playToggle').addEventListener('click', () => { state.playing=!state.playing; updateLabels(); });

function bindPercentRange(id, key, valueId, target) {
  $(id).addEventListener('input', e => {
    const value = Number(e.target.value) / 100;
    state[target][key] = target === 'subject' && key === 'scale' ? state.subject.baseScale * value : target === 'hand' && key === 'scale' ? Math.max(.36, state.size / 770) * value : value;
    updateLabels();
    render();
  });
}

bindPercentRange('imageSize', 'scale', 'imageSizeValue', 'subject');
bindPercentRange('imageOpacity', 'opacity', 'imageOpacityValue', 'subject');
bindPercentRange('handSize', 'scale', 'handSizeValue', 'hand');
bindPercentRange('handOpacity', 'opacity', 'handOpacityValue', 'hand');

function bindRange(id, key, valueId) {
  $(id).addEventListener('input', e => { state[key] = Number(e.target.value); updateLabels(); render(); });
}
bindRange('fps','fps','fpsValue');
bindRange('wave','wave','waveValue');
bindRange('fontSize','fontSize','fontSizeValue');
bindRange('fontWeight','fontWeight','fontWeightValue');
$('textInput').addEventListener('input', e => { state.textValue=e.target.value; render(); });
$('textColor').addEventListener('input', e => { state.textColor=e.target.value; render(); });
$('strokeColor').addEventListener('input', e => { state.strokeColor=e.target.value; render(); });
$('background').addEventListener('change', e => { state.background=e.target.value; render(); });
$('outputSize').addEventListener('input', e => { state.size=Number(e.target.value); setCanvasSize(state.size); render(); });

function wireDropzone(zone, input, handler) {
  ;['dragenter','dragover'].forEach(type => zone.addEventListener(type, e => {e.preventDefault(); zone.classList.add('dragover');}));
  ;['dragleave','drop'].forEach(type => zone.addEventListener(type, e => {e.preventDefault(); zone.classList.remove('dragover');}));
  zone.addEventListener('drop', e => { const file=e.dataTransfer.files?.[0]; if (file) handler(file); });
  input.addEventListener('change', e => { const file=e.target.files?.[0]; if(file) handler(file); });
}

async function handleSubjectFile(file) {
  if (!file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  try {
    state.subject.img = await loadImage(url);
    state.subject.baseW=0; fitInitialPositions(true);
    $('imageFileLabel').textContent = file.name;
    $('emptyOverlay').hidden = true;
    $('statusText').textContent = '預覽中';
    setActiveLayer('subject');
    render();
  } finally { URL.revokeObjectURL(url); }
}
async function handleHandFile(file) {
  if (!file.type.startsWith('image/')) return;
  const url=URL.createObjectURL(file);
  try { state.hand.img=await loadImage(url); $('statusText').textContent='預覽中'; setActiveLayer('hand'); render(); }
  finally { URL.revokeObjectURL(url); }
}
wireDropzone($('imageDropzone'), $('imageInput'), handleSubjectFile);
wireDropzone(document.querySelector('.dropzone.compact'), $('handInput'), handleHandFile);

$('resetImageBtn').addEventListener('click', () => { if(state.subject.img) { fitInitialPositions(true); state.subject.opacity=1; $('imageSize').value=100; $('imageOpacity').value=100; setActiveLayer('subject'); render(); } });
$('resetHandBtn').addEventListener('click', () => { state.hand.x=state.size*.72; state.hand.y=state.size*.70; state.hand.scale=Math.max(.36,state.size/770); state.hand.opacity=1; $('handSize').value=100; $('handOpacity').value=100; setActiveLayer('hand'); render(); });
$('resetTextBtn').addEventListener('click', () => { state.text.x=state.size/2; state.text.y=Math.max(42,state.size*.12); setActiveLayer('text'); render(); });

class GIFEncoder {
  constructor(width, height, options={}) {
    this.width=width; this.height=height;
    this.frames=[]; this.repeat=options.repeat ?? 0;
    this.delay=options.delay ?? 100;
    this.transparent=!!options.transparent;
  }
  addFrame(imageData, delay=this.delay) { this.frames.push({pixels:imageData.data,delay}); }

  encode(onProgress=()=>{}) {
    const palette = buildPalette(this.frames, this.width, this.height, this.transparent);
    const out=[];
    pushASCII(out,'GIF89a');
    pushU16(out,this.width); pushU16(out,this.height);
    const gctSizeBits=7;
    out.push(0x80 | 0x70 | gctSizeBits);
    out.push(0); out.push(0);
    for (let i=0;i<256;i++) { const c=palette.colors[i]||[0,0,0]; out.push(c[0],c[1],c[2]); }
    out.push(0x21,0xFF,0x0B); pushASCII(out,'NETSCAPE2.0');
    out.push(0x03,0x01); pushU16(out,this.repeat); out.push(0x00);

    for (let fi=0; fi<this.frames.length; fi++) {
      const fr=this.frames[fi];
      const delayCs=Math.max(1,Math.round(fr.delay/10));
      out.push(0x21,0xF9,0x04);
      out.push(this.transparent ? 0x01 : 0x00);
      pushU16(out,delayCs);
      out.push(0); out.push(0);
      out.push(0x2C); pushU16(out,0); pushU16(out,0); pushU16(out,this.width); pushU16(out,this.height);
      out.push(0x00);
      const indexed = mapPixels(fr.pixels,palette,this.transparent);
      const compressed = lzwEncode(indexed,8);
      out.push(8);
      for (let i=0;i<compressed.length;i+=255) {
        const n=Math.min(255,compressed.length-i); out.push(n);
        for(let j=0;j<n;j++) out.push(compressed[i+j]);
      }
      out.push(0x00);
      onProgress((fi+1)/this.frames.length);
    }
    out.push(0x3B);
    return new Uint8Array(out);
  }
}

function pushASCII(arr,s){for(let i=0;i<s.length;i++)arr.push(s.charCodeAt(i));}
function pushU16(arr,n){arr.push(n&255,(n>>8)&255);}
function collectSamples(frames,w,h,transparent){
  const maxSamples=22000;
  const total=Math.max(1,w*h*frames.length);
  const step=Math.max(1,Math.ceil(Math.sqrt(total/maxSamples)));
  const samples=[];
  for(const fr of frames){
    const p=fr.pixels;
    for(let y=0;y<h;y+=step){
      const row=y*w*4;
      for(let x=0;x<w;x+=step){
        const i=row+x*4;
        if(transparent && p[i+3]<128) continue;
        samples.push((p[i]<<16)|(p[i+1]<<8)|p[i+2]);
      }
    }
  }
  return samples.length ? samples : [0x808080];
}
function bucketStats(data){
  let r0=255,r1=0,g0=255,g1=0,b0=255,b1=0;
  for(const v of data){const r=v>>16,g=(v>>8)&255,b=v&255;r0=Math.min(r0,r);r1=Math.max(r1,r);g0=Math.min(g0,g);g1=Math.max(g1,g);b0=Math.min(b0,b);b1=Math.max(b1,b);}
  return {r0,r1,g0,g1,b0,b1};
}
function buildPalette(frames,w,h,transparent){
  const samples=collectSamples(frames,w,h,transparent);
  const target=transparent?255:256;
  const buckets=[samples];
  while(buckets.length<target){
    let idx=-1,best=-1, channel=0;
    for(let i=0;i<buckets.length;i++){
      const d=bucketStats(buckets[i]);
      const ranges=[d.r1-d.r0,d.g1-d.g0,d.b1-d.b0];
      const score=Math.max(...ranges);
      if(buckets[i].length>1 && score>best){best=score;idx=i;channel=ranges.indexOf(score);}
    }
    if(idx<0) break;
    const data=buckets[idx];
    if(channel===0) data.sort((a,b)=>(a>>16)-(b>>16));
    else if(channel===1) data.sort((a,b)=>((a>>8)&255)-((b>>8)&255));
    else data.sort((a,b)=>(a&255)-(b&255));
    const mid=Math.floor(data.length/2);
    buckets.splice(idx,1,data.slice(0,mid),data.slice(mid));
  }
  const colors=[];
  if(transparent) colors.push([0,0,0]);
  for(const bucket of buckets){let rs=0,gs=0,bs=0;for(const v of bucket){rs+=v>>16;gs+=(v>>8)&255;bs+=v&255;}const n=bucket.length;colors.push([Math.round(rs/n),Math.round(gs/n),Math.round(bs/n)]);}
  while(colors.length<256) colors.push(colors[colors.length-1]||[0,0,0]);
  return {colors, lookup:buildLookup(colors,transparent)};
}
function buildLookup(colors,transparent){
  const lookup=new Uint8Array(32768);
  const start=transparent?1:0;
  for(let r5=0;r5<32;r5++)for(let g5=0;g5<32;g5++)for(let b5=0;b5<32;b5++){
    const r=r5*8+4,g=g5*8+4,b=b5*8+4;let bi=start,bd=Infinity;
    for(let i=start;i<256;i++){const c=colors[i];const dr=r-c[0],dg=g-c[1],db=b-c[2];const d=dr*dr+dg*dg+db*db;if(d<bd){bd=d;bi=i;if(d===0)break;}}
    lookup[(r5<<10)|(g5<<5)|b5]=bi;
  }
  return lookup;
}
function mapPixels(p,palette,transparent){
  const out=new Uint8Array(p.length/4), lookup=palette.lookup;
  for(let i=0,o=0;i<p.length;i+=4,o++){
    if(transparent && p[i+3]<128){out[o]=0;continue;}
    out[o]=lookup[((p[i]>>3)<<10)|((p[i+1]>>3)<<5)|(p[i+2]>>3)];
  }
  return out;
}
function lzwEncode(data,minCodeSize){
  const clear=1<<minCodeSize,end=clear+1;
  const codeSize=minCodeSize+1;
  let next=end+1;
  const dict=new Map();
  const bytes=[];let cur=0,bits=0;
  const emit=(code)=>{cur|=code<<bits;bits+=codeSize;while(bits>=8){bytes.push(cur&255);cur>>=8;bits-=8;}};
  emit(clear);
  let prefix=data[0] ?? 0;
  for(let i=1;i<data.length;i++){
    const k=data[i],key=(prefix<<8)|k, found=dict.get(key);
    if(found!==undefined){prefix=found;continue;}
    emit(prefix);
    if(next<512){
      dict.set(key,next++);
      if(next>=512){
        emit(clear);
        dict.clear();
        next=end+1;
      }
    } else {
      emit(clear);
      dict.clear();
      next=end+1;
    }
    prefix=k;
  }
  emit(prefix);emit(end);if(bits>0)bytes.push(cur&255);
  return bytes;
}

function renderFrameToImageData(frame) {
  ctx.clearRect(0,0,state.size,state.size);
  drawCheckerOrBackground(ctx);
  drawSubject(ctx);
  drawHand(ctx,frame);
  drawText(ctx);
  return ctx.getImageData(0,0,state.size,state.size);
}

async function exportGif() {
  if(!state.subject.img){ alert('請先上傳一張圖片'); return; }
  const run=++resultGeneration;
  $('exportBtn').disabled=true;
  $('progressArea').hidden=false;
  $('resultArea').hidden=true;
  $('statusText').textContent='正在合成 GIF';
  $('progressText').textContent='建立動畫幀…';
  $('progressBar').style.width='0%';

  await new Promise(r=>requestAnimationFrame(r));
  const frames=[];
  const total=frameTotal();
  for(let i=0;i<total;i++){
    frames.push(renderFrameToImageData(i));
    $('progressBar').style.width=`${Math.round((i+1)/total*25)}%`;
    await new Promise(r=>setTimeout(r,0));
  }
  const encoder=new GIFEncoder(state.size,state.size,{repeat:0,transparent:state.background==='transparent'});
  frames.forEach(img=>encoder.addFrame(img,1000/state.fps));
  const bytes=encoder.encode(p=>{
    $('progressBar').style.width=`${25+Math.round(p*70)}%`;
    $('progressText').textContent=`編碼 GIF… ${Math.round(p*100)}%`;
  });
  const blob=new Blob([bytes],{type:'image/gif'});
  const url=URL.createObjectURL(blob);
  if(run!==resultGeneration)return;
  if(state.resultUrl)URL.revokeObjectURL(state.resultUrl);
  state.resultUrl=url;
  $('resultImage').src=url;
  $('downloadLink').href=url;
  $('resultArea').hidden=false;
  $('progressBar').style.width='100%';
  $('progressText').textContent=`完成 · ${(blob.size/1024).toFixed(0)} KB`;
  $('statusText').textContent='GIF 已完成';
  $('exportBtn').disabled=false;
}
$('exportBtn').addEventListener('click', exportGif);

setCanvasSize(state.size);
loadDefaultHand();
updateLabels();
render();
raf=requestAnimationFrame(animate);

window.petwave = { state, render, exportGif, loadImage, handleSubjectFile, handleHandFile };
