// Sketchtation's editing surface lives on the website itself.
import { PENS, renderDrawing } from './brushes.js';
const highlightCanvas=document.createElement('canvas');
highlightCanvas.id='st-highlight-layer';
document.body.append(highlightCanvas);
const canvas=document.createElement('canvas');
canvas.id='sketch-layer';
document.body.append(canvas);
const picker=document.createElement('div');
picker.id='st-picker';
picker.innerHTML='<span></span>';
document.body.append(picker);
const annotation=document.createElement('form');
annotation.id='st-annotation-pill';
annotation.hidden=true;
annotation.innerHTML='<span class="st-annotation-dot" aria-hidden="true"></span><input id="st-annotation-input" type="text" placeholder="Add a comment…" aria-label="Annotation comment"><button type="submit" aria-label="Save annotation">✓</button>';
document.body.append(annotation);
const toast=document.createElement('div');
toast.id='st-toast';toast.hidden=true;document.body.append(toast);
const routeKey=()=>location.pathname;
let activeRoute=routeKey();
let toastTimer;
function showToast(text){toast.textContent=text;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.hidden=true,5500);}
const markerMenu=document.createElement('div');
markerMenu.id='st-marker-menu';markerMenu.hidden=true;
markerMenu.innerHTML='<p></p><button type="button">Remove comment</button>';
document.body.append(markerMenu);
function openMarker(item,pin){markerMenu.querySelector('p').textContent=item.note.split('\n')[0];markerMenu.hidden=false;const r=pin.getBoundingClientRect();markerMenu.style.left=Math.max(12,Math.min(r.right+8,innerWidth-markerMenu.offsetWidth-12))+'px';markerMenu.style.top=Math.max(12,Math.min(r.top,innerHeight-markerMenu.offsetHeight-12))+'px';markerMenu.querySelector('button').onclick=async()=>{try{const response=await fetch(`/__sketchtation/api/annotations?id=${encodeURIComponent(item.id)}`,{method:'DELETE'});const result=await response.json();if(!response.ok)throw new Error(result.error);pin.remove();markerMenu.hidden=true;document.querySelectorAll('.st-comment-pin').forEach((p,i)=>p.textContent=String(i+1));showToast('Comment removed.');}catch(error){showToast(error.message);}};}
function showMarker(item,index){if(!item.target||(item.route||'/')!==activeRoute||document.querySelector(`[data-comment-id="${item.id}"]`))return;const pin=document.createElement('button');pin.className='st-comment-pin';pin.dataset.commentId=item.id;pin.dataset.note=item.note.split('\n')[0].slice(0,160);pin.textContent=String(index);pin.setAttribute('aria-label',`Comment ${index}: ${pin.dataset.note}`);pin.style.left=item.target.x+'px';pin.style.top=item.target.y+'px';pin.onclick=()=>openMarker(item,pin);document.body.append(pin);}
async function loadMarkers(){const route=activeRoute;try{const response=await fetch(`/__sketchtation/api/annotations?route=${encodeURIComponent(route)}`);if(!response.ok)throw new Error();const items=await response.json();if(route===activeRoute)items.forEach((item,index)=>showMarker(item,index+1));}catch{}}
const bar=document.createElement('div');
bar.id='sketchtation';
const svg=paths=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons={view:svg('<path d="m5 3 14 9-7 1-3 7-4-17Z"/>'),note:svg('<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5h5"/><circle cx="18" cy="6" r="3"/>'),draw:svg('<path d="m4 20 4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z"/><path d="m14 7 3 3"/>'),erase:svg('<path d="m4 15 9-10a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-7 8H8l-4-4a1 1 0 0 1 0-1Z"/><path d="M8 20h12"/>'),clear:svg('<path d="M5 5l14 14M19 5 5 19"/>'),send:svg('<path d="M5 12h13m-5-5 5 5-5 5"/>')};
const assetIcon=name=>`<img src="/__sketchtation/editor/icons/${name}.svg" alt="" aria-hidden="true">`;
const penIcons={
  pencil:assetIcon('pencil'),
  pen:assetIcon('ballpoint-pen'),
  fineliner:assetIcon('pen-tool'),
  marker:assetIcon('marker'),
  highlighter:svg('<path d="M7 3h10v12l-3 5H7v-4l0-13Z"/><path d="M7 8h10M7 16h10"/>'),
  brush:assetIcon('calligraphy-pen'),
  fountain:assetIcon('fountain-pen')
};
bar.innerHTML=`<div class="st-island" role="toolbar" aria-label="Sketchtation design tools"><div class="st-tools"><button data-mode="view" class="st-card active" title="Browse site" aria-label="Browse site">${icons.view}</button><button data-mode="note" class="st-card" title="Select element" aria-label="Select element">${icons.note}</button><button data-mode="draw" class="st-card" title="Draw on site" aria-label="Draw on site">${icons.draw}</button><button data-mode="erase" class="st-card" title="Erase drawing" aria-label="Erase drawing">${icons.erase}</button><span class="st-divider"></span><label class="st-card st-color" title="Ink color"><input id="st-color" type="color" value="#f24f2d" aria-label="Ink color"><span></span></label><button id="st-clear" class="st-card" title="Clear drawing" aria-label="Clear drawing">${icons.clear}</button></div><button id="st-send" class="st-send" title="Send to agent">${icons.send}<span>Send</span></button></div><aside id="st-layers-panel" class="st-layers-panel" aria-label="Drawing layers" aria-hidden="true"><div class="st-layers-title"><strong>Layers</strong><div><button id="st-add-layer" aria-label="Add layer" data-tip="Add layer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button><button id="st-close-layers" aria-label="Close layers" data-tip="Close layers"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></div><div id="st-layer-list"></div></aside><div id="st-popover" class="st-popover" hidden><div class="st-pop-top"><strong>Design note</strong><button id="st-close" aria-label="Close">×</button></div><p id="st-target">Sketch or select something on the page.</p><textarea id="st-note" placeholder="Describe what you want the agent to make…"></textarea><div class="st-pop-actions"><span id="st-status">Your sketch will be saved with this note.</span><button id="st-save">Save & copy handoff</button></div></div>`;
document.body.append(bar);
document.body.append(bar.querySelector('#st-layers-panel'));
const sendTip=document.createElement('div');
sendTip.id='st-send-tip';sendTip.hidden=true;
sendTip.innerHTML='<span class="st-send-spinner" aria-hidden="true"></span><span class="st-send-message"></span>';
bar.append(sendTip);
let sendTipTimer;
function showSendTip(state,text){clearTimeout(sendTipTimer);sendTip.className=state;sendTip.querySelector('.st-send-message').textContent=text;sendTip.hidden=false;bar.querySelector('#st-send').classList.toggle('working',state==='working');}
function hideSendTip(){sendTip.hidden=true;bar.querySelector('#st-send').classList.remove('working');}
bar.querySelector('[data-mode="draw"]').innerHTML=assetIcon('pencil');
bar.querySelector('[data-mode="erase"]').innerHTML=assetIcon('eraser');
const colorSlot=bar.querySelector('.st-color');
colorSlot.outerHTML='<button id="st-color-trigger" class="st-card st-color" aria-label="Ink color" aria-expanded="false" data-tip="Ink color"><span></span></button>';
const colorPanel=document.createElement('div');
colorPanel.id='st-color-popover';
colorPanel.hidden=true;
colorPanel.innerHTML='<div class="st-color-heading">Ink color</div><div class="st-swatches"></div><label class="st-custom-color"><span>Custom color</span><input id="st-color" type="color" value="#f24f2d" aria-label="Custom ink color"></label>';
bar.append(colorPanel);
const penPanel=document.createElement('div');
penPanel.id='st-pen-popover';penPanel.hidden=true;
penPanel.innerHTML='<div class="st-pen-heading">Choose a pen <span id="st-pen-name">Pen</span></div><div class="st-pen-grid"></div><label class="st-pen-slider">Size <output id="st-size-value">6</output><input id="st-size" type="range" min="1" max="48" value="6"></label><label class="st-pen-slider">Opacity <output id="st-opacity-value">100%</output><input id="st-opacity" type="range" min="10" max="100" value="100"></label><div class="st-history"><button id="st-undo" class="st-undo" aria-label="Undo, Ctrl+Z">↶ Undo</button><button id="st-redo" class="st-undo" aria-label="Redo, Ctrl+Y">↷ Redo</button></div>';
bar.append(penPanel);
for(const [id,pen] of Object.entries(PENS)){const button=document.createElement('button');button.dataset.pen=id;button.innerHTML=penIcons[id];button.className='st-pen-option';button.setAttribute('aria-label',pen.name);button.addEventListener('pointerenter',()=>penPanel.querySelector('#st-pen-name').textContent=pen.name);button.addEventListener('focus',()=>penPanel.querySelector('#st-pen-name').textContent=pen.name);penPanel.querySelector('.st-pen-grid').append(button);}
penPanel.querySelector('.st-pen-grid').addEventListener('pointerleave',()=>penPanel.querySelector('#st-pen-name').textContent=PENS[penId].name);
for(const color of ['#f24f2d','#ffb340','#e8d44c','#45ba8b','#0a84ff','#8a6cf0','#20242b','#ffffff']){const swatch=document.createElement('button');swatch.className='st-swatch';swatch.style.background=color;swatch.dataset.color=color;swatch.setAttribute('aria-label',`Use ${color}`);colorPanel.querySelector('.st-swatches').append(swatch);}
const tooltip=document.createElement('div');tooltip.className='st-tooltip';tooltip.hidden=true;bar.append(tooltip);
for(const control of bar.querySelectorAll('.st-island [title]')){control.dataset.tip=control.title;control.removeAttribute('title');}
const dock=bar.querySelector('.st-island');
const cards=[...bar.querySelectorAll('.st-card')];
dock.addEventListener('pointerover',e=>{const target=e.target.closest('[data-tip]');if(!target||!dock.contains(target)||!sendTip.hidden&&target.id==='st-send')return;tooltip.textContent=target.dataset.tip;tooltip.style.left=(target.getBoundingClientRect().left+target.getBoundingClientRect().width/2-bar.getBoundingClientRect().left)+'px';tooltip.hidden=false;});
dock.addEventListener('pointerout',e=>{if(!e.relatedTarget?.closest?.('[data-tip]'))tooltip.hidden=true;});
dock.addEventListener('focusin',e=>{const target=e.target.closest('[data-tip]');if(!target||!sendTip.hidden&&target.id==='st-send')return;tooltip.textContent=target.dataset.tip;tooltip.style.left=(target.getBoundingClientRect().left+target.getBoundingClientRect().width/2-bar.getBoundingClientRect().left)+'px';tooltip.hidden=false;});
dock.addEventListener('focusout',()=>tooltip.hidden=true);
dock.addEventListener('pointermove',e=>{if(e.pointerType==='touch')return;for(const card of cards){const r=card.getBoundingClientRect();const distance=Math.abs(e.clientX-(r.left+r.width/2));const influence=Math.max(0,1-distance/105);card.style.setProperty('--scale',(1+influence*.16).toFixed(3));card.style.setProperty('--lift',`${(-influence*7).toFixed(1)}px`);}});
dock.addEventListener('pointerleave',()=>cards.forEach(card=>{card.style.removeProperty('--scale');card.style.removeProperty('--lift');}));
const $=id=>document.getElementById(id);
$('st-save').textContent='Send to agent';
function setColor(color){$('st-color').value=color;bar.querySelector('.st-color span').style.background=color;colorPanel.querySelectorAll('.st-swatch').forEach(b=>b.classList.toggle('active',b.dataset.color.toLowerCase()===color.toLowerCase()));}
$('st-color').addEventListener('input',e=>setColor(e.target.value));
colorPanel.querySelectorAll('.st-swatch').forEach(b=>b.onclick=()=>setColor(b.dataset.color));
$('st-color-trigger').onclick=()=>{colorPanel.hidden=!colorPanel.hidden;$('st-color-trigger').setAttribute('aria-expanded',String(!colorPanel.hidden));$('st-popover').hidden=true;tooltip.hidden=true;};
document.addEventListener('pointerdown',e=>{if(!colorPanel.contains(e.target)&&e.target!==$('st-color-trigger')&&!$('st-color-trigger').contains(e.target)){colorPanel.hidden=true;$('st-color-trigger').setAttribute('aria-expanded','false');}if(!penPanel.contains(e.target)&&!bar.querySelector('[data-mode="draw"]').contains(e.target))penPanel.hidden=true;if(!markerMenu.contains(e.target)&&!e.target.closest?.('.st-comment-pin'))markerMenu.hidden=true;},true);
setColor('#f24f2d');
const ctx=canvas.getContext('2d');
const highlightCtx=highlightCanvas.getContext('2d');
const draftKey='sketchtation-route-drawings-v1';
const layerDraftKey='sketchtation-route-layers-v1';
let savedDrafts=[];
try{savedDrafts=JSON.parse(sessionStorage.getItem(draftKey)||'[]');if(!Array.isArray(savedDrafts))savedDrafts=[];}catch{}
const routeDrawings=new Map(savedDrafts);
function persistDrafts(){try{sessionStorage.setItem(draftKey,JSON.stringify([...routeDrawings]));}catch{}}
let savedLayerDrafts=[];try{savedLayerDrafts=JSON.parse(sessionStorage.getItem(layerDraftKey)||'[]');if(!Array.isArray(savedLayerDrafts))savedLayerDrafts=[];}catch{}
const routeLayers=new Map(savedLayerDrafts);
function initialLayers(route){return routeLayers.get(route)||[{name:'Sketch 1',strokes:routeDrawings.get(route)||[],visible:true}];}
let mode='view',layers=initialLayers(activeRoute),activeLayer=layers.length-1,strokes=layers[activeLayer].strokes,current=null,selected='',annotationTarget=null,highlight=null,pinned=false,penId='pen',penSize=6,penOpacity=1;
function persistLayers(){layers[activeLayer].strokes=strokes;routeLayers.set(activeRoute,layers);routeDrawings.set(activeRoute,layers.filter(layer=>layer.visible).flatMap(layer=>layer.strokes));persistDrafts();try{sessionStorage.setItem(layerDraftKey,JSON.stringify([...routeLayers]));}catch{}}
const undoStack=[],redoStack=[];
function updateHistory(){ $('st-undo').disabled=!undoStack.length;$('st-redo').disabled=!redoStack.length; }
function commit(next){undoStack.push(strokes);redoStack.length=0;strokes=next;persistLayers();updateHistory();paint();}
function undo(){if(!undoStack.length)return false;redoStack.push(strokes);strokes=undoStack.pop();persistLayers();updateHistory();paint();return true;}
function redo(){if(!redoStack.length)return false;undoStack.push(strokes);strokes=redoStack.pop();persistLayers();updateHistory();paint();return true;}
function choosePen(id){penId=id;penSize=PENS[id].size;penOpacity=PENS[id].opacity;if(id==='highlighter'&&$('st-color').value==='#f24f2d')setColor(PENS[id].color);$('st-size').value=penSize;$('st-opacity').value=Math.round(penOpacity*100);$('st-size-value').textContent=penSize;$('st-opacity-value').textContent=Math.round(penOpacity*100)+'%';$('st-pen-name').textContent=PENS[id].name;penPanel.querySelectorAll('[data-pen]').forEach(b=>{b.classList.toggle('active',b.dataset.pen===id);b.setAttribute('aria-pressed',String(b.dataset.pen===id));});bar.querySelector('[data-mode="draw"]').dataset.tip=`Draw · ${PENS[id].name}`;}
penPanel.querySelectorAll('[data-pen]').forEach(b=>b.onclick=()=>{choosePen(b.dataset.pen);setMode('draw');penPanel.hidden=true;});
$('st-size').oninput=e=>{penSize=Number(e.target.value);$('st-size-value').textContent=penSize;};
$('st-opacity').oninput=e=>{penOpacity=Number(e.target.value)/100;$('st-opacity-value').textContent=e.target.value+'%';};
$('st-undo').onclick=undo;
$('st-redo').onclick=redo;
updateHistory();
choosePen('pen');
const scale=Math.min(devicePixelRatio||1,2);
function pageSize(){return {width:Math.max(document.documentElement.scrollWidth,innerWidth),height:Math.max(document.documentElement.scrollHeight,innerHeight)};}
function resize(){const size=pageSize();const width=Math.round(size.width*scale),height=Math.round(size.height*scale);if(canvas.width===width&&canvas.height===height)return;for(const layer of [canvas,highlightCanvas]){layer.style.width=size.width+'px';layer.style.height=size.height+'px';layer.width=width;layer.height=height;}paint();}
function paint(){const all=layers.filter(layer=>layer.visible).flatMap((layer,index)=>index===activeLayer&&current?[...layer.strokes,current]:layer.strokes);ctx.clearRect(0,0,canvas.width,canvas.height);highlightCtx.clearRect(0,0,highlightCanvas.width,highlightCanvas.height);renderDrawing(highlightCtx,all.filter(s=>s.tool==='highlighter'||s.tool==='erase'),scale);renderDrawing(ctx,all.filter(s=>s.tool!=='highlighter'),scale);}
function syncRoute(){const next=routeKey();if(next===activeRoute)return;persistLayers();activeRoute=next;layers=initialLayers(next);activeLayer=layers.length-1;strokes=layers[activeLayer].strokes;current=null;undoStack.length=0;redoStack.length=0;updateHistory();drawLayers();setMode('view');document.querySelectorAll('.st-comment-pin').forEach(pin=>pin.remove());markerMenu.hidden=true;resize();paint();loadMarkers();}
function drawLayers(){const list=$('st-layer-list');if(!list)return;const icon=path=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;list.replaceChildren();layers.forEach((layer,index)=>{const row=document.createElement('div');row.className='st-layer-row'+(index===activeLayer?' active':'');const name=document.createElement('button');name.className='st-layer-name';name.textContent=layer.name;name.title='Double-click to rename';name.onclick=()=>{persistLayers();activeLayer=index;strokes=layers[index].strokes;undoStack.length=0;redoStack.length=0;updateHistory();drawLayers();paint();};name.ondblclick=e=>{e.preventDefault();e.stopPropagation();const value=prompt('Rename layer',layer.name);if(value?.trim()){layer.name=value.trim();persistLayers();drawLayers();}};const controls=document.createElement('div');controls.className='st-layer-actions';const addAction=(label,path,handler,disabled=false)=>{const button=document.createElement('button');button.className='st-layer-action';button.type='button';button.dataset.tip=label;button.setAttribute('aria-label',label);button.innerHTML=icon(path);button.disabled=disabled;button.onclick=handler;controls.append(button);};addAction(layer.visible?'Hide layer':'Show layer',layer.visible?'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z':'M3 3l18 18M10.6 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7c1.5 0 2.8-.4 4-1',()=>{layer.visible=!layer.visible;persistLayers();drawLayers();paint();});addAction('Merge into layer below','M12 4v12m-5-5 5 5 5-5M5 20h14',()=>{if(index===0)return;layers[index-1].strokes.push(...layer.strokes);layers.splice(index,1);activeLayer=index===activeLayer?index-1:index<activeLayer?activeLayer-1:activeLayer;strokes=layers[activeLayer].strokes;undoStack.length=0;redoStack.length=0;updateHistory();persistLayers();drawLayers();paint();},index===0);addAction('Delete layer','M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',()=>{if(layers.length===1){layer.strokes=[];layer.visible=true;activeLayer=0;strokes=layer.strokes;}else{layers.splice(index,1);if(index===activeLayer)activeLayer=Math.max(0,index-1);else if(index<activeLayer)activeLayer--;strokes=layers[activeLayer].strokes;}undoStack.length=0;redoStack.length=0;updateHistory();persistLayers();drawLayers();paint();});row.append(name,controls);list.append(row);});}
function toggleLayers(force){const panel=$('st-layers-panel');const open=typeof force==='boolean'?force:panel.getAttribute('aria-hidden')==='true';panel.setAttribute('aria-hidden',String(!open));}
$('st-close-layers').onclick=()=>toggleLayers(false);
$('st-add-layer').onclick=()=>{persistLayers();layers.push({name:`Sketch ${layers.length+1}`,strokes:[],visible:true});activeLayer=layers.length-1;strokes=layers[activeLayer].strokes;undoStack.length=0;redoStack.length=0;updateHistory();persistLayers();drawLayers();paint();};
drawLayers();
const point=e=>({x:e.clientX+scrollX,y:e.clientY+scrollY,t:performance.now(),pressure:e.pressure});
const cursorSvg={draw:icons.draw,erase:icons.erase};
function setMode(next){mode=next;canvas.style.pointerEvents=['draw','erase'].includes(mode)?'auto':'none';canvas.style.cursor=cursorSvg[mode]?`url("data:image/svg+xml,${encodeURIComponent(cursorSvg[mode].replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" ').replace('currentColor','#253243'))}") ${mode==='draw'?'2 18':'4 17'}, crosshair`:'';bar.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});document.body.classList.toggle('st-picking',mode==='note');highlight=null;pinned=false;picker.style.display='none';annotation.hidden=true;tooltip.hidden=true;}
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);current={tool:mode==='erase'?'erase':penId,color:$('st-color').value,size:mode==='erase'?24:penSize,opacity:mode==='erase'?1:penOpacity,points:[point(e)]};paint();});
canvas.addEventListener('pointermove',e=>{if(current){current.points.push(point(e));paint();}});
canvas.addEventListener('pointerup',()=>{if(current){const finished=current;current=null;commit([...strokes,finished]);}});
canvas.addEventListener('pointercancel',()=>{current=null;paint();});
function pickTarget(element){if(!(element instanceof Element)||bar.contains(element)||annotation.contains(element)||markerMenu.contains(element)||element.closest('.st-comment-pin')||element===canvas||element===picker)return null;return element.closest('a,button,h1,h2,h3,h4,p,li,nav,header,footer,section,article,aside,svg,img,form,input,textarea')||element;}
function selectorFor(el){return el.id?'#'+el.id:el.tagName.toLowerCase()+(el.classList.length?'.'+[...el.classList].join('.'):'');}
function positionPicker(){if(!highlight||mode!=='note')return;const r=highlight.getBoundingClientRect();picker.style.display='block';picker.style.left=r.left+'px';picker.style.top=r.top+'px';picker.style.width=r.width+'px';picker.style.height=r.height+'px';picker.querySelector('span').textContent=selectorFor(highlight);picker.classList.toggle('pinned',pinned);if(!annotation.hidden){annotation.style.left=Math.max(12,Math.min(r.left+12,innerWidth-annotation.offsetWidth-12))+'px';annotation.style.top=Math.max(12,Math.min(r.top+Math.min(r.height,42),innerHeight-annotation.offsetHeight-12))+'px';}}
document.addEventListener('pointermove',e=>{if(mode!=='note'||pinned||bar.contains(e.target))return;const target=pickTarget(e.target);if(target&&target!==highlight){highlight=target;positionPicker();}},true);
document.addEventListener('click',e=>{if(mode!=='note'||bar.contains(e.target)||annotation.contains(e.target)||markerMenu.contains(e.target)||e.target.closest?.('.st-comment-pin')||e.target===canvas)return;const target=pickTarget(e.target);if(!target)return;e.preventDefault();e.stopPropagation();highlight=target;pinned=true;const selector=selectorFor(target);const rect=target.getBoundingClientRect();annotationTarget={selector,x:Math.round(rect.left+scrollX),y:Math.round(rect.top+scrollY)};selected=`Element: ${selector}\nText: ${target.textContent.trim().slice(0,120)}\nPage position: ${Math.round(rect.top+scrollY)}px`;$('st-target').textContent=selector;annotation.hidden=false;positionPicker();$('st-annotation-input').focus();},true);
addEventListener('scroll',positionPicker,{passive:true});
bar.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{const wasDraw=mode==='draw';setMode(b.dataset.mode);if(b.dataset.mode==='draw')penPanel.hidden=wasDraw?!penPanel.hidden:false;else penPanel.hidden=true;colorPanel.hidden=true;});
$('st-clear').onclick=()=>{if(strokes.length)commit([]);};
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='l'){e.preventDefault();toggleLayers();return;}if(!(e.ctrlKey||e.metaKey)||e.altKey||e.isComposing)return;const target=e.target;if(target instanceof Element&&(target.closest('input,textarea,select,[contenteditable="true"]')))return;const key=e.key.toLowerCase();if(key==='z'&&!e.shiftKey&&undo()){e.preventDefault();}else if((key==='y'||key==='z'&&e.shiftKey)&&redo()){e.preventDefault();}},true);
$('st-send').onclick=()=>{colorPanel.hidden=true;$('st-color-trigger').setAttribute('aria-expanded','false');const hasSketch=layers.some(layer=>layer.visible&&layer.strokes.length);$('st-note').placeholder=hasSketch?'Turn this graffiti into a design on the website…':'Describe what you want the agent to make…';const comments=document.querySelectorAll('.st-comment-pin').length;const included=[hasSketch?'Sketch':'',comments?`${comments} comment${comments===1?'':'s'}`:''].filter(Boolean);$('st-status').textContent=included.length?included.join(' and ')+' will be sent to Codex.':'Add a note, sketch, or comment.';$('st-popover').hidden=false;$('st-note').focus();};
$('st-close').onclick=()=>$('st-popover').hidden=true;
function sketchImage(){if(!layers.some(layer=>layer.visible&&layer.strokes.length))return null;const image=document.createElement('canvas');image.width=canvas.width;image.height=canvas.height;const c=image.getContext('2d');c.drawImage(highlightCanvas,0,0);c.drawImage(canvas,0,0);return image.toDataURL('image/png');}
function sketchPreview(){if(!layers.some(layer=>layer.visible&&layer.strokes.length))return null;const image=document.createElement('canvas');image.width=canvas.width;image.height=canvas.height;const c=image.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,image.width,image.height);c.drawImage(highlightCanvas,0,0);c.drawImage(canvas,0,0);return image.toDataURL('image/png');}
function sketchPlacement(){const size=pageSize();return layers.some(layer=>layer.visible&&layer.strokes.length)?{width:size.width,height:size.height}:null;}
annotation.addEventListener('submit',async e=>{e.preventDefault();const input=$('st-annotation-input');const comment=input.value.trim();if(!comment){input.focus();return;}const button=annotation.querySelector('button');button.disabled=true;try{const note=[comment,selected].filter(Boolean).join('\n\n');const response=await fetch('/__sketchtation/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note,target:annotationTarget,route:activeRoute})});const feedback=await response.json();if(!response.ok)throw new Error(feedback.error);const count=document.querySelectorAll('.st-comment-pin').length+1;showMarker(feedback,count);selected='';annotationTarget=null;input.value='';input.placeholder='Add another comment…';annotation.classList.add('saved');annotation.hidden=true;showToast(`${count} comment${count===1?'':'s'} stacked. Press Send when ready.`);}catch(error){showToast(error.message||'Could not save comment');annotation.classList.remove('saved');}finally{button.disabled=false;}});
annotation.addEventListener('keydown',e=>{if(e.key==='Escape'){annotation.hidden=true;annotation.classList.remove('saved');}});
$('st-save').onclick=async()=>{
  const submittedRoute=activeRoute;
  const note=[$('st-note').value.trim(),selected,strokes.length?`The sketch is aligned to the full webpage from its top-left corner. Page size: ${canvas.style.width} × ${canvas.style.height}.`:''].filter(Boolean).join('\n\n');
  const button=$('st-save');button.disabled=true;
  showSendTip('working','Sending to Codex…');
  try{
    const response=await fetch('/__sketchtation/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note,route:submittedRoute,sketch:sketchImage(),sketchPreview:sketchPreview(),sketchPlacement:sketchPlacement()})});
    const run=await response.json();if(!response.ok)throw new Error(run.error);
    $('st-popover').hidden=true;showSendTip('working',run.message||'Reviewing your request…');
    const timer=setInterval(async()=>{
      try{
        const result=await fetch(`/__sketchtation/api/run?id=${encodeURIComponent(run.id)}`).then(r=>r.json());
        if(result.status==='running'){showSendTip('working',result.message||'Working on your website…');return;}
        clearInterval(timer);button.disabled=false;
        if(result.status==='complete'){routeDrawings.delete(submittedRoute);persistDrafts();sessionStorage.setItem('st-last-complete',result.result||'Website updated');location.reload();}
        else{showSendTip('error',result.message||'Design run failed');sendTipTimer=setTimeout(hideSendTip,12000);}
      }catch(error){clearInterval(timer);button.disabled=false;showSendTip('error',error.message);sendTipTimer=setTimeout(hideSendTip,12000);}
    },1800);
  }catch(error){button.disabled=false;$('st-status').textContent=error.message;showSendTip('error',error.message);sendTipTimer=setTimeout(hideSendTip,12000);}
};
addEventListener('resize',()=>{resize();positionPicker();});new ResizeObserver(resize).observe(document.documentElement);resize();setMode('view');
addEventListener('popstate',syncRoute);setInterval(syncRoute,200);loadMarkers();
if(sessionStorage.getItem('st-last-complete')){const message=sessionStorage.getItem('st-last-complete');sessionStorage.removeItem('st-last-complete');showSendTip('complete',message);sendTipTimer=setTimeout(hideSendTip,5500);}
