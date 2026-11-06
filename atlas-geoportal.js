/* Geoportal Berlin: verified public Berlin WMS catalogue and overlay integration.
   Provider URLs are maintained by Berlin GDI, never the retired FIS-Broker. */
(function(){
"use strict";
const ROOT="https://gdi.berlin.de/services/wms/";
const SERVICES=[
 {id:"aerial1928",year:1928,title:"Luftbilder Berlin 1928",group:"Historische Luftbilder",slug:"luftbild_1928_04",wmsLayers:["c_luftbilder_1928_04_raster"],focusZoom:15,note:"Rasterluftbilder 1:4.000 – bei starker Vergrößerung sichtbar"},
 {id:"aerial1938",year:1938,title:"Luftbilder Berlin 1938",group:"Historische Luftbilder",slug:"luftbild_1938_04",wmsLayers:["c_luftbilder_1938_04_raster"],focusZoom:15,note:"Rasterluftbilder 1:4.000 – ohne Blattschnitt- und Bildmittenmarkierungen"},
 {id:"aerial1953",year:1953,title:"Luftbilder Berlin 1953",group:"Historische Luftbilder",slug:"luftbild_1953_22",wmsLayers:["c_luftbilder_1953_22_raster"],focusZoom:14,note:"Original-Luftbilder 1:22.000"},
 {id:"aerial1964",year:1964,title:"Luftbild-Nachweis Berlin 1964",group:"Historische Luftbilder",slug:"luftbild_1964_04",wmsLayers:[],indexOnly:true,note:"Nur Bildmitten und Gebietsabdeckung – keine Bildrasterkarte in diesem WMS"},
 {id:"aerial1989",year:1989,title:"Luftbild-Nachweis West-Berlin 1989",group:"Historische Luftbilder",slug:"luftbild_1989_04",wmsLayers:[],indexOnly:true,note:"Nur Bildmitten und Gebietsabdeckung – keine Bildrasterkarte in diesem WMS"},
 {id:"aerial2025",year:2025,title:"Digitale Orthophotos Berlin 2025",group:"Aktuelle Luftbilder",slug:"dop_2025_fruehjahr",wmsLayers:["dop_2025"],note:"Aktuelle Luftbilder als echte Orthophoto-Rasterebene"},
 {id:"straube",year:1910,title:"Straubes Übersichtsplan 1910",group:"Historische Karten",slug:"straubeplan",wmsLayers:["straubeplan"],note:"Historische Mitte, 44 Blätter; kein Gesamt-Berlin"},
 {id:"trees",year:null,title:"Baumbestand Berlin",group:"Natur und Umwelt",slug:"baumbestand",wmsLayers:["strassenbaeume","anlagenbaeume"],note:"Straßen- und Anlagenbäume mit Sachdatenabfrage",overlay:true}
];
const BY_ID=new Map(SERVICES.map(s=>[s.id,s]));
const cache=new Map();
const pending=new Map();
function urlFor(id){const entry=BY_ID.get(id);return entry?ROOT+entry.slug:null;}
function allowedUrl(url){return typeof url==='string'&&/^https:\/\/gdi\.berlin\.de\/services\/wms\/[a-z0-9_-]{2,120}$/i.test(url);}
function directChildren(node,tag){return Array.from(node.children||[]).filter(e=>e.localName===tag);}
function directText(node,tag){return directChildren(node,tag)[0]?.textContent?.trim()||"";}
function geoBox(layer){
 for(let n=layer;n&&n.nodeType===1;n=n.parentElement){
  let b=directChildren(n,"EX_GeographicBoundingBox")[0];
  if(b){
   const v=["westBoundLongitude","southBoundLatitude","eastBoundLongitude","northBoundLatitude"].map(k=>Number(directText(b,k)));
   if(v.every(Number.isFinite)&&v[0]<v[2]&&v[1]<v[3])return v;
  }
  b=directChildren(n,"LatLonBoundingBox")[0];
  if(b){
   const v=["minx","miny","maxx","maxy"].map(k=>Number(b.getAttribute(k)));
   if(v.every(Number.isFinite)&&v[0]<v[2]&&v[1]<v[3])return v;
  }
 }
 return null;
}
function parseCapabilities(raw){
 if(raw.length>18000000)throw Error("Die Kartenliste ist zu groß.");
 const xml=new DOMParser().parseFromString(raw,"application/xml");
 if(xml.getElementsByTagName("parsererror").length)throw Error("Ungültige WMS-Kartenliste.");
 const nodes=Array.from(xml.getElementsByTagNameNS("*","Layer"));
 if(!nodes.length)throw Error("Keine WMS-Kartenebenen gefunden.");
 const crs=Array.from(xml.getElementsByTagNameNS("*","SRS"))
   .concat(Array.from(xml.getElementsByTagNameNS("*","CRS")));
 if(!crs.some(e=>/(^|\s)EPSG:3857(\s|$)/i.test(e.textContent||"")))
   throw Error("Der Dienst bestätigt keine Web-Mercator-Darstellung (EPSG:3857).");
 function childLinks(l,name){
   return directChildren(l,name).flatMap(m=>
      Array.from(m.getElementsByTagNameNS("*","OnlineResource")).map(u=>
       u.getAttributeNS("http://www.w3.org/1999/xlink","href")||
       u.getAttribute("xlink:href")||u.getAttribute("href")||""
      ).filter(v=>/^https?:\/\//i.test(v)));
 }
 const named=nodes.map(layer=>({
   name:directText(layer,"Name"),title:directText(layer,"Title"),
   abstract:directText(layer,"Abstract"),
   keywords:directChildren(layer,"KeywordList").flatMap(n=>
      Array.from(n.getElementsByTagNameNS("*","Keyword")).map(x=>x.textContent.trim()).filter(Boolean)),
   crs:directChildren(layer,"CRS").concat(directChildren(layer,"SRS")).map(x=>x.textContent.trim()),
   styles:directChildren(layer,"Style").map(x=>directText(x,"Name")).filter(Boolean),
   metadataUrls:childLinks(layer,"MetadataURL"),dataUrls:childLinks(layer,"DataURL"),
   attribution:directChildren(layer,"Attribution").map(x=>directText(x,"Title")).filter(Boolean).join("; "),
   minScale:directText(layer,"MinScaleDenominator"),
   maxScale:directText(layer,"MaxScaleDenominator"),
   queryable:layer.getAttribute("queryable")==="1",
   group:directChildren(layer,"Layer").length>0,box:geoBox(layer)
 })).filter(x=>x.name);
 const featureQuery=Array.from(xml.getElementsByTagNameNS("*","GetFeatureInfo"))[0];
 const infoFormats=featureQuery?
   Array.from(featureQuery.getElementsByTagNameNS("*","Format")).map(x=>x.textContent.trim()).filter(Boolean):[];
 return {leaves:named.filter(x=>!x.group),infoFormats};
}
function serviceForUrl(url){return SERVICES.find(entry=>ROOT+entry.slug===url);}
function selectedWmsLayers(url,info,selection){
 const leaves=(info&&info.leaves)||[];
 if(typeof selection==="string"&&selection!=="auto"&&selection.trim()){
  const names=selection.split(",").map(v=>v.trim()).filter(Boolean);
  const chosen=names.map(name=>leaves.find(layer=>layer.name===name));
  if(chosen.length&&chosen.every(Boolean))return chosen;
  throw Error("Die ausgewählte Kartenebene wird vom WMS nicht angeboten.");
 }
 const entry=serviceForUrl(url);
 const reject=/(?:bildmitte|bildzentrum|bildmittel|blattschnitt|gebietsabdeckung|bildindex|bildpunkt|uebersicht|übersicht|nachweis|footprint|index|coverage|blattgrenz|bildstandort|flugstreifen|umring|rahmen|aufnahmeort)/i;
 const usable=leaves.filter(l=>!reject.test(l.name+" "+l.title));
 if(entry?.indexOnly)throw Error("Dieser Dienst ist nur ein Luftbildnachweis. Das Foto selbst ist hier nicht als Rasterebene hinterlegt.");
 for(const id of entry?.wmsLayers||[]){
  const exact=usable.find(l=>l.name===id||l.name.endsWith(":"+id));
  if(exact)return [exact];
 }
 if(!usable.length)
   throw Error("Der Dienst bietet keine Bild- oder Kartenebene an, sondern nur Blattschnitt und Nachweispunkte.");
 const aerial=/luftbild|orthophoto|dop_|fotoblatt|senkrechtaufnahme/i.test(url);
 const score=l=>{
  const v=(l.name+" "+l.title).toLowerCase();
  let n=0;
  if(/raster|mosaik|orthophoto|fotoblatt|bilddaten|bildkarte|imagery/i.test(v))n+=15;
  if(/luftbild|luftaufnahm|bildplan|stadtplan|karte von berlin/i.test(v))n+=10;
  if(/^c_|^b_/.test(l.name))n+=2;
  if(aerial&&!/luftbild|bild|foto|raster|mosaik|orthophoto/i.test(v))n-=10;
  return n;
 };
 const ranked=usable.slice().sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name));
 // If the expected layer ID from an earlier code version was not published,
 // select the photographic layer actually advertised by GetCapabilities.
 return [ranked[0]];
}
async function capabilities(url,force=false){
 if(!allowedUrl(url))throw Error("Unbekannter Geodienst.");
 if(!force&&cache.has(url))return cache.get(url);
 if(pending.has(url))return pending.get(url);
 const request=(async()=>{
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),14000);
  try{
   const response=await fetch(url+"?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities",
    {signal:ctl.signal,mode:"cors"});
   if(!response.ok)throw Error("HTTP "+response.status);
   const info=parseCapabilities(await response.text());cache.set(url,info);return info;
  }finally{clearTimeout(timer);}
 })();
 pending.set(url,request);
 try{return await request;}finally{pending.delete(url);}
}
function wmsImage(names,bounds,L,size){
 const sw=L.CRS.EPSG3857.project(bounds.getSouthWest());
 const ne=L.CRS.EPSG3857.project(bounds.getNorthEast());
 const query=new URLSearchParams({
  SERVICE:"WMS",VERSION:"1.1.1",REQUEST:"GetMap",LAYERS:names.join(","),
  STYLES:"",TRANSPARENT:"TRUE",FORMAT:"image/png",SRS:"EPSG:3857",
  BBOX:[sw.x,sw.y,ne.x,ne.y].join(","),WIDTH:String(size.x),HEIGHT:String(size.y)
 });
 return query;
}
function createLayer(L,url,onError,options={}){
 if(!allowedUrl(url))throw Error("Unbekannter Geoportal-Dienst.");
 const service=serviceForUrl(url);
 if(service?.indexOnly)throw Error("Dieser Dienst enthält lediglich Bildmitten oder Blattschnitte.");
 // Leaflet's native WMS tiles have the SAME lifecycle as MapWarper tiles:
 // setOpacity() works, removeLayer() cancels tiles and selection never
 // leaves previous viewport images behind. The old image-overlay implementation
 // did not support setOpacity() and could leave provisional images on the map.
 const StandardWMS=L.Layer.extend({
  initialize:function(){
   this._opacity=1;this._generation=0;this._inner=null;this._map=null;
  },
  onAdd:function(map){
   this._map=map;
   const sequence=++this._generation;
   capabilities(url).then(info=>{
     if(!this._map||this._map!==map||sequence!==this._generation)return;
     const layers=selectedWmsLayers(url,info,options.layerName).map(x=>x.name);
     if(!layers.length)throw Error("Keine darstellbaren Kartenebenen vorhanden.");
     const tile=L.tileLayer.wms(url,{
       layers:layers.join(","),format:"image/png",transparent:true,version:"1.1.1",
       minZoom:2,maxZoom:19,keepBuffer:2,updateWhenIdle:true,
       updateWhenZooming:false,opacity:this._opacity,noWrap:true
     });
     tile.on("tileerror",()=>{
       if(sequence===this._generation&&!this._tileErrorShown){
         this._tileErrorShown=true;
         onError?.("Der Berliner Kartendienst konnte einzelne Kartenbilder nicht liefern.");
       }
     });
     if(sequence!==this._generation||!this._map)return;
     this._inner=tile;tile.addTo(map);
   }).catch(err=>{
     if(sequence===this._generation&&this._map)
       onError?.("Geoportal Berlin: "+err.message);
   });
  },
  onRemove:function(map){
   ++this._generation;
   if(this._inner){
     if(map.hasLayer(this._inner))map.removeLayer(this._inner);
     this._inner=null;
   }
   this._map=null;
  },
  setOpacity:function(value){
   this._opacity=Math.max(0,Math.min(1,Number(value)));
   if(this._inner)this._inner.setOpacity(this._opacity);
   return this;
  },
  getOpacity:function(){return this._opacity;}
 });
 return new StandardWMS();
}
const TREE_WFS="https://gdi.berlin.de/services/wfs/baumbestand";
let treeTypeNames=null,treeLookup=null;
async function treeTypes(){
 if(treeTypeNames)return treeTypeNames;
 if(treeLookup)return treeLookup;
 treeLookup=(async()=>{
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
  try{
   const res=await fetch(TREE_WFS+"?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities",{signal:ctl.signal,mode:"cors"});
   if(!res.ok)throw Error("WFS HTTP "+res.status);
   const xml=new DOMParser().parseFromString(await res.text(),"application/xml");
   if(xml.getElementsByTagName("parsererror").length)throw Error("WFS-Katalog unlesbar");
   let names=Array.from(xml.getElementsByTagNameNS("*","FeatureType"))
     .map(t=>directText(t,"Name")).filter(Boolean);
   names=names.filter(n=>/baum|tree/i.test(n));
   if(!names.length)throw Error("Der WFS nennt keine Baumdatensätze");
   treeTypeNames=names.slice(0,5);
   return treeTypeNames;
  }finally{clearTimeout(timer);}
 })();
 try{return await treeLookup;}finally{treeLookup=null;}
}
async function getTreeInfo(map,L,latlng){
 const px=map.latLngToContainerPoint(latlng),tolerance=13;
 const a=map.containerPointToLatLng(L.point(px.x-tolerance,px.y+tolerance));
 const b=map.containerPointToLatLng(L.point(px.x+tolerance,px.y-tolerance));
 const sw=L.CRS.EPSG3857.project(a),ne=L.CRS.EPSG3857.project(b);
 const bbox=[Math.min(sw.x,ne.x),Math.min(sw.y,ne.y),Math.max(sw.x,ne.x),Math.max(sw.y,ne.y),"EPSG:3857"].join(",");
 let error=null;
 try {
  const types=await treeTypes();
  for(const type of types){
   const p=new URLSearchParams({SERVICE:"WFS",VERSION:"2.0.0",REQUEST:"GetFeature",
    typeNames:type,outputFormat:"application/json",srsName:"EPSG:3857",COUNT:"12",BBOX:bbox});
   const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),11000);
   try{
    const response=await fetch(TREE_WFS+"?"+p.toString(),{mode:"cors",signal:ctl.signal});
    if(!response.ok)throw Error("WFS HTTP "+response.status);
    const data=await response.json();
    if(data.type!=="FeatureCollection"||!Array.isArray(data.features))throw Error("Kein GeoJSON");
    if(data.features.length){
      const point=L.CRS.EPSG3857.project(latlng);
      const ranked=data.features.slice().sort((a,b)=>{
       function dist(f){
         const coords=f?.geometry?.type==="Point"?f.geometry.coordinates:null;
         return coords&&coords.length>=2?(Number(coords[0])-point.x)**2+(Number(coords[1])-point.y)**2:0;
       }
       return dist(a)-dist(b);
      });
      return {properties:ranked[0].properties||{},source:"WFS Berlin",count:data.features.length};
    }
   }finally{clearTimeout(timer);}
  }
 }catch(e){error=e;}
 // Some WMS layers support GetFeatureInfo even when their WFS cannot be
 // requested from another origin; use its advertised formats and layer names.
 try{
  const url=urlFor("trees"),caps=await capabilities(url);
  const choices=caps.leaves.filter(l=>/baum|tree/i.test(l.name+" "+l.title));
  const layers=(choices.length?choices:caps.leaves).map(l=>l.name).slice(0,6);
  if(layers.length){
   const bounds=map.getBounds(),size=map.getSize();
   const p=wmsImage(layers,bounds,L,size);
   p.set("REQUEST","GetFeatureInfo");
   p.set("LAYERS",layers.join(","));p.set("QUERY_LAYERS",layers.join(","));
   p.set("X",String(Math.max(0,Math.min(size.x-1,Math.round(px.x)))));
   p.set("Y",String(Math.max(0,Math.min(size.y-1,Math.round(px.y)))));
   p.set("INFO_FORMAT","application/json");p.set("FEATURE_COUNT","5");
   const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
   try{
    const response=await fetch(url+"?"+p.toString(),{mode:"cors",signal:ctl.signal});
    if(!response.ok)throw Error("WMS GetFeatureInfo HTTP "+response.status);
    const result=await response.json();
    if(result.features?.length)return {properties:result.features[0].properties||{},source:"WMS Berlin",count:result.features.length};
   }finally{clearTimeout(timer);}
  }
 }catch(e){error=error||e;}
 return {properties:null,source:"Geoportal Berlin",error:error?.message||null};
}
function mount({parent,maps,add}){
 if(!parent||!add)return;
 const style=document.createElement("style");
 style.textContent=".gdi-catalog{border:1px solid #c4d8c8;border-radius:13px;background:#f3f8f4;margin-bottom:14px;padding:12px}.gdi-catalog summary{font-size:14px;font-weight:800;color:#214b3c;cursor:pointer}.gdi-catalog p{font-size:12px;color:#617568;line-height:1.5}.gdi-group{font-weight:800;margin:13px 0 7px;color:#355b47;font-size:12px}.gdi-entry{display:flex;gap:9px;align-items:center;justify-content:space-between;border:1px solid #dce8de;border-radius:10px;background:white;margin:7px 0;padding:10px}.gdi-entry strong{display:block;font-size:12px;color:#284434}.gdi-entry small{display:block;font-size:11px;color:#62786b;margin-top:4px}.gdi-entry button{font-size:12px;font-weight:750;padding:9px;border-radius:9px;border:1px solid #bdd0c2;background:#245544;color:white;flex:none}.gdi-entry button:disabled{opacity:.65}.gdi-status{font-size:11px;line-height:1.4;color:#4c6d59;margin:7px 0}.gdi-entry a{font-size:11px;color:#2b684f}.gdi-check{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;white-space:nowrap}";
 document.head.appendChild(style);
 const wrap=document.createElement("details");wrap.className="gdi-catalog";
 wrap.innerHTML='<summary>Geoportal Berlin</summary><p>Amtliche Berliner Geodaten in wenigen Schritten übernehmen. Jede Quelle wird als eigenständige Karte in deiner Kartenauswahl geführt – auch der heutige Baumbestand. Beim Kartenwechsel wird die bisherige Karte vollständig ersetzt.</p><div id="gdiItems"></div><p class="gdi-status" id="gdiStatus" role="status"></p><p><a href="https://gdi.berlin.de/" target="_blank" rel="noopener noreferrer">Offizielles Geoportal Berlin öffnen</a> · <a href="https://daten.berlin.de/" target="_blank" rel="noopener noreferrer">Daten und Lizenzen</a></p>';
 parent.prepend(wrap);
 const listing=wrap.querySelector("#gdiItems"),status=wrap.querySelector("#gdiStatus");
 const refreshes=[];
 let activeGroup="";
 for(const entry of SERVICES){
  if(entry.group!==activeGroup){activeGroup=entry.group;listing.appendChild(Object.assign(document.createElement("div"),{className:"gdi-group",textContent:activeGroup}));}
  const row=document.createElement("div");row.className="gdi-entry";
  const detail=document.createElement("div");detail.style.minWidth="0";
  const title=Object.assign(document.createElement("strong"),{textContent:entry.title});
  const desc=Object.assign(document.createElement("small"),{textContent:entry.note});
  const orig=document.createElement("a");orig.href="https://gdi.berlin.de/view/"+entry.slug;
  orig.target="_blank";orig.rel="noopener noreferrer";orig.textContent="Originalquelle";
  detail.append(title,desc,orig);
  const button=document.createElement("button");button.type="button";
  function alreadyMap(){return maps.some(m=>m&&!m.hidden&&m.sourceUrl===urlFor(entry.id)&&m.type==="geoportal");}
  function refreshButton(){
   if(entry.indexOnly){
     button.textContent="Nur Nachweis";
     button.disabled=true;
     button.title="Dieser WMS-Dienst zeigt die Lage der Aufnahmen, aber keine Luftbild-Rasterebene.";
     return;
   }
   button.textContent=alreadyMap()?"In Kartenliste": "+ Hinzufügen";
   button.disabled=alreadyMap();
  }
  refreshes.push(refreshButton);
  refreshButton();
  button.addEventListener("click",async()=>{
   if(entry.indexOnly)return;
   button.disabled=true;button.textContent="Verbinde …";status.textContent="Prüfe Kartendienst "+entry.title+" …";
   try{
     await capabilities(urlFor(entry.id));
     add({name:entry.title,year:entry.year,region:"Berlin",sourceUrl:urlFor(entry.id),
       type:"geoportal",layerName:"auto",detailUrl:"https://gdi.berlin.de/view/"+entry.slug,
       provider:"Geoportal Berlin / Land Berlin"},null);
     status.textContent="Karte zur gemeinsamen Kartenliste hinzugefügt.";
     wrap.closest("dialog")?.close();
     document.getElementById("sidebar")?.classList.remove("open");
   }catch(e){
    status.textContent="Die Karte konnte nicht automatisch übernommen werden ("+
      (e.name==="AbortError"?"Zeitüberschreitung":e.message)+"). Über „Originalquelle“ kannst du sie im Geoportal ansehen.";
   }finally{refreshButton();}
  });
  row.append(detail,button);listing.appendChild(row);
 }
 wrap.addEventListener("toggle",()=>{if(wrap.open)refreshes.forEach(fn=>fn());});
 if(window.AtlasGeoSearch)window.AtlasGeoSearch.mount({parent:wrap,maps,add,capabilities});
}
window.AtlasGeoportal={mount,createLayer,capabilities,allowedUrl,getTreeInfo,services:SERVICES};
})();