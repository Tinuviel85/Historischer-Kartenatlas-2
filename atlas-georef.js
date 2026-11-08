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
function bounds(p,L){
 const t=affine(p.points,L),corners=[[0,0],[p.width,0],[0,p.height],[p.width,p.height]];
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
   const t=affine(data.points,L),z=2**c.z,ctx=tile.getContext("2d");
   ctx.setTransform(t.x[0]*z,t.y[0]*z,t.x[1]*z,t.y[1]*z,
    t.x[2]*z-c.x*256,t.y[2]*z-c.y*256);
   ctx.drawImage(img,0,0,data.width,data.height);
   done(null,tile);
  }).catch(e=>{notice?.(e.message);done(e,tile)});
  return tile;
 }});
 return new G({tileSize:256,opacity:.85,minZoom:2,maxZoom:19,noWrap:true});
}
function mount(api){
 const $=id=>document.getElementById(id);
 const style=document.createElement("style");
 style.textContent=".gr-dialog{width:min(1030px,calc(100vw - 16px));max-height:96dvh;overflow:auto;border:1px solid #c6d9cc;border-radius:16px;padding:16px;color:#254237;background:#fff}.gr-dialog::backdrop{background:#12362899}.gr-dialog button{border:1px solid #bdd2c3;border-radius:9px;background:#f5faf6;color:#284c3d;font-weight:700;padding:10px}.gr-fields{display:flex;gap:9px;flex-wrap:wrap;margin:12px 0}.gr-fields label{display:grid;gap:5px;font-size:12px;font-weight:700;flex:1}.gr-fields input{padding:10px;border-radius:9px;border:1px solid #c5d7c8;min-width:95px}.gr-views{display:grid;grid-template-columns:1fr 1fr;gap:10px}.gr-views>div{min-width:0;border:1px solid #cddbd0;border-radius:10px;overflow:hidden}.gr-views h3{font-size:13px;padding:9px;margin:0}.gr-pic{height:315px;display:flex;justify-content:center;align-items:center;background:#e6eee6;overflow:auto}.gr-pic canvas{max-width:100%;height:auto;cursor:crosshair}.gr-ref{height:315px}.gr-actions{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.gr-status,.gr-points{font-size:12px;color:#496656;margin:10px 0}.gr-point{display:flex;gap:8px;justify-content:space-between;padding:5px;border-bottom:1px solid #e1e9e1}.gr-launch{width:100%;border:1px solid #b3d1bd;background:#e8f4ea;border-radius:10px;color:#225241;padding:12px;font-weight:700;margin:9px 0}@media(max-width:650px){.gr-views{display:block}.gr-views>div{margin:8px 0}.gr-pic,.gr-ref{height:31dvh}.gr-fields label:first-child{flex-basis:100%}}";
 document.head.appendChild(style);
 const btn=document.createElement("button");btn.className="gr-launch";btn.textContent="+ Eigene Karte georeferenzieren";
 const target=$("managerDialog")?.querySelector("#managerDiscover");
 if(target)target.before(btn);else $("regions").after(btn);
 const dialog=document.createElement("dialog");dialog.className="gr-dialog";
 dialog.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0;font:700 21px Georgia">Karte georeferenzieren</h2><button id="grClose" type="button">✕</button></div>'+
 '<p style="font-size:12px">Wähle dieselbe Stelle zuerst auf dem historischen Bild und dann auf der heutigen Referenzkarte. Mindestens drei Passpunktpaare.</p>'+
 '<div class="gr-fields"><label>Kartenname<input id="grName" placeholder="Historische Karte"></label><label>Region<input id="grRegion" value="Berlin"></label><label>Jahr<input id="grYear" type="number" min="1" max="2100"></label><label style="flex-basis:100%">PNG, JPG, WebP oder PDF (erste Seite)<input id="grFile" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf"></label></div>'+
 '<div class="gr-views"><div><h3>1 · Historischer Scan</h3><div class="gr-pic"><canvas id="grImage" width="600" height="350"></canvas></div></div><div><h3>2 · Heutige Referenzkarte</h3><div id="grReference" class="gr-ref"></div></div></div>'+
 '<p id="grStatus" class="gr-status" role="status">Bild auswählen, dann Passpunkte setzen.</p><div id="grPoints" class="gr-points"></div>'+
 '<div class="gr-actions"><button id="grPreview" type="button">Auf Karte legen (Vorschau)</button><button id="grSave" type="button">Karte speichern</button><button id="grExport" type="button">Projekt exportieren</button><button id="grImport" type="button">Projekt importieren</button><button id="grClear" type="button">Punkte zurücksetzen</button></div><input id="grImportFile" type="file" accept=".json,application/json" hidden>'+
 '<div style="border-top:1px solid #d6e6d9;padding-top:10px"><strong>Gespeicherte lokale Projekte</strong><div id="grProjects"></div></div>'+
 '<p class="gr-status">Derzeit lokale Speicherung im Browser (IndexedDB). Die spätere OneDrive-Synchronisierung benötigt eine Microsoft-App-Registrierung. Bitte Projekte auch als Datei sichern.</p>';
 document.body.appendChild(dialog);
 const L=window.L,canvas=$("grImage"),ctx=canvas.getContext("2d");
 let ref=null,markers=[],photo=null,img=null,w=0,h=0,points=[],pending=null,id=null;
 const say=x=>{$("grStatus").textContent=x};
 function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(img)ctx.drawImage(img,0,0,canvas.width,canvas.height);
  for(let j=0;j<points.length;j++){
   const p=points[j];ctx.beginPath();ctx.fillStyle="#d02142";
   ctx.arc(p.u/w*canvas.width,p.v/h*canvas.height,6,0,Math.PI*2);ctx.fill();
  }
 }
 function renderPoints(){
  markers.forEach(m=>ref.removeLayer(m));markers=[];
  const box=$("grPoints");box.replaceChildren();
  points.forEach((p,j)=>{
   const row=document.createElement("div");row.className="gr-point";
   row.textContent=(j+1)+". "+p.lat.toFixed(5)+" / "+p.lng.toFixed(5);
   const del=document.createElement("button");del.textContent="Löschen";del.onclick=()=>{points.splice(j,1);renderPoints();draw();};
   row.appendChild(del);box.appendChild(row);
   if(ref)markers.push(L.circleMarker([p.lat,p.lng],{radius:6,color:"#d02142"}).addTo(ref));
  });
 }
 canvas.onclick=e=>{
  if(!img)return say("Bitte erst eine Bilddatei laden.");
  const b=canvas.getBoundingClientRect();
  pending={u:(e.clientX-b.left)/b.width*w,v:(e.clientY-b.top)/b.height*h};
  say("Bildpunkt gewählt: jetzt dieselbe Stelle in der Referenzkarte antippen.");
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
  points=[];id=null;renderPoints();draw();
  say("Bild geladen ("+w+" × "+h+"). Passpunkte auswählen.");
 }
 $("grFile").onchange=e=>{read(e.target.files?.[0]).then(()=>{$("grName").value=e.target.files?.[0]?.name.replace(/\.[^.]+$/,"")||""}).catch(er=>say(er.message));};
 function refMap(){
  if(ref)return;
  ref=L.map("grReference",{zoomControl:true}).setView(api.map.getCenter(),Math.max(10,api.map.getZoom()));
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(ref);
  ref.on("click",e=>{
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
   image:photo,width:w,height:h,points:points.map(p=>({...p})),savedAt:new Date().toISOString()};
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
   if(data.format!=="atlas-georef-v1"||!data.project?.points||
      !Array.isArray(data.project.points)||data.project.points.length<3||
      !/^data:image\/(?:png|jpeg|webp);base64,/i.test(data.image||""))
    throw Error("Keine gültige Projektdatei.");
   const blob=await(await fetch(data.image)).blob();
   await read(blob);
   points=data.project.points.map(p=>({u:Number(p.u),v:Number(p.v),lat:Number(p.lat),lng:Number(p.lng)}));
   if(points.some(p=>![p.u,p.v,p.lat,p.lng].every(Number.isFinite)))
    throw Error("Die Passpunkte enthalten ungültige Koordinaten.");
   $("grName").value=String(data.project.name||"Historische Karte").slice(0,180);
   $("grRegion").value=String(data.project.region||"Berlin").slice(0,80);
   $("grYear").value=data.project.year||"";
   renderPoints();draw();say("Projekt mit Bild und "+points.length+" Passpunkten importiert.");
  }catch(er){say("Projektimport fehlgeschlagen: "+er.message)}
  e.target.value="";
 };
 async function projectList(){
  const box=$("grProjects");box.replaceChildren();
  try{
   const data=await list();
   for(const p of data){
    const row=document.createElement("div");row.className="gr-point";
    row.textContent=p.name+" ("+p.points.length+" Punkte)";
    const edit=document.createElement("button");edit.textContent="Bearbeiten";
    edit.onclick=async()=>{
     photo=p.image;id=p.id;points=p.points.map(x=>({...x}));
     $("grName").value=p.name;$("grRegion").value=p.region;$("grYear").value=p.year||"";
     const u=URL.createObjectURL(photo),i=new Image();
     i.onload=()=>{URL.revokeObjectURL(u);img=i;w=i.naturalWidth;h=i.naturalHeight;
      const scale=Math.min(850/w,600/h,1);
      canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
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