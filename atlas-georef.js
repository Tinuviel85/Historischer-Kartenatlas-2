/* Local georeferencing, no upload to external service. */
(function(){
"use strict";
const DB="atlas-georeferenzierungen", STORE="karten", loaded=new Map();
function db(){return new Promise((res,rej)=>{
 const r=indexedDB.open(DB,1);
 r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:"id"});
 r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
});}
async function transact(mode,method,id){
 const d=await db();
 return new Promise((res,rej)=>{
  const tx=d.transaction(STORE,mode),s=tx.objectStore(STORE);
  const r=method==="get"?s.get(id):method==="list"?s.getAll():method==="put"?s.put(id):s.delete(id);
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
  tx.oncomplete=()=>d.close();tx.onabort=()=>{d.close();rej(tx.error);};
 });
}
const get=id=>transact("readonly","get",id);
const list=()=>transact("readonly","list");
const put=async p=>{loaded.delete(p.id);await transact("readwrite","put",p);};
function solve(A,B){
 const a=A.map((r,i)=>[...r,B[i]]);
 for(let c=0;c<3;c++){
  let pivot=c;for(let i=c+1;i<3;i++)if(Math.abs(a[i][c])>Math.abs(a[pivot][c]))pivot=i;
  if(Math.abs(a[pivot][c])<1e-10)throw Error("Passpunkte besser über das Kartenblatt verteilen.");
  [a[c],a[pivot]]=[a[pivot],a[c]];const v=a[c][c];
  for(let j=c;j<4;j++)a[c][j]/=v;
  for(let i=0;i<3;i++)if(i!==c){const f=a[i][c];for(let j=c;j<4;j++)a[i][j]-=f*a[c][j];}
 }
 return a.map(r=>r[3]);
}
function affine(points,L){
 if(points.length<3)throw Error("Mindestens drei Passpunkte notwendig.");
 const A=[[0,0,0],[0,0,0],[0,0,0]],X=[0,0,0],Y=[0,0,0];
 for(const p of points){
  const xy=L.CRS.EPSG3857.latLngToPoint(L.latLng(p.lat,p.lng),0),row=[p.u,p.v,1];
  for(let i=0;i<3;i++){X[i]+=row[i]*xy.x;Y[i]+=row[i]*xy.y;
   for(let j=0;j<3;j++)A[i][j]+=row[i]*row[j];}
 }
 return {x:solve(A,X),y:solve(A,Y)};
}

function transform(p,L){
 if(p.mode!=="manual")return affine(p.points,L);
 const m=p.manual;
 if(!m||!Number.isFinite(m.scale)||m.scale<=0||!Number.isFinite(m.lat)||!Number.isFinite(m.lng))
  throw Error("Manuelle Ausrichtung ist noch nicht eingerichtet.");
 const a=(Number(m.rotation)||0)*Math.PI/180,cs=Math.cos(a)*m.scale,sn=Math.sin(a)*m.scale;
 const center=L.CRS.EPSG3857.latLngToPoint(L.latLng(m.lat,m.lng),0);
 return {
  x:[cs,-sn,center.x-cs*p.width/2+sn*p.height/2],
  y:[sn,cs,center.y-sn*p.width/2-cs*p.height/2]
 };
}
function bounds(p,L){
 const t=transform(p,L),corners=[[0,0],[p.width,0],[0,p.height],[p.width,p.height]];
 const coords=corners.map(([u,v])=>L.CRS.EPSG3857.pointToLatLng(L.point(
  t.x[0]*u+t.x[1]*v+t.x[2],t.y[0]*u+t.y[1]*v+t.y[2]),0));
 return [[Math.min(...coords.map(x=>x.lat)),Math.min(...coords.map(x=>x.lng))],
  [Math.max(...coords.map(x=>x.lat)),Math.max(...coords.map(x=>x.lng))]];
}
function image(blob){return new Promise((res,rej)=>{
 const u=URL.createObjectURL(blob),i=new Image();
 i.onload=()=>{URL.revokeObjectURL(u);res(i)};
 i.onerror=()=>{URL.revokeObjectURL(u);rej(Error("Bilddatei konnte nicht geöffnet werden."))};
 i.src=u;
});}
async function recordFor(id){
 if(!loaded.has(id))loaded.set(id,(async()=>{
  const data=await get(id);
  if(!data?.image)throw Error("Bild ist nur auf einem anderen Gerät gespeichert.");
  return {data,img:await image(data.image)};
 })());
 return loaded.get(id);
}
function layer(L,item,notice){
 const id=String(item.sourceUrl||"").slice("atlas-georef:".length);
 const G=L.GridLayer.extend({createTile:function(c,done){
  const tile=document.createElement("canvas");tile.width=tile.height=256;
  recordFor(id).then(({data,img})=>{
   const t=transform(data,L),z=2**c.z,ctx=tile.getContext("2d");
   ctx.setTransform(t.x[0]*z,t.y[0]*z,t.x[1]*z,t.y[1]*z,
    t.x[2]*z-c.x*256,t.y[2]*z-c.y*256);
   ctx.drawImage(img,0,0,data.width,data.height);
   if(data.mode==="manual"&&!this._georefOpacityApplied&&Number.isFinite(data.manual?.opacity)){
    this._georefOpacityApplied=true;
    this.setOpacity(Math.max(.05,Math.min(1,data.manual.opacity)));
   }
   done(null,tile);
  }).catch(e=>{notice?.(e.message);done(e,tile)});
  return tile;
 }});
 return new G({tileSize:256,opacity:.85,minZoom:2,maxZoom:19,noWrap:true});
}
function mount(api){
 const $=id=>document.getElementById(id);
 const style=document.createElement("style");
 style.textContent=".gr-dialog{width:min(1030px,calc(100vw - 16px));max-height:96dvh;overflow:auto;border:1px solid #c6d9cc;border-radius:16px;padding:16px;color:#254237;background:#fff}.gr-dialog::backdrop{background:#12362899}.gr-dialog button{border:1px solid #bdd2c3;border-radius:9px;background:#f5faf6;color:#284c3d;font-weight:700;padding:10px}.gr-fields{display:flex;gap:9px;flex-wrap:wrap;margin:12px 0}.gr-fields label{display:grid;gap:5px;font-size:12px;font-weight:700;flex:1}.gr-fields input{padding:10px;border-radius:9px;border:1px solid #c5d7c8;min-width:95px}.gr-views{display:flex;flex-direction:column;gap:10px}.gr-views>div{min-width:0;border:1px solid #cddbd0;border-radius:10px;overflow:hidden}.gr-views h3{font-size:13px;padding:9px;margin:0}.gr-pic{height:315px;display:flex;justify-content:center;align-items:center;background:#e6eee6;overflow:auto}.gr-pic canvas{max-width:100%;height:auto;cursor:crosshair;touch-action:manipulation}.gr-ref{height:360px;touch-action:none}.gr-actions{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.gr-status,.gr-points{font-size:12px;color:#496656;margin:10px 0}.gr-point{display:flex;gap:8px;justify-content:space-between;padding:5px;border-bottom:1px solid #e1e9e1}.gr-pin{background:#bd2947;color:#fff;border:2px solid white;border-radius:50%;display:grid;place-items:center;font:700 12px system-ui;box-shadow:0 1px 5px #0006;width:25px;height:25px}.gr-modes{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.gr-modes button[aria-pressed=true]{background:#235643;color:white}.gr-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:12px;background:#eef5ef;border-radius:10px;margin-bottom:12px}.gr-controls label{font-size:12px;font-weight:700;display:grid;gap:5px}.gr-controls output{font-weight:400}.gr-controls input{width:100%;accent-color:#235643}.gr-manual-note{font-size:12px;grid-column:1/-1;color:#526c5c;line-height:1.5}.gr-launch{width:100%;border:1px solid #b3d1bd;background:#e8f4ea;border-radius:10px;color:#225241;padding:12px;font-weight:700;margin:9px 0}@media(max-width:650px){.gr-views>div{margin:8px 0}.gr-pic,.gr-ref{height:34dvh}.gr-fields label:first-child{flex-basis:100%}.gr-controls{grid-template-columns:1fr 1fr}.gr-controls label:last-of-type{grid-column:1/-1}}";
 style.textContent += ".gr-stage-image{position:absolute;z-index:800;max-width:none!important;max-height:none!important;pointer-events:none;user-select:none;-webkit-user-drag:none;transform-origin:center center;will-change:transform,left,top,width}.gr-stage-editor{position:absolute;z-index:1150;left:50%;bottom:calc(42px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(720px,calc(100% - 18px));background:#fffffffa;box-shadow:0 9px 35px #173d2e66;border:1px solid #bdd5c3;border-radius:15px;padding:13px;display:grid;gap:9px;max-height:53dvh;overflow:auto;touch-action:pan-y}.gr-stage-editor h3{font:700 17px Georgia,serif;margin:0}.gr-stage-editor p{font-size:12px;color:#587362;margin:0;line-height:1.45}.gr-stage-editor .gr-sliders{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.gr-stage-editor label{display:grid;gap:4px;font-size:12px;font-weight:700}.gr-stage-editor input{width:100%;accent-color:#225644}.gr-stage-editor .gr-toolbar-buttons{display:flex;flex-wrap:wrap;gap:7px}.gr-stage-editor button{border:1px solid #b9d0c2;border-radius:9px;background:#f6faf7;color:#244d3b;font-size:13px;font-weight:700;padding:10px 12px;min-height:41px}.gr-stage-editor .gr-confirm{background:#235543;color:#fff;border-color:#235543}.gr-stage-editor .gr-cancel{background:#fff}.stage.gr-aligning .mode-panel,.stage.gr-aligning .map-bottom,.stage.gr-aligning .map-topbar,.stage.gr-aligning .atlas-preview-bar,.stage.gr-aligning .detail-card,.stage.gr-aligning .zoom-panel{visibility:hidden!important}.stage.gr-aligning #map{touch-action:none!important}@media(max-width:650px){.gr-stage-editor{bottom:calc(30px + env(safe-area-inset-bottom));padding:10px;gap:8px}.gr-stage-editor .gr-sliders{grid-template-columns:1fr 1fr;gap:8px}.gr-stage-editor .gr-sliders label:nth-child(3){grid-column:1/-1}.gr-stage-editor button{padding:10px 11px}}";
 style.textContent += ".gr-stage-editor .gr-map-modes{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.gr-stage-editor .gr-map-modes button{flex:1;min-width:140px}.gr-stage-editor .gr-map-modes button[aria-pressed=true]{background:#235543;color:#fff;border-color:#235543}.gr-stage-editor .gr-slider-head{display:flex;align-items:center;justify-content:space-between;gap:6px}.gr-stage-editor .gr-numeric{width:86px!important;min-width:0;max-width:100%;padding:7px!important;border:1px solid #bacfc0;border-radius:8px;font-size:14px;font-weight:600;color:#244739;background:#fff}.gr-stage-editor .gr-slider-head output{font-size:11px;font-weight:600;color:#547263}.gr-stage-editor .gr-map-help{font-size:12px;line-height:1.4;color:#456651}.stage.gr-move-map{cursor:grab}.stage.gr-move-map:active{cursor:grabbing}@media(max-width:650px){.gr-stage-editor .gr-slider-head{flex-wrap:wrap}.gr-stage-editor .gr-numeric{width:76px!important}.gr-stage-editor .gr-map-modes button{min-width:120px}}";
 document.head.appendChild(style);
 const btn=document.createElement("button");btn.className="gr-launch";btn.textContent="+ Eigene Karte georeferenzieren";
 const target=$("managerDialog")?.querySelector("#managerDiscover");
 if(target)target.before(btn);else $("regions").after(btn);
 const dialog=document.createElement("dialog");dialog.className="gr-dialog";
 dialog.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0;font:700 21px Georgia">Karte georeferenzieren</h2><button id="grClose" type="button">✕</button></div>'+
 '<p style="font-size:12px">Wähle dieselbe Stelle zuerst auf dem historischen Bild und dann auf der heutigen Referenzkarte. Mindestens drei Passpunktpaare.</p>'+
 '<div class="gr-fields"><label>Kartenname<input id="grName" placeholder="Historische Karte"></label><label>Region<input id="grRegion" value="Berlin"></label><label>Jahr<input id="grYear" type="number" min="1" max="2100"></label><label style="flex-basis:100%">PNG, JPG, WebP oder PDF (erste Seite)<input id="grFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf"></label></div>'+
 '<div class="gr-modes"><button id="grModePoints" type="button" aria-pressed="true">Passpunkte setzen</button><button id="grModeManual" type="button" aria-pressed="false">Manuell überlagern</button></div>'+
 '<div class="gr-controls" id="grControls" hidden><p class="gr-manual-note">Die historische Karte liegt halbtransparent auf der heutigen Karte. Bild direkt unten ziehen; Größe und Drehung hier anpassen. Keine Passpunkte erforderlich.</p><label>Größe <output id="grScaleLabel">100 %</output><input id="grScale" type="range" min="10" max="400" value="100" step="1"></label><label>Drehung <output id="grRotateLabel">0°</output><input id="grRotate" type="range" min="-180" max="180" value="0" step="1"></label><label>Deckkraft <output id="grOpacityLabel">55 %</output><input id="grOpacity" type="range" min="5" max="100" value="55" step="1"></label><button id="grResetManual" type="button">Bild neu zentrieren</button></div>'+
 '<div id="grManualHelp" hidden style="margin:12px 0;padding:13px;border-radius:10px;background:#edf5ef"><strong>Direkt auf der großen Berlin-Karte ausrichten</strong><p style="font-size:12px;line-height:1.55">Nach dem Laden des Bildes öffnest du die Berlin-Karte. Dort kannst du die historische Karte mit dem Finger verschieben, ihre Größe und Drehung ändern und die Ausrichtung mit einem einzigen Knopf bestätigen. Passpunkte sind dafür nicht nötig.</p><button id="grOnMain" type="button" style="background:#245845;color:white">Auf Berlin-Karte ausrichten</button></div>'+
 '<div class="gr-views" id="grViews"><div><h3>1 · Historischer Scan</h3><div class="gr-pic"><canvas id="grImage" width="600" height="350"></canvas></div></div><div><h3>2 · Heutige Referenzkarte</h3><div id="grReference" class="gr-ref"></div></div></div>'+
 '<p id="grStatus" class="gr-status" role="status">Bild auswählen, dann Passpunkte setzen.</p><div id="grPoints" class="gr-points"></div>'+
 '<div class="gr-actions"><button id="grPreview" type="button">Auf Karte legen (Vorschau)</button><button id="grSave" type="button">Karte speichern</button><button id="grExport" type="button">Projekt exportieren</button><button id="grImport" type="button">Projekt importieren</button><button id="grClear" type="button">Punkte zurücksetzen</button></div><input id="grImportFile" type="file" accept=".json,application/json" hidden>'+
 '<div style="border-top:1px solid #d6e6d9;padding-top:10px"><strong>Gespeicherte lokale Projekte</strong><div id="grProjects"></div></div>'+
 '<p class="gr-status">Derzeit lokale Speicherung im Browser (IndexedDB). Die spätere OneDrive-Synchronisierung benötigt eine Microsoft-App-Registrierung. Bitte Projekte auch als Datei sichern.</p>';
 document.body.appendChild(dialog);
 const L=window.L,canvas=$("grImage"),ctx=canvas.getContext("2d");
 const stage=document.querySelector(".stage");
 if(!stage)throw Error("Kartenbereich nicht gefunden.");
 let ref=null,markers=[],photo=null,img=null,w=0,h=0,points=[],pending=null,id=null;
 let mode="points",manual=null,manualLayer=null,drag=null,frame=null;
 let mainSession=null;
 const opacity=()=>Math.min(1,Math.max(.05,Number($("grOpacity").value)/100));
 const say=x=>{$("grStatus").textContent=x};
 function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(img)ctx.drawImage(img,0,0,canvas.width,canvas.height);
  function mark(p,n,color){
   const x=p.u/w*canvas.width,y=p.v/h*canvas.height;
   ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);
   ctx.fillStyle=color;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle="#fff";ctx.stroke();
   ctx.fillStyle="#fff";ctx.font="bold 12px system-ui";ctx.textAlign="center";ctx.textBaseline="middle";
   ctx.fillText(String(n),x,y+0.5);
  }
  for(let j=0;j<points.length;j++)mark(points[j],j+1,"#bc2240");
  if(pending)mark(pending,points.length+1,"#d1780c");
 }
 function renderPoints(){
  markers.forEach(m=>ref.removeLayer(m));markers=[];
  const box=$("grPoints");box.replaceChildren();
  points.forEach((p,j)=>{
   const row=document.createElement("div");row.className="gr-point";
   row.textContent=(j+1)+". "+p.lat.toFixed(5)+" / "+p.lng.toFixed(5);
   const del=document.createElement("button");del.textContent="Löschen";del.onclick=()=>{points.splice(j,1);renderPoints();draw();};
   row.appendChild(del);box.appendChild(row);
   if(ref&&mode==="points"){
    const icon=L.divIcon({className:"gr-pin",html:String(j+1),iconSize:[25,25],iconAnchor:[12,12]});
    markers.push(L.marker([p.lat,p.lng],{icon,interactive:false}).addTo(ref));
   }
  });
 }
 canvas.onclick=e=>{
  if(mode!=="points")return say("Für die freie Überlagerung das Bild auf der unteren Karte verschieben.");
  if(!img)return say("Bitte erst eine Bilddatei laden.");
  const b=canvas.getBoundingClientRect();
  pending={u:Math.max(0,Math.min(w,(e.clientX-b.left)/b.width*w)),
           v:Math.max(0,Math.min(h,(e.clientY-b.top)/b.height*h))};
  draw();
  say("Punkt "+(points.length+1)+" auf dem Scan markiert (orange). Jetzt denselben Ort unten antippen.");
 };
 function ensureManual(reset=false){
  if(!img)return false;
  if(!ref)refMap();
  if(!manual||reset){
   const center=ref.getCenter(),screen=ref.getSize();
   const baseScale=Math.min(780,Math.max(150,screen.x*.72))/(w*2**ref.getZoom());
   manual={lat:center.lat,lng:center.lng,baseScale,scale:baseScale,rotation:0,opacity:opacity()};
   $("grScale").value="100";$("grRotate").value="0";
  }
  return true;
 }
 function renderManual(){
  if(mode!=="manual"||!img||!ref)return;
  if(!ensureManual())return;
  if(!manualLayer){
   const Manual=L.GridLayer.extend({
    createTile:function(c,done){
     const tile=document.createElement("canvas");tile.width=tile.height=256;
     try{
      const t=transform({mode:"manual",manual,width:w,height:h},L),z=2**c.z;
      const ctx=tile.getContext("2d");
      ctx.setTransform(t.x[0]*z,t.y[0]*z,t.x[1]*z,t.y[1]*z,
        t.x[2]*z-c.x*256,t.y[2]*z-c.y*256);
      ctx.drawImage(img,0,0,w,h);done(null,tile);
     }catch(err){done(err,tile);}
     return tile;
    }
   });
   manualLayer=new Manual({tileSize:256,noWrap:true,opacity:opacity(),minZoom:2,maxZoom:19,keepBuffer:1});
   manualLayer.addTo(ref);
  }else manualLayer.redraw();
  manualLayer.setOpacity(opacity());
  $("grScaleLabel").textContent=$("grScale").value+" %";
  $("grRotateLabel").textContent=$("grRotate").value+"°";
  $("grOpacityLabel").textContent=$("grOpacity").value+" %";
 }
 function scheduleManual(){
  if(frame!==null)return;
  frame=requestAnimationFrame(()=>{frame=null;renderManual();});
 }
 function setMode(next){
  mode=next==="manual"?"manual":"points";
  pending=null;draw();renderPoints();
  $("grModePoints").setAttribute("aria-pressed",String(mode==="points"));
  $("grModeManual").setAttribute("aria-pressed",String(mode==="manual"));
  $("grControls").hidden=true; // Die Regler befinden sich bei der manuellen Ausrichtung direkt auf der Berlin-Karte.
  $("grViews").hidden=mode==="manual";
  $("grManualHelp").hidden=mode!=="manual";
  $("grClear").hidden=mode==="manual";
  $("grPreview").hidden=mode==="manual";
  $("grSave").hidden=mode==="manual";
  if(ref){
   ref.dragging.enable();
   if(manualLayer&&ref.hasLayer(manualLayer))ref.removeLayer(manualLayer);
  }
  manualLayer=null;
  say(img?(mode==="manual"?
   'Bild geladen. „Auf Berlin-Karte ausrichten“ wählen – anschließend dort verschieben, drehen und bestätigen.':
   'Passpunkt zuerst auf dem historischen Scan, anschließend auf der unteren Karte wählen.'):
   'Bitte zuerst ein Bild oder eine PDF laden.');
 }
 $("grModePoints").onclick=()=>setMode("points");
 $("grModeManual").onclick=()=>setMode("manual");
 $("grScale").oninput=()=>{
  if(!ensureManual())return;
  manual.scale=manual.baseScale*Number($("grScale").value)/100;
  scheduleManual();
 };
 $("grRotate").oninput=()=>{
  if(!ensureManual())return;
  manual.rotation=Number($("grRotate").value);
  scheduleManual();
 };
 $("grOpacity").oninput=()=>{
  $("grOpacityLabel").textContent=$("grOpacity").value+" %";
  if(manual)manual.opacity=opacity();
  manualLayer?.setOpacity(opacity());
 };
 $("grResetManual").onclick=()=>{
  if(!img)return say("Bitte zuerst eine Karte laden.");
  ensureManual(true);scheduleManual();say("Bild in der Mitte neu platziert.");
 };
 function enableDragging(){
  const container=ref.getContainer();
  container.addEventListener("pointerdown",e=>{
   if(mode!=="manual"||!manual||!img||(e.pointerType==="mouse"&&e.button!==0))return;
   if(e.target.closest?.(".leaflet-control"))return;
   e.preventDefault();
   const origin=ref.project(L.latLng(manual.lat,manual.lng),ref.getZoom());
   drag={id:e.pointerId,cx:e.clientX,cy:e.clientY,x:origin.x,y:origin.y};
   try{container.setPointerCapture(e.pointerId);}catch(_){}
  });
  container.addEventListener("pointermove",e=>{
   if(!drag||e.pointerId!==drag.id||mode!=="manual")return;
   e.preventDefault();
   const center=ref.unproject(L.point(drag.x+e.clientX-drag.cx,drag.y+e.clientY-drag.cy),ref.getZoom());
   manual.lat=center.lat;manual.lng=center.lng;
   scheduleManual();
  });
  function end(e){
   if(!drag||e.pointerId!==drag.id)return;
   drag=null;
   try{if(container.hasPointerCapture(e.pointerId))container.releasePointerCapture(e.pointerId);}catch(_){}
  }
  container.addEventListener("pointerup",end);
  container.addEventListener("pointercancel",end);
 }
 // Ausrichtung erfolgt auf der echten Hauptkarte, nicht in einem zweiten Kartenfenster.
 const mainImage=document.createElement("img");
 mainImage.className="gr-stage-image";mainImage.alt="Zu georeferenzierende historische Karte";
 mainImage.draggable=false;mainImage.hidden=true;
 const bar=document.createElement("section");bar.className="gr-stage-editor";
 bar.hidden=true;bar.setAttribute("role","region");
 bar.setAttribute("aria-label","Historische Karte auf der Berlin-Karte ausrichten");
 bar.innerHTML=
  '<h3>Historische Karte auf Berlin ausrichten</h3>'+
  '<p id="grMapHelp" class="gr-map-help">Modus „Historische Karte bewegen“: mit einem Finger verschieben, mit zwei Fingern drehen und skalieren.</p>'+
  '<div class="gr-map-modes" role="group" aria-label="Was möchtest du verschieben?"><button id="grMoveImage" type="button" aria-pressed="true">Historische Karte bewegen</button><button id="grMoveBackground" type="button" aria-pressed="false">Berlin-Karte bewegen</button></div>'+
  '<div class="gr-sliders">'+
  '<label><span class="gr-slider-head"><span>Bildzoom</span><input id="grMainSizeNumber" class="gr-numeric" type="number" min="1" max="10000" step="0.1" value="100" aria-label="Bildzoom in Prozent"></span><input id="grMainSize" type="range" min="-400" max="400" step="1" value="0" aria-label="Bildzoom Schieberegler"><output id="grMainSizeValue">100 %</output></label>'+
  '<label><span class="gr-slider-head"><span>Drehung</span><input id="grMainAngleNumber" class="gr-numeric" type="number" min="-180" max="180" step="0.1" value="0" aria-label="Drehung in Grad"></span><input id="grMainAngle" type="range" min="-180" max="180" step="0.5" value="0" aria-label="Drehung Schieberegler"><output id="grMainAngleValue">0°</output></label>'+
  '<label>Transparenz <output id="grMainOpacityValue">55 %</output><input id="grMainOpacity" type="range" min="5" max="100" step="1" value="55"></label></div>'+
  '<div class="gr-toolbar-buttons">'+
  '<button type="button" id="grMainZoomOut" title="Moderne Karte verkleinern">Karte −</button>'+
  '<button type="button" id="grMainZoomIn" title="Moderne Karte vergrößern">Karte +</button>'+
  '<button type="button" id="grMainReset">Bild zentrieren</button>'+
  '<button type="button" id="grMainCancel" class="gr-cancel">Abbrechen</button>'+
  '<button type="button" id="grMainConfirm" class="gr-confirm">Ausrichtung bestätigen & speichern</button>'+
  '</div><p id="grMainStatus" aria-live="polite"></p>';
 stage.append(mainImage,bar);
 function initMainManual(){
  if(!img||!photo)throw Error("Bitte zuerst eine PDF- oder Bilddatei laden.");
  const map=api.map,center=map.getCenter();
  if(!manual){
   const baseScale=Math.min(760,Math.max(160,map.getSize().x*.72))/(w*2**map.getZoom());
   manual={lat:center.lat,lng:center.lng,baseScale,scale:baseScale,rotation:0,opacity:.55};
  }else{
   if(!Number.isFinite(manual.baseScale)||manual.baseScale<=0)
    manual.baseScale=manual.scale;
   if(!Number.isFinite(manual.opacity))manual.opacity=.55;
  }
 }
 function drawOnMain(){
  if(!mainSession||!manual)return;
  const map=api.map,center=map.latLngToContainerPoint([manual.lat,manual.lng]);
  const pixelFactor=2**map.getZoom();
  mainImage.style.left=center.x+"px";mainImage.style.top=center.y+"px";
  mainImage.style.width=(w*manual.scale*pixelFactor)+"px";
  mainImage.style.height=(h*manual.scale*pixelFactor)+"px";
  mainImage.style.transform="translate(-50%,-50%) rotate("+manual.rotation+"deg)";
  mainImage.style.opacity=String(manual.opacity??.55);
  const factor=Math.round(1000*manual.scale/manual.baseScale)/10;
  $("grMainSizeValue").textContent=factor+" %";
  $("grMainAngleValue").textContent=Number(manual.rotation||0).toFixed(1).replace(/\.0$/,"")+"°";
  $("grMainOpacityValue").textContent=Math.round(100*(manual.opacity??.55))+" %";
 }
 function syncMainControls(){
  const percent=Math.round(1000*manual.scale/manual.baseScale)/10;
  $("grMainSize").value=String(Math.max(-400,Math.min(400,Math.round(100*Math.log2(manual.scale/manual.baseScale)))));
  $("grMainSizeNumber").value=String(percent);
  $("grMainAngle").value=String(Number(manual.rotation)||0);
  $("grMainAngleNumber").value=String(Math.round(10*(Number(manual.rotation)||0))/10);
  $("grMainOpacity").value=String(Math.round((manual.opacity??.55)*100));
  drawOnMain();
 }
 // Im Hintergrund-Modus bleibt das historische Bild auf dem Display stehen.
 // Die Referenzkarte bewegt sich darunter; die Bild-Geokoordinaten werden
 // in Echtzeit an die neue Kartenmitte und Zoomstufe angepasst.
 function lockOverlayScreenPosition(){
  if(!mainSession||!manual||mainSession.moveMode!=="background")return;
  const map=api.map,p=map.latLngToContainerPoint([manual.lat,manual.lng]);
  mainSession.screenLock={x:p.x,y:p.y,pixelWidth:w*manual.scale*2**map.getZoom()};
 }
 function updateAfterMapMove(){
  if(!mainSession)return;
  const map=api.map,lock=mainSession.screenLock;
  if(mainSession.moveMode==="background"&&lock){
   const ll=map.containerPointToLatLng([lock.x,lock.y]);
   manual.lat=ll.lat;manual.lng=ll.lng;
   manual.scale=lock.pixelWidth/(w*2**map.getZoom());
   syncMainControls();
  }else drawOnMain();
 }
 function endMainAlignment(backToEditor=false){
  if(!mainSession)return;
  const state=mainSession;
  mainSession=null;
  state.map.off("move zoomend resize",updateAfterMapMove);
  const c=state.container;
  c.removeEventListener("pointerdown",state.down);
  c.removeEventListener("pointermove",state.move);
  c.removeEventListener("pointerup",state.up);
  c.removeEventListener("pointercancel",state.up);
  document.removeEventListener("keydown",state.keydown);
  mainImage.hidden=true;mainImage.removeAttribute("src");
  URL.revokeObjectURL(state.url);bar.hidden=true;
  stage.classList.remove("gr-aligning");
  stage.classList.remove("gr-move-map");
  if(state.historical)state.historical.style.visibility=state.visibility;
  if(state.wasDragging)state.map.dragging.enable();
  else state.map.dragging.disable();
  if(state.wasTouchZoom)state.map.touchZoom.enable();
  else state.map.touchZoom.disable();
  if(state.wasScrollZoom)state.map.scrollWheelZoom?.enable();
  else state.map.scrollWheelZoom?.disable();
  if(backToEditor){
   state.map.setView(state.oldCenter,state.oldZoom,{animate:false});
   if(!dialog.open)dialog.showModal();
   say("Ausrichtung nicht gespeichert. Du kannst sie erneut auf der großen Karte beginnen.");
  }
 }
 function startMainAlignment(){
  if(mainSession)return;
  if(!img||!photo)return say("Bitte zuerst ein Bild oder eine PDF laden.");
  try{
   const map=api.map,oldCenter=map.getCenter(),oldZoom=map.getZoom();
   api.suspendAutoFollow?.();
   const place=String($("grRegion").value||"").trim().toLocaleLowerCase("de");
   if(place==="berlin"&&!(oldCenter.lat>52.32&&oldCenter.lat<52.70&&oldCenter.lng>13.04&&oldCenter.lng<13.81))
    map.setView([52.5205,13.4050],Math.max(13,Math.min(17,oldZoom)),{animate:false});
   initMainManual();
   const historical=api.historicalMap?.getContainer();
   const container=map.getContainer();
   const url=URL.createObjectURL(photo);
   const pointers=new Map();
   let dragState=null,gesture=null;
   function gesturePoints(){
    const [a,b]=[...pointers.values()];
    if(!a||!b)return null;
    const dx=b.x-a.x,dy=b.y-a.y;
    return {midX:(a.x+b.x)/2,midY:(a.y+b.y)/2,
     distance:Math.max(1,Math.hypot(dx,dy)),angle:Math.atan2(dy,dx)};
   }
   function startGesture(){
    const g=gesturePoints();
    if(!g)return;
    const center=map.latLngToContainerPoint([manual.lat,manual.lng]);
    gesture={...g,cx:center.x,cy:center.y,scale:manual.scale,rotation:manual.rotation};
    dragState=null;
   }
   const down=e=>{
    if((e.pointerType==="mouse"&&e.button!==0)||!mainSession||mainSession.moveMode!=="image")return;
    if(e.target.closest?.("button,input,label,select,a,.leaflet-control"))return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===1){
     const cp=map.latLngToContainerPoint([manual.lat,manual.lng]);
     dragState={id:e.pointerId,x:e.clientX,y:e.clientY,cx:cp.x,cy:cp.y};
     gesture=null;
    }else if(pointers.size===2)startGesture();
    e.preventDefault();
    try{container.setPointerCapture(e.pointerId);}catch(_){}
   };
   const move=e=>{
    if(!pointers.has(e.pointerId)||!mainSession||mainSession.moveMode!=="image")return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    e.preventDefault();
    if(pointers.size>=2&&gesture){
     const g=gesturePoints();
     if(!g)return;
     manual.scale=manual.baseScale*Math.max(1/16,Math.min(16,
      gesture.scale*g.distance/gesture.distance/manual.baseScale));
     const angle=(gesture.rotation+(g.angle-gesture.angle)*180/Math.PI)%360;
     manual.rotation=(angle+540)%360-180;
     const ll=map.containerPointToLatLng([
      gesture.cx+g.midX-gesture.midX,gesture.cy+g.midY-gesture.midY]);
     manual.lat=ll.lat;manual.lng=ll.lng;
     syncMainControls();
    }else if(dragState?.id===e.pointerId){
     const ll=map.containerPointToLatLng([
      dragState.cx+e.clientX-dragState.x,dragState.cy+e.clientY-dragState.y]);
     manual.lat=ll.lat;manual.lng=ll.lng;drawOnMain();
    }
   };
   const up=e=>{
    if(!pointers.has(e.pointerId))return;
    pointers.delete(e.pointerId);
    try{if(container.hasPointerCapture(e.pointerId))container.releasePointerCapture(e.pointerId);}catch(_){}
    gesture=null;dragState=null;
    if(pointers.size===1){
     const [id,p]=[...pointers.entries()][0];
     const cp=map.latLngToContainerPoint([manual.lat,manual.lng]);
     dragState={id,x:p.x,y:p.y,cx:cp.x,cy:cp.y};
    }
   };
   const switchMovement=kind=>{
    if(!mainSession)return;
    const background=kind==="background";
    for(const id of pointers.keys()){
     try{if(container.hasPointerCapture(id))container.releasePointerCapture(id);}catch(_){}
    }
    pointers.clear();dragState=null;gesture=null;
    mainSession.moveMode=background?"background":"image";
    if(background)lockOverlayScreenPosition();
    else mainSession.screenLock=null;
    if(background){
     map.dragging?.enable();
     map.touchZoom?.enable();
     if(mainSession.wasScrollZoom)map.scrollWheelZoom?.enable();
    }else{
     map.dragging?.disable();
     map.touchZoom?.disable();
     map.scrollWheelZoom?.disable();
    }
    $("grMoveImage").setAttribute("aria-pressed",String(!background));
    $("grMoveBackground").setAttribute("aria-pressed",String(background));
    $("grMapHelp").textContent=background?
     "Berlin-Karte bewegen: die Grundkarte mit einem Finger verschieben oder mit zwei Fingern zoomen. Das historische Bild bleibt an derselben Bildschirmposition, während die Georeferenzierung angepasst wird.":
     "Historische Karte bewegen: mit einem Finger verschieben und mit zwei Fingern drehen oder skalieren. Die Berlin-Karte bleibt dabei stehen.";
    $("grMainStatus").textContent=background?
     "Hintergrundkarte kann jetzt frei bewegt werden; für das historische Bild wieder umschalten.":
     "Historische Karte kann jetzt verschoben und gedreht werden.";
    if(background)stage.classList.add("gr-move-map");
    else stage.classList.remove("gr-move-map");
   };
   const keydown=e=>{
    if(e.key==="Escape"&&mainSession){e.preventDefault();endMainAlignment(true);}
   };
   mainSession={map,container,url,down,move,up,keydown,oldCenter,oldZoom,
    historical,visibility:historical?.style.visibility||"",
    wasDragging:!!map.dragging?.enabled?.(),
    wasTouchZoom:!!map.touchZoom?.enabled?.(),
    wasScrollZoom:!!map.scrollWheelZoom?.enabled?.(),
    moveMode:"image",setMoveMode:switchMovement};
   if(historical)historical.style.visibility="hidden";
   switchMovement("image");
   container.addEventListener("pointerdown",down);
   container.addEventListener("pointermove",move);
   container.addEventListener("pointerup",up);
   container.addEventListener("pointercancel",up);
   document.addEventListener("keydown",keydown);
   map.on("move zoomend resize",updateAfterMapMove);
   $("grMainStatus").textContent="";
   mainImage.src=url;mainImage.hidden=false;bar.hidden=false;
   stage.classList.add("gr-aligning");
   dialog.close();
   if($("managerDialog")?.open)$("managerDialog").close();
   $("sidebar")?.classList.remove("open");
   syncMainControls();
  }catch(e){
   if(mainSession)endMainAlignment(true);
   say("Ausrichtung nicht möglich: "+e.message);
  }
 }
 $("grOnMain").onclick=startMainAlignment;
 $("grMoveImage").onclick=()=>mainSession?.setMoveMode("image");
 $("grMoveBackground").onclick=()=>mainSession?.setMoveMode("background");
 $("grMainSize").oninput=()=>{
  if(!mainSession)return;
  manual.scale=manual.baseScale*Math.pow(2,Number($("grMainSize").value)/100);
  lockOverlayScreenPosition();syncMainControls();
 };
 $("grMainSizeNumber").onchange=()=>{
  if(!mainSession)return;
  const value=Number($("grMainSizeNumber").value);
  if(Number.isFinite(value)&&value>=1&&value<=10000)
   manual.scale=manual.baseScale*value/100;
  else $("grMainStatus").textContent="Bildzoom: Bitte einen Wert zwischen 1 und 10.000 % eingeben.";
  lockOverlayScreenPosition();syncMainControls();
 };
 $("grMainAngle").oninput=()=>{
  if(!mainSession)return;
  manual.rotation=Number($("grMainAngle").value);
  syncMainControls();
 };
 $("grMainAngleNumber").onchange=()=>{
  if(!mainSession)return;
  const value=Number($("grMainAngleNumber").value);
  if(Number.isFinite(value)&&value>=-180&&value<=180)
   manual.rotation=value;
  else $("grMainStatus").textContent="Drehung: Bitte einen Wert zwischen −180° und +180° eingeben.";
  syncMainControls();
 };
 $("grMainOpacity").oninput=()=>{
  if(!mainSession)return;
  manual.opacity=Number($("grMainOpacity").value)/100;
  syncMainControls();
 };
 $("grMainZoomIn").onclick=()=>api.map.zoomIn();
 $("grMainZoomOut").onclick=()=>api.map.zoomOut();
 $("grMainReset").onclick=()=>{
  if(!mainSession)return;
  const center=api.map.getCenter();manual.lat=center.lat;manual.lng=center.lng;
  lockOverlayScreenPosition();syncMainControls();
 };
 $("grMainCancel").onclick=()=>endMainAlignment(true);
 $("grMainConfirm").onclick=async()=>{
  if(!mainSession)return;
  const confirm=$("grMainConfirm");confirm.disabled=true;
  try{
   mode="manual";
   const {r,b}=record();
   await put(r);id=r.id;
   const item={name:r.name,region:r.region,year:r.year,type:"georef",
    sourceUrl:"atlas-georef:"+r.id,bounds:b,provider:"Eigene georeferenzierte Karte · lokal",
    detailUrl:location.origin+location.pathname};
   endMainAlignment(false);
   await api.saveDiscoveredMap(item);
   api.setNotice?.("Ausrichtung bestätigt. Die Karte ist in deiner Bibliothek gespeichert.");
  }catch(e){
   const message="Speichern fehlgeschlagen: "+e.message;
   if(mainSession)$("grMainStatus").textContent=message;
   else{
    say(message);
    if(!dialog.open)dialog.showModal();
   }
  }finally{confirm.disabled=false;}
 };
 async function read(file){
  if(!file)return;
  if(file.size>30*1024*1024)throw Error("Diese Version unterstützt Dateien bis 30 MB.");
  if(file.type==="application/pdf"||/\.pdf$/i.test(file.name)){
   const pdfjs=await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.mjs");
   pdfjs.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.mjs";
   const doc=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
   const page=await doc.getPage(1),base=page.getViewport({scale:1});
   const v=page.getViewport({scale:Math.min(1,2600/Math.max(base.width,base.height))});
   const c=document.createElement("canvas");c.width=Math.ceil(v.width);c.height=Math.ceil(v.height);
   await page.render({canvasContext:c.getContext("2d"),viewport:v}).promise;
   file=await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(Error("PDF-Konvertierung fehlgeschlagen.")),"image/png"));
  }
  if(!/^image\/(png|jpeg|webp)$/.test(file.type))throw Error("Bildformat nicht unterstützt.");
  const image=await new Promise((res,rej)=>{const u=URL.createObjectURL(file),im=new Image();
   im.onload=()=>{URL.revokeObjectURL(u);res(im)};im.onerror=()=>{URL.revokeObjectURL(u);rej(Error("Bild nicht lesbar."))};im.src=u;});
  photo=file;img=image;w=img.naturalWidth;h=img.naturalHeight;
  const scale=Math.min(850/w,600/h,1);
  canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  points=[];id=null;manual=null;pending=null;renderPoints();draw();
  say("Bild geladen ("+w+" × "+h+"). "+(mode==="manual"?"Jetzt „Auf Berlin-Karte ausrichten“ wählen.":"Jetzt Passpunkte setzen."));
 }
 $("grFile").onchange=e=>{read(e.target.files?.[0]).then(()=>{$("grName").value=e.target.files?.[0]?.name.replace(/\.[^.]+$/,"")||""}).catch(er=>say(er.message));};
 function refMap(){
  if(ref)return;
  ref=L.map("grReference",{zoomControl:true}).setView(api.map.getCenter(),Math.max(10,api.map.getZoom()));
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(ref);
  enableDragging();
  ref.on("click",e=>{
   if(mode==="manual")return;
   if(!pending)return say("Erst einen Punkt auf dem historischen Bild markieren.");
   points.push({...pending,lat:e.latlng.lat,lng:e.latlng.lng});pending=null;
   renderPoints();draw();say(points.length+" Passpunkte gesetzt.");
  });
 }
 function record(){
  if(!photo)throw Error("Bitte eine Bilddatei laden.");
  const r={id:id||((crypto.randomUUID&&crypto.randomUUID())||String(Date.now())),
   name:$("grName").value.trim()||"Eigene Karte",
   region:$("grRegion").value.trim()||"Berlin",year:Number($("grYear").value)||null,
   image:photo,width:w,height:h,points:points.map(p=>({...p})),
   mode,manual:mode==="manual"?(manual?{...manual}:null):null,
   savedAt:new Date().toISOString()};
  const b=bounds(r,L);
  return {r,b};
 }
 async function project(keep){
  try{
   const {r,b}=record();await put(r);id=r.id;
   const item={name:r.name,region:r.region,year:r.year,type:"georef",
    sourceUrl:"atlas-georef:"+r.id,bounds:b,provider:"Eigene Karte · lokal",
    detailUrl:location.origin+location.pathname};
   if(keep)await api.saveDiscoveredMap(item);else api.previewMap(item);
   dialog.close();say("Georeferenzierung lokal gespeichert.");
  }catch(e){say("Fehler: "+e.message);}
 }
 $("grPreview").onclick=()=>project(false);$("grSave").onclick=()=>project(true);
 $("grClear").onclick=()=>{points=[];pending=null;renderPoints();draw();say("Punkte zurückgesetzt.");};
 $("grExport").onclick=async()=>{
  try{
   const {r}=record(),fr=new FileReader();
   const base64=await new Promise((res,rej)=>{fr.onload=()=>res(fr.result);fr.onerror=()=>rej(fr.error);fr.readAsDataURL(r.image);});
   const b=new Blob([JSON.stringify({format:"atlas-georef-v1",project:{...r,image:undefined},image:base64})],{type:"application/json"});
   const u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download="atlas-georeferenzierung-"+r.id+".json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
  }catch(e){say("Export: "+e.message);}
 };
 $("grImport").onclick=()=>$("grImportFile").click();
 $("grImportFile").onchange=async e=>{
  try{
   const f=e.target.files?.[0];if(!f)return;
   if(f.size>45*1024*1024)throw Error("Projektdatei zu groß (max. 45 MB).");
   const data=JSON.parse(await f.text());
   const isManual=data.project?.mode==="manual"&&
     Number.isFinite(data.project?.manual?.scale)&&data.project.manual.scale>0&&
     Number.isFinite(data.project?.manual?.lat)&&Number.isFinite(data.project?.manual?.lng);
   if(data.format!=="atlas-georef-v1"||!Array.isArray(data.project?.points)||
      (!isManual&&data.project.points.length<3)||
      !/^data:image\/(?:png|jpeg|webp);base64,/i.test(data.image||""))
    throw Error("Keine gültige Projektdatei.");
   const blob=await(await fetch(data.image)).blob();
   await read(blob);
   points=data.project.points.map(p=>({u:Number(p.u),v:Number(p.v),lat:Number(p.lat),lng:Number(p.lng)}));
   manual=data.project.manual?{...data.project.manual}:null;
   if(points.some(p=>![p.u,p.v,p.lat,p.lng].every(Number.isFinite)))
    throw Error("Die Passpunkte enthalten ungültige Koordinaten.");
   $("grName").value=String(data.project.name||"Historische Karte").slice(0,180);
   $("grRegion").value=String(data.project.region||"Berlin").slice(0,80);
   $("grYear").value=data.project.year||"";
   setMode(data.project.mode==="manual"?"manual":"points");
   renderPoints();draw();say("Projekt importiert: "+(mode==="manual"?"manuelle Überlagerung.":points.length+" Passpunkte."));
  }catch(er){say("Projektimport fehlgeschlagen: "+er.message)}
  e.target.value="";
 };
 async function projectList(){
  const box=$("grProjects");box.replaceChildren();
  try{
   const data=await list();
   for(const p of data){
    const row=document.createElement("div");row.className="gr-point";
    row.textContent=p.name+" ("+(p.mode==="manual"?"manuell ausgerichtet":p.points.length+" Punkte")+")";
    const edit=document.createElement("button");edit.textContent="Bearbeiten";
    edit.onclick=async()=>{
     photo=p.image;id=p.id;points=p.points.map(x=>({...x}));
     $("grName").value=p.name;$("grRegion").value=p.region;$("grYear").value=p.year||"";
     const u=URL.createObjectURL(photo),i=new Image();
     i.onload=()=>{URL.revokeObjectURL(u);img=i;w=i.naturalWidth;h=i.naturalHeight;
      const scale=Math.min(850/w,600/h,1);
      canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
      manual=p.manual?{...p.manual}:null;
      setMode(p.mode==="manual"?"manual":"points");
      renderPoints();draw();};i.src=u;
    };
    row.appendChild(edit);box.appendChild(row);
   }
  }catch(e){say("Lokaler Speicher: "+e.message);}
 }
 btn.onclick=()=>{dialog.showModal();refMap();setTimeout(()=>ref.invalidateSize(),140);projectList();};
 $("grClose").onclick=()=>dialog.close();
 return {open:()=>btn.click()};
}
window.AtlasGeoRef={mount,createLayer:layer,affine,bounds,get,put,list};
})();