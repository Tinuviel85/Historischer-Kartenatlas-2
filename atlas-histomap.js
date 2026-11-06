/* HistoMap Berlin: site-aware year finder and full-city WMS mosaics. */
(function(){
"use strict";
const SERVICE="https://histomapberlin.de:8443/geoserver/histomap/wms";
const HOME="https://histomapberlin.de/";
const CACHE_KEY="atlas-histomap-capabilities-v4-works";
const CACHE_AGE=5*24*60*60*1000;
let catalogData=null,loading=null;
const $=(n,id)=>n.querySelector("#"+id);
function elm(tag,text,cl){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cl)e.className=cl;return e;}
function direct(n,key){return Array.from(n.children||[]).find(e=>e.localName===key);}
function value(n,key){return direct(n,key)?.textContent?.trim()||"";}
function boundsFor(layer){
  for(let n=layer;n&&n.nodeType===1;n=n.parentElement){
    let b=direct(n,"LatLonBoundingBox");
    if(b){
      const v=["minx","miny","maxx","maxy"].map(k=>Number(b.getAttribute(k)));
      if(v.every(Number.isFinite)&&v[0]<v[2]&&v[1]<v[3])return v;
    }
    b=direct(n,"EX_GeographicBoundingBox");
    if(b){
      const v=["westBoundLongitude","southBoundLatitude","eastBoundLongitude","northBoundLatitude"].map(k=>Number(value(b,k)));
      if(v.every(Number.isFinite)&&v[0]<v[2]&&v[1]<v[3])return v;
    }
  }
  return null;
}
function identifyWork(name,title) {
 const full=(String(name)+" "+String(title)).replace(/[_./:;\\-]+/g," ").replace(/\s+/g," ");
 const norm=full.toLowerCase();
 let base=null,label=null;
 if(/(?:^|\W)k\s*4(?!\d)/i.test(full)||/1\s*:\s*4[.,]?000\b/.test(full)) {
   base="K4";label="K4 · Stadtplan 1:4.000";
 } else if(/(?:^|\W)k\s*5(?!\d)/i.test(full)||/1\s*:\s*5[.,]?000\b/.test(full)){
   base="K5";label="K5 · Karte 1:5.000";
 } else if(/straube/i.test(full)){
   base="Straube";label="Straube-Plan";
 }
 // Do not combine colour and monochrome editions inadvertently.
 if(base){
   if(/(?:^|\W)(?:farb\w*|colour|color|koloriert)(?:\W|$)/i.test(norm)){
     base+="-Farbe";label+=" · Farbe";
   } else if(/schwarz\s*weiß|schwarz\s*weiss|(?:^|\W)s\s*w(?:\W|$)|monochrom/i.test(norm)){
     base+="-SW";label+=" · Schwarzweiß";
   }
   return {key:base,label:label};
 }
 // No explicit map-series metadata: keep an individual map separate,
 // never assume that matching years mean the same cartographic work.
 return {key:"sheet:"+String(name).slice(0,180),label:String(title||name).slice(0,110)};
}
function availableWorks(data,year,center,scope="berlin"){
 const atPoint=data.items.filter(item=>item.year===year&&
   (!Array.isArray(item.box)||coversPoint(item.box,center.lat,center.lng)));
 const hasLocated=data.items.some(item=>Array.isArray(item.box));
 const pointItems=hasLocated?atPoint.filter(item=>Array.isArray(item.box)):atPoint;
 const selected=scope==="point"?pointItems:data.items.filter(item=>item.year===year);
 const groups=new Map();
 for(const item of selected){
   if(!groups.has(item.work))groups.set(item.work,{key:item.work,label:item.workLabel,local:0,total:0});
 }
 for(const item of data.items){
   const record=groups.get(item.work);
   if(record&&item.year===year)record.total++;
 }
 for(const item of pointItems){
   const record=groups.get(item.work);
   if(record)record.local++;
 }
 return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label,"de"));
}
function parseCatalog(raw){
 if(raw.length>16000000)throw Error("HistoMap-Katalog zu groß.");
 const doc=new DOMParser().parseFromString(raw,"application/xml");
 if(doc.getElementsByTagName("parsererror").length)throw Error("HistoMap hat keine gültige XML-Liste geliefert.");
 const layers=Array.from(doc.getElementsByTagNameNS("*","Layer"));
 const items=[],unique=new Set();
 for(const layer of layers){
  if(direct(layer,"Layer"))continue;
  const name=value(layer,"Name"),title=value(layer,"Title")||name;
  if(!name||unique.has(name))continue;
  const found=(name+" "+title).match(/(?:18[6-9]\d|19\d{2}|20[0-2]\d)/g);
  if(!found)continue;
  unique.add(name);
  const work=identifyWork(name,title);
  items.push({name,title,year:Number(found[found.length-1]),box:boundsFor(layer),
    work:work.key,workLabel:work.label});
 }
 if(!items.length)throw Error("Der Dienst hat keine datierten Blattebenen geliefert.");
 const crs=Array.from(doc.getElementsByTagNameNS("*","SRS"))
  .concat(Array.from(doc.getElementsByTagNameNS("*","CRS")));
 const compatible=crs.some(x=>/(?:^|\s)EPSG:3857(?:\s|$)/i.test(x.textContent||""));
 return {items,compatible};
}
function setCache(data){
 catalogData=data;
 try{sessionStorage.setItem(CACHE_KEY,JSON.stringify({stamp:Date.now(),data}));}catch(_){}
 return data;
}
function fromCache(){
 if(catalogData)return catalogData;
 try{
  const stored=JSON.parse(sessionStorage.getItem(CACHE_KEY)||"null");
  if(stored&&stored.data&&stored.stamp&&Date.now()-stored.stamp<CACHE_AGE&&
     Array.isArray(stored.data.items)&&stored.data.items.length>0)catalogData=stored.data;
 }catch(_){}
 return catalogData;
}
async function loadCatalogue(){
 if(fromCache())return catalogData;
 if(loading)return loading;
 loading=(async()=>{
   const controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(),18000);
   try{
     const response=await fetch(SERVICE+"?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities",
       {mode:"cors",signal:controller.signal});
     if(!response.ok)throw Error("HTTP "+response.status);
     return setCache(parseCatalog(await response.text()));
   }finally{clearTimeout(timeout);}
 })();
 try{return await loading;}
 finally{loading=null;}
}
function coversPoint(box,lat,lng){
 return !box||(box[0]<=lng&&box[2]>=lng&&box[1]<=lat&&box[3]>=lat);
}
function overlaps(box,b){
 return !box || (box[0]<=b.east&&box[2]>=b.west&&box[1]<=b.north&&box[3]>=b.south);
}
function yearsAt(data,center){
 const years=new Set();
 // Only known sheet footprints can establish availability at a point.
 // Unknown footprints must not make all years appear available everywhere.
 const hasLocatedSheets=data.items.some(item=>Array.isArray(item.box));
 for(const item of data.items){
  if(hasLocatedSheets&&!Array.isArray(item.box))continue;
  if(coversPoint(item.box,center.lat,center.lng))years.add(item.year);
 }
 return [...years].sort((a,b)=>a-b);
}
function mapImageURL(names,bounds,L,size){
 const sw=L.CRS.EPSG3857.project(bounds.getSouthWest());
 const ne=L.CRS.EPSG3857.project(bounds.getNorthEast());
 const params=new URLSearchParams({
  SERVICE:"WMS",VERSION:"1.1.1",REQUEST:"GetMap",
  LAYERS:names.join(","),STYLES:"",FORMAT:"image/png",TRANSPARENT:"TRUE",
  SRS:"EPSG:3857",BBOX:[sw.x,sw.y,ne.x,ne.y].join(","),
  WIDTH:String(size.x),HEIGHT:String(size.y)
 });
 return SERVICE+"?"+params.toString();
}
function createFullYearLayer(L,year,onError,selection){
 const yr=Number(year);
 // Legacy entries saved a bare year; keep those intact. New entries
 // store year|work, so maps of a different series cannot overlap.
 const filter=(typeof selection==="string"&&selection.startsWith(String(yr)+"|"))
   ?selection.slice(String(yr).length+1):null;
 let notified=false;
 function notify(message){
  if(notified)return;
  notified=true;
  if(typeof onError==="function")onError(message);
 }
 const Mosaic=L.GridLayer.extend({
  createTile:function(coords,done){
   const tile=document.createElement("div"),size=this.getTileSize();
   tile.style.cssText="position:relative;overflow:hidden;width:"+size.x+"px;height:"+size.y+"px";
   const data=fromCache();
   if(!data){
     loadCatalogue().then(res=>{
       if(!res.compatible)throw Error("WMS unterstützt die Kartenprojektion EPSG:3857 nicht.");
       if(this._map)this.redraw();
     }).catch(err=>{notify("HistoMap konnte nicht geladen werden: "+err.message);});
     done(null,tile);return tile;
   }
   if(!data.compatible){done(null,tile);return tile;}
   const b=this._tileCoordsToBounds(coords);
   const area={west:b.getWest(),south:b.getSouth(),east:b.getEast(),north:b.getNorth()};
   const names=data.items.filter(item=>item.year===yr&&(!filter||item.work===filter)&&overlaps(item.box,area)).map(item=>item.name);
   if(!names.length){done(null,tile);return tile;}
   // Only the WMS sheets intersecting this tile are requested. A failed
   // combined GetMap is retried in smaller groups, down to single sheets.
   // This avoids losing the whole tile when GeoServer rejects a long LAYERS list.
   const batchSize=5, jobs=[];
   function requestImage(names,order){
     return new Promise(resolve=>{
       const img=document.createElement("img");
       img.alt="";img.draggable=false;
       img.style.cssText="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block;z-index:"+order;
       let settled=false;
       const timeout=setTimeout(()=>finish(false),16000);
       function finish(ok){
         if(settled)return;
         settled=true;clearTimeout(timeout);img.onload=null;img.onerror=null;
         if(!ok){img.remove();img.src="";}
         resolve(ok);
       }
       img.onload=()=>finish(true);
       img.onerror=()=>finish(false);
       tile.appendChild(img);
       img.src=mapImageURL(names,b,L,size);
     });
   }
   async function resilientBatch(batch,order){
     const ok=await requestImage(batch,order);
     if(ok)return true;
     if(batch.length===1)return false;
     const cut=Math.ceil(batch.length/2);
     const outcomes=await Promise.all([
       resilientBatch(batch.slice(0,cut),order),
       resilientBatch(batch.slice(cut),order+cut)
     ]);
     return outcomes.some(Boolean);
   }
   for(let i=0;i<names.length;i+=batchSize) {
     jobs.push(resilientBatch(names.slice(i,i+batchSize),i));
   }
   Promise.all(jobs).then(outcomes=>{
     if(!outcomes.some(Boolean))notify("HistoMap konnte hier kein Kartenbild ausliefern. Prüfe, ob historische Blätter für das Gebiet vorhanden sind.");
     done(null,tile);
   }).catch(()=>{
     notify("Beim Laden historischer Kartenblätter ist ein Fehler aufgetreten.");
     done(null,tile);
   });
   return tile;
  }
 });
 return new Mosaic({tileSize:256,minZoom:10,maxZoom:19,keepBuffer:0,
   updateWhenIdle:true,updateWhenZooming:false,noWrap:true,opacity:1});
}
function mount({parent,map,maps,add}){
 if(!parent||!map||!add)return;
 const css=elm("style");
 css.textContent=".histo-box{margin:0 0 14px;border:1px solid #c5d9c9;border-radius:12px;background:#f3f8f2;padding:13px}.histo-box summary{font-size:13px;font-weight:800;color:#225040;cursor:pointer}.histo-box p{font-size:12px;line-height:1.45;color:#607367}.histo-box select,.histo-box button{box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #bed3c3;border-radius:9px;background:white;color:#254b3c;font-size:13px}.histo-box button{font-weight:750}.histo-box button.primary{background:#245040;color:white}.histo-box button:disabled{opacity:.5}.histo-box input[type=file]{font-size:12px;max-width:100%;margin:9px 0}.histo-box label{font-size:12px;font-weight:650}";
 document.head.appendChild(css);
 const box=elm("details",undefined,"histo-box");
 box.innerHTML='<summary>HistoMap Berlin · historische Kartenwerke</summary><p>Wähle einen Jahrgang und ein Kartenwerk. Standardmäßig zeigt die Auswahl den <strong>Bestand für ganz Berlin</strong>. Auf Wunsch kannst du nur die Angebote für deinen Kartenmittelpunkt anzeigen. Übernommen werden immer alle verfügbaren Berliner Blätter des gewählten Kartenwerks.</p><button id="hmLoad" type="button">Kartenbestand aktualisieren</button><label for="hmScope">Kartenbestand durchsuchen</label><select id="hmScope"><option value="berlin" selected>Ganz Berlin (alle Jahrgänge und Blätter)</option><option value="point">Nur am gewählten Kartenmittelpunkt</option></select><label for="hmYear">1. Verfügbare Jahrgänge</label><select id="hmYear" disabled><option>Bestand wird geladen …</option></select><label for="hmWork">2. Kartenwerk auswählen</label><select id="hmWork" disabled><option>Bitte zuerst ein Jahr auswählen</option></select><button id="hmAdd" class="primary" type="button" disabled>Gewähltes Kartenwerk für ganz Berlin hinzufügen</button><p id="hmStatus" role="status">Noch nicht verbunden.</p><p>© Landesarchiv Berlin, HistoMap Berlin. <a href="https://histomapberlin.de/" target="_blank" rel="noopener noreferrer">Originalkarten ansehen</a></p><label for="hmXml">Falls der WMS-Zugriff scheitert: Kartenkatalogdatei (XML)</label><input id="hmXml" type="file" accept=".xml,application/xml,text/xml">';
 parent.prepend(box);
 const get=id=>$(box,id);
 let data=null;
 function updateWork(){
  if(!data)return;
  const year=Number(get("hmYear").value);
  const select=get("hmWork"),before=select.value;
  const scope=get("hmScope").value;
  const works=availableWorks(data,year,map.getCenter(),scope);
  select.replaceChildren();
  for(const work of works){
   const option=elm("option",work.label+" · "+(scope==="point"?work.local:work.total)+" Blatt/Blätter");
   option.value=work.key;select.appendChild(option);
  }
  if(works.some(w=>w.key===before))select.value=before;
  const found=works.find(w=>w.key===select.value);
  select.disabled=!found;
  get("hmAdd").disabled=!found||!data.compatible;
  if(!found){
   get("hmStatus").textContent="Für diesen Jahrgang gibt es hier kein zugeordnetes Kartenwerk.";
   return;
  }
  const key=String(year)+"|"+found.key;
  const already=maps.some(m=>m&&!m.hidden&&m.type==="histomap"&&m.sourceUrl===SERVICE&&m.year===year&&m.layerName===key);
  get("hmAdd").disabled=already||!data.compatible;
  get("hmAdd").textContent=already?"Bereits in deiner Kartenbibliothek":"Gewähltes Kartenwerk für ganz Berlin hinzufügen";
  get("hmStatus").textContent=data.compatible?
   works.length+" Kartenwerk(e) für "+year+" "+(scope==="point"?"am Kartenmittelpunkt":"berlinweit")+" verfügbar. "+
   found.total+" zugehörige Blätter insgesamt; beim Verschieben automatisch nachgeladen.":
   "Der WMS bestätigt keine EPSG:3857-Unterstützung. Eine korrekte Überlagerung ist nicht gesichert.";
 }
 function updateYears(){
  if(!data)return;
  const middle=map.getCenter();
  const available=get("hmScope").value==="point"?yearsAt(data,middle):[...new Set(data.items.map(x=>x.year))].sort((a,b)=>a-b);
  const select=get("hmYear"),was=Number(select.value);
  select.replaceChildren();
  for(const year of available){
    const option=elm("option",year);option.value=String(year);select.appendChild(option);
  }
  if(!available.length){
    select.appendChild(elm("option","Hier keine datierten Kartenblätter"));
    select.disabled=true;get("hmWork").disabled=true;
    get("hmWork").replaceChildren();
    get("hmAdd").disabled=true;
    get("hmStatus").textContent="Für diese Auswahl wurden keine datierten HistoMap-Blätter gefunden. Bei lokaler Suche Karte verschieben oder auf Ganz Berlin umstellen.";
    return;
  }
  select.value=String(available.includes(was)?was:available.includes(1910)?1910:available[0]);
  select.disabled=false;
  updateWork();
 }
 async function refresh(force){
  get("hmLoad").disabled=true;
  get("hmStatus").textContent="Verfügbare Karten werden ermittelt …";
  try{
   if(force){catalogData=null;try{sessionStorage.removeItem(CACHE_KEY);}catch(_){}}
   data=await loadCatalogue();
   updateYears();
  }catch(error){
   get("hmStatus").textContent="HistoMap-Katalog konnte nicht geladen werden ("+(error.name==="AbortError"?"Zeitüberschreitung":error.message)+"). Der Dienst oder der Browserzugriff könnte vorübergehend gestört sein.";
  }finally{get("hmLoad").disabled=false;}
 }
 get("hmLoad").addEventListener("click",()=>refresh(true));
 get("hmScope").addEventListener("change",updateYears);
 get("hmYear").addEventListener("change",updateWork);
 get("hmWork").addEventListener("change",updateWork);
 box.addEventListener("toggle",()=>{if(!box.open)return;if(data)updateYears();else refresh(false);});
 map.on("moveend",()=>{if(box.open&&data&&get("hmScope").value==="point")updateYears();});
 get("hmXml").addEventListener("change",async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{if(file.size>16000000)throw Error("Katalogdatei zu groß.");data=setCache(parseCatalog(await file.text()));updateYears();}
  catch(error){get("hmStatus").textContent="Katalogdatei ungültig: "+error.message;}
  event.target.value="";
 });
 get("hmAdd").addEventListener("click",()=>{
  if(!data?.compatible)return;
  const year=Number(get("hmYear").value),work=get("hmWork").value;
  const valid=availableWorks(data,year,map.getCenter(),get("hmScope").value).find(x=>x.key===work);
  if(!Number.isInteger(year)||!valid)return;
  const storedKey=String(year)+"|"+work;
  if(maps.some(m=>m&&!m.hidden&&m.type==="histomap"&&m.sourceUrl===SERVICE&&m.year===year&&m.layerName===storedKey)){
   get("hmStatus").textContent="Dieses Kartenwerk ist bereits in deiner Bibliothek.";return;
  }
  try{
   add({name:"HistoMap Berlin "+year+" · "+valid.label,
    year,region:"Berlin",sourceUrl:SERVICE,type:"histomap",layerName:storedKey,
    provider:"Landesarchiv Berlin / HistoMap Berlin",detailUrl:HOME},null);
   get("hmStatus").textContent="Kartenwerk „"+valid.label+"“ von "+year+" mit allen Berliner Blättern gespeichert.";
   box.closest("dialog")?.close();
   document.getElementById("sidebar")?.classList.remove("open");
  }catch(e){get("hmStatus").textContent="Übernahme fehlgeschlagen: "+e.message;}
 });
}
window.AtlasHistoMap={mount,createFullYearLayer,loadCatalogue,getCachedCatalog:fromCache,parseCatalog,yearsAt,identifyWork,availableWorks};
})();