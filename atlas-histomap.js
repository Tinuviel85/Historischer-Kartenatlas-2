/* HistoMap Berlin: site-aware year finder and full-city WMS mosaics. */
(function(){
"use strict";
const SERVICE="https://histomapberlin.de:8443/geoserver/histomap/wms";
const HOME="https://histomapberlin.de/";
const CACHE_KEY="atlas-histomap-capabilities-v3";
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
  items.push({name,title,year:Number(found[found.length-1]),box:boundsFor(layer)});
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
function createFullYearLayer(L,year,onError){
 const yr=Number(year);
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
   const names=data.items.filter(item=>item.year===yr&&overlaps(item.box,area)).map(item=>item.name);
   if(!names.length){done(null,tile);return tile;}
   // A year is a city-wide virtual map. At every tile position retrieve
   // every applicable source sheet; no six-sheet import truncation.
   // Small WMS batches avoid excessive GET URL lengths.
   const batchSize=10,urls=[];
   for(let i=0;i<names.length;i+=batchSize){
     urls.push(mapImageURL(names.slice(i,i+batchSize),b,L,size));
   }
   let remaining=urls.length,errors=0;
   function complete(){
     remaining-=1;
     if(remaining===0){
       if(errors===urls.length)notify("HistoMap-Kartenbilder konnten hier nicht geladen werden.");
       done(null,tile);
     }
   }
   urls.forEach((url,i)=>{
     const img=document.createElement("img");
     img.alt="";
     img.draggable=false;
     img.style.cssText="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block";
     img.style.zIndex=String(i);
     img.onload=complete;
     img.onerror=()=>{img.remove();errors++;complete();};
     tile.appendChild(img);
     img.src=url;
   });
   return tile;
  }
 });
 return new Mosaic({tileSize:256,minZoom:10,maxZoom:19,keepBuffer:2,
   updateWhenIdle:true,updateWhenZooming:false,noWrap:true,opacity:1});
}
function mount({parent,map,maps,add}){
 if(!parent||!map||!add)return;
 const css=elm("style");
 css.textContent=".histo-box{margin:0 0 14px;border:1px solid #c5d9c9;border-radius:12px;background:#f3f8f2;padding:13px}.histo-box summary{font-size:13px;font-weight:800;color:#225040;cursor:pointer}.histo-box p{font-size:12px;line-height:1.45;color:#607367}.histo-box select,.histo-box button{box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #bed3c3;border-radius:9px;background:white;color:#254b3c;font-size:13px}.histo-box button{font-weight:750}.histo-box button.primary{background:#245040;color:white}.histo-box button:disabled{opacity:.5}.histo-box input[type=file]{font-size:12px;max-width:100%;margin:9px 0}.histo-box label{font-size:12px;font-weight:650}";
 document.head.appendChild(css);
 const box=elm("details",undefined,"histo-box");
 box.innerHTML='<summary>HistoMap Berlin · historische Kartenwerke</summary><p>Die Jahresliste zeigt nur historische Karten, die am Mittelpunkt deiner Karte vorhanden sind. Beim Hinzufügen erhältst du dagegen den <strong>gesamten Berliner Jahrgang</strong>: Beim Verschieben werden passende Blätter automatisch nachgeladen.</p><button id="hmLoad" type="button">Kartenbestand aktualisieren</button><label for="hmYear">Verfügbare Jahre an diesem Ort</label><select id="hmYear" disabled><option>Bestand wird geladen …</option></select><button id="hmAdd" class="primary" type="button" disabled>Gesamten Berliner Jahrgang hinzufügen</button><p id="hmStatus" role="status">Noch nicht verbunden.</p><p>© Landesarchiv Berlin, HistoMap Berlin. <a href="https://histomapberlin.de/" target="_blank" rel="noopener noreferrer">Originalkarten ansehen</a></p><label for="hmXml">Falls der WMS-Zugriff scheitert: Kartenkatalogdatei (XML)</label><input id="hmXml" type="file" accept=".xml,application/xml,text/xml">';
 parent.prepend(box);
 const get=id=>$(box,id);
 let data=null;
 function updateYears(){
  if(!data)return;
  const middle=map.getCenter();
  const available=yearsAt(data,middle);
  const select=get("hmYear"),was=Number(select.value);
  select.replaceChildren();
  for(const year of available){
    const option=elm("option",year);option.value=String(year);select.appendChild(option);
  }
  if(!available.length){
    select.appendChild(elm("option","Hier keine datierten Kartenblätter"));
    select.disabled=true;get("hmAdd").disabled=true;
    get("hmStatus").textContent="An diesem Kartenmittelpunkt sind keine datierten HistoMap-Blätter verzeichnet. Kartenansicht verschieben, dann erneut öffnen.";
    return;
  }
  select.value=String(available.includes(was)?was:available.includes(1910)?1910:available[0]);
  select.disabled=false;
  get("hmAdd").disabled=!data.compatible;
  const all=data.items.filter(x=>x.year===Number(select.value)).length;
  get("hmStatus").textContent=data.compatible?
    available.length+" Jahrgänge an dieser Stelle verfügbar. "+all+" Blätter des ausgewählten Jahres sind berlinweit im Katalog. Beim Zoomen werden nur die sichtbaren geladen.":
    "Der WMS bestätigt keine EPSG:3857-Unterstützung. Ein korrektes Kartenoverlay lässt sich hier nicht aktivieren.";
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
 get("hmYear").addEventListener("change",updateYears);
 box.addEventListener("toggle",()=>{if(!box.open)return;if(data)updateYears();else refresh(false);});
 map.on("moveend",()=>{if(box.open&&data)updateYears();});
 get("hmXml").addEventListener("change",async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{if(file.size>16000000)throw Error("Katalogdatei zu groß.");data=setCache(parseCatalog(await file.text()));updateYears();}
  catch(error){get("hmStatus").textContent="Katalogdatei ungültig: "+error.message;}
  event.target.value="";
 });
 get("hmAdd").addEventListener("click",()=>{
  if(!data?.compatible)return;
  const year=Number(get("hmYear").value);
  if(!Number.isInteger(year))return;
  if(maps.some(m=>m&&!m.hidden&&m.type==="histomap"&&m.sourceUrl===SERVICE&&m.year===year)){
   get("hmStatus").textContent="Dieser gesamte Berliner Jahrgang ist bereits in deiner Bibliothek.";return;
  }
  try{
   add({name:"HistoMap Berlin "+year+" · Gesamtberlin",year,region:"Berlin",
    sourceUrl:SERVICE,type:"histomap",layerName:String(year),
    provider:"Landesarchiv Berlin / HistoMap Berlin",detailUrl:HOME},null);
   get("hmStatus").textContent="Der Berliner Jahrgang "+year+" wurde gespeichert.";
   box.closest("dialog")?.close();
   document.getElementById("sidebar")?.classList.remove("open");
  }catch(e){get("hmStatus").textContent="Übernahme fehlgeschlagen: "+e.message;}
 });
}
window.AtlasHistoMap={mount,createFullYearLayer,loadCatalogue,getCachedCatalog:fromCache,parseCatalog,yearsAt};
})();