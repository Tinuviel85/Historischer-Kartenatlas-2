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
   queryable:(function(){
     for(let n=layer;n&&n.nodeType===1;n=n.parentElement){
       const q=n.getAttribute("queryable");
       if(q!==null)return q==="1";
     }
     return false;
   })(),
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
// Inspect individual geospatial objects (B-Plans, land parcels, noise zones,
// protected areas...). Returns all advertised object attributes and links.
// The server, not our catalogue, is the sole authority for field values.
function cleanFeatureText(t){return String(t||"").replace(/\s+/g," ").trim();}
function featureList(features){
 const valid=(features||[]).filter(f=>f&&typeof f==="object").slice(0,25);
 return {features:valid.map(f=>({properties:f.properties||{},label:f.label||""})),
  count:valid.length,properties:valid[0]?.properties||null,source:"WMS GetFeatureInfo"};
}
function parseHTMLInfo(raw){
 const doc=new DOMParser().parseFromString(raw,"text/html");
 doc.querySelectorAll("script,style,iframe,object,embed").forEach(n=>n.remove());
 const results=[];
 function withLinks(properties,key,cell){
  const label=cleanFeatureText(key)||"Angabe";
  const value=cleanFeatureText(cell.textContent);
  if(value)properties[label]=value.slice(0,20000);
  const links=Array.from(cell.querySelectorAll("a[href]"));
  links.forEach((a,j)=>{
   const href=a.getAttribute("href")||"";
   try{
    const parsed=new URL(href,"https://gdi.berlin.de/");
    if(!/^https?:$/.test(parsed.protocol))return;
    const name=cleanFeatureText(a.textContent);
    const linkKey=(/https?:\/\//.test(value)?label:
      (name&&name!==label?label+" · "+name:label+" · Dokument"))+(links.length>1?" "+(j+1):"");
    properties[linkKey]=parsed.href;
   }catch(_){}
  });
 }
 const tables=Array.from(doc.querySelectorAll("table")).filter(t=>!t.parentElement?.closest("table"));
 for(const table of tables){
  const rows=Array.from(table.querySelectorAll("tr")).filter(r=>r.closest("table")===table);
  if(!rows.length)continue;
  const columns=rows[0].querySelectorAll(":scope > th");
  // GeoServer's feature info: a header row of field names followed by
  // one or more records. Each is an individual clickable object.
  if(columns.length>=2&&rows.length>=2&&!/^(attribut|field|merkmal|name|eigenschaft|property)$/i.test(cleanFeatureText(columns[0].textContent))){
   for(const row of rows.slice(1)){
    const cells=Array.from(row.children).filter(x=>/^(TH|TD)$/.test(x.tagName));
    if(cells.length!==columns.length)continue;
    const props={};
    columns.forEach((header,i)=>withLinks(props,header.textContent,cells[i]));
    if(Object.keys(props).length)results.push({properties:props});
   }
   continue;
  }
  const props={};
  for(const row of rows){
   const cells=Array.from(row.children).filter(x=>/^(TH|TD)$/.test(x.tagName));
   if(cells.length>=2){
    const label=cleanFeatureText(cells[0].textContent);
    if(label)withLinks(props,label,cells[1]);
   }
  }
  if(Object.keys(props).length)results.push({properties:props});
 }
 if(!results.length){
  const dts=Array.from(doc.querySelectorAll("dt"));
  if(dts.length){
   const props={};
   for(const dt of dts){const dd=dt.nextElementSibling;if(dd?.tagName==="DD")withLinks(props,dt.textContent,dd);}
   if(Object.keys(props).length)results.push({properties:props});
  }
 }
 if(!results.length){
  const body=cleanFeatureText(doc.body?.textContent||"");
  if(body&&body.length<50000&&!/^(no features|kein(e|en)? (objekt|ergebnis|treffer)|search returned no results)/i.test(body)){
   const props={"Auskunft des Kartendienstes":body.slice(0,20000)};
   const links=Array.from(doc.querySelectorAll("a[href]"));
   links.forEach((link,i)=>{
    try{
     const uri=new URL(link.getAttribute("href"),"https://gdi.berlin.de/");
     if(/^https?:$/.test(uri.protocol))
       props[(cleanFeatureText(link.textContent)||"Dokument")+" "+(i+1)]=uri.href;
    }catch(_){}
   });
   results.push({properties:props});
  }
 }
 return featureList(results);
}
function parseXMLInfo(raw){
 const doc=new DOMParser().parseFromString(raw,"application/xml");
 if(doc.getElementsByTagName("parsererror").length)throw Error("Der Dienst liefert kein gültiges XML.");
 const results=[];
 const members=Array.from(doc.getElementsByTagName("*")).filter(e=>
  /^(featureMember|member|FeatureInfo|FIELDS|Feature)$/i.test(e.localName));
 const sources=members.length?members:[doc.documentElement];
 for(const source of sources.slice(0,25)){
  const props={};
  const attributes=source.attributes||[];
  for(const attr of attributes){
   if(/^(id|fid|xmlns|schemaLocation)$/i.test(attr.localName))continue;
   const v=cleanFeatureText(attr.value);
   if(v)props[attr.localName]=v;
  }
  for(const element of Array.from(source.getElementsByTagName("*"))){
   if(element.children.length||/^(coordinates|posList|pos|boundedBy|Envelope|Polygon|MultiPolygon|geometryProperty)$/i.test(element.localName))continue;
   const value=cleanFeatureText(element.textContent);
   if(value&&value.length<20000)props[element.localName]=value;
   const href=element.getAttributeNS("http://www.w3.org/1999/xlink","href")||element.getAttribute("href");
   if(href&&/^https?:\/\//i.test(href))props[element.localName+" · Quelle"]=href;
  }
  if(Object.keys(props).length)results.push({properties:props});
 }
 return featureList(results);
}
function parsePlainInfo(raw){
 const text=String(raw||"").trim();
 if(!text||/^(no features|kein(e|en)? (objekt|ergebnis|treffer)|search returned no results)/i.test(text))
  return featureList([]);
 const props={};
 for(const line of text.split(/\r?\n/)){
  const trimmed=line.trim();
  const match=trimmed.match(/^([^:]{2,90})\s*:\s*(.+)$/);
  if(match)props[cleanFeatureText(match[1])]=cleanFeatureText(match[2]).slice(0,20000);
 }
 if(!Object.keys(props).length)props["Auskunft des Kartendienstes"]=text.slice(0,20000);
 return featureList([{properties:props}]);
}
async function getWMSFeatureInfo(map,L,latlng,url,layerName){
 if(!allowedUrl(url))throw Error("Unbekannter Berliner Kartendienst.");
 const caps=await capabilities(url);
 const layers=selectedWmsLayers(url,caps,layerName);
 const queryable=layers.filter(l=>l.queryable);
 if(!queryable.length)
  return {features:[],properties:null,error:"Diese Kartenebene bietet laut Anbieter keine Objektabfrage an. Du kannst die Originalquelle öffnen."};
 const offered=caps.infoFormats||[];
 const preferred=[
  offered.find(f=>/^application\/(?:geo\+json|json)(?:$|[; ])/i.test(f)),
  offered.find(f=>/^text\/html(?:$|[; ])/i.test(f)),
  offered.find(f=>/^(?:application\/(?:vnd\.ogc\.gml|xml)|text\/xml)/i.test(f)),
  offered.find(f=>/^text\/plain(?:$|[; ])/i.test(f))
 ].filter(Boolean);
 if(!preferred.length)
  return {features:[],properties:null,error:"Dieser Kartendienst stellt keine unterstützte Sachdatenantwort bereit."};
 const size=map.getSize(),point=map.latLngToContainerPoint(latlng);
 const params=wmsImage(queryable.map(l=>l.name),map.getBounds(),L,size);
 params.set("REQUEST","GetFeatureInfo");
 params.set("QUERY_LAYERS",queryable.map(l=>l.name).join(","));
 params.set("FEATURE_COUNT","20");
 params.set("X",String(Math.max(0,Math.min(size.x-1,Math.round(point.x)))));
 params.set("Y",String(Math.max(0,Math.min(size.y-1,Math.round(point.y)))));
 let lastError=null,empty=null;
 for(const format of preferred){
  params.set("INFO_FORMAT",format);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),13500);
  try{
   const response=await fetch(url+"?"+params.toString(),{mode:"cors",signal:controller.signal});
   if(!response.ok)throw Error("GetFeatureInfo HTTP "+response.status);
   const body=await response.text();
   if(/<ServiceExceptionReport|<ExceptionReport/i.test(body))
    throw Error("Der Kartendienst hat diese Sachdatenabfrage zurückgewiesen.");
   let result;
   if(/json/i.test(format)){
    const data=JSON.parse(body);
    const features=Array.isArray(data.features)?data.features:
      data.type==="Feature"?[data]:[];
    result=featureList(features);
   }else if(/html/i.test(format))result=parseHTMLInfo(body);
   else if(/(?:xml|gml)/i.test(format))result=parseXMLInfo(body);
   else result=parsePlainInfo(body);
   // A response with feature geometry but no attributes is not useful:
   // try the next available output format (often HTML with plan PDF links).
   if(result.features.some(feature=>Object.keys(feature.properties||{}).length>0))
     return {...result,source:"Geoportal Berlin ("+format+")"};
   empty=result;
  }catch(e){lastError=e;}
  finally{clearTimeout(timer);}
 }
 return {...(empty||featureList([])),
  error:lastError&&!empty?"Die Sachdaten konnten nicht abgerufen werden: "+lastError.message:
    "An dieser Stelle meldet der Dienst keine abfragbaren Kartenobjekte."};
}
// Berlin's official B-Plan WFS exposes procedural fields and links to
// Planzeichnung, Begründung and Bebauungsplan files even if GetFeatureInfo
// is not queryable for the corresponding WMS layer.
const BPLAN_WFS="https://gdi.berlin.de/services/wfs/bplan";
let bplanTypeNames=null,bplanTypesLoading=null;
async function bplanTypes(){
 if(bplanTypeNames)return bplanTypeNames;
 if(bplanTypesLoading)return bplanTypesLoading;
 bplanTypesLoading=(async()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12500);
  try{
   const response=await fetch(BPLAN_WFS+"?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities",
     {mode:"cors",signal:controller.signal});
   if(!response.ok)throw Error("B-Plan-WFS HTTP "+response.status);
   const xml=new DOMParser().parseFromString(await response.text(),"application/xml");
   if(xml.getElementsByTagName("parsererror").length)throw Error("WFS-Metadaten unlesbar");
   const types=Array.from(xml.getElementsByTagNameNS("*","FeatureType"))
     .map(element=>directText(element,"Name")).filter(Boolean);
   if(!types.length)throw Error("Keine Bebauungsplan-Objekte im WFS");
   const relevant=types.filter(name=>/bplan|bebau|plan|verfahren|festgesetz|rechtskraft/i.test(name));
   bplanTypeNames=(relevant.length?relevant:types).slice(0,8);
   return bplanTypeNames;
  }finally{clearTimeout(timer);}
 })();
 try{return await bplanTypesLoading;}finally{bplanTypesLoading=null;}
}
async function queryBPlanWFS(map,L,latlng){
 const names=await bplanTypes();
 const location=map.latLngToContainerPoint(latlng);
 const radius=6;
 const swLatLng=map.containerPointToLatLng(L.point(location.x-radius,location.y+radius));
 const neLatLng=map.containerPointToLatLng(L.point(location.x+radius,location.y-radius));
 const a=L.CRS.EPSG3857.project(swLatLng),b=L.CRS.EPSG3857.project(neLatLng);
 const bbox=[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y),"EPSG:3857"].join(",");
 const queries=names.map(async name=>{
  const p=new URLSearchParams({SERVICE:"WFS",VERSION:"2.0.0",REQUEST:"GetFeature",
   typeNames:name,outputFormat:"application/json",srsName:"EPSG:3857",COUNT:"12",BBOX:bbox});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch(BPLAN_WFS+"?"+p.toString(),{mode:"cors",signal:controller.signal});
   if(!response.ok)throw Error("WFS HTTP "+response.status);
   const body=await response.json();
   if(body.type!=="FeatureCollection"||!Array.isArray(body.features))throw Error("Keine GeoJSON-Objekte");
   return body.features.map(feature=>({properties:feature.properties||{},label:name}));
  }finally{clearTimeout(timer);}
 });
 const responses=await Promise.allSettled(queries);
 const records=responses.filter(v=>v.status==="fulfilled").flatMap(v=>v.value);
 if(records.length){
  // WFS types can overlap; do not hide simultaneously applicable plans.
  return {...featureList(records.slice(0,25)),source:"Bebauungspläne Berlin · WFS"};
 }
 const firstError=responses.find(r=>r.status==="rejected");
 if(firstError&&responses.every(r=>r.status==="rejected"))
  throw firstError.reason;
 return {...featureList([]),error:"Für diesen Punkt sind im Berliner Bebauungsplan-WFS keine Planobjekte verzeichnet."};
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
async function getFeatureInfo(map,L,latlng,url,layerName){
 if(/\/bplan$/i.test(url)){
  try{
   const plans=await queryBPlanWFS(map,L,latlng);
   if(plans.features?.length)return plans;
  }catch(_){/* WMS GetFeatureInfo remains available as fallback. */}
 }
 return getWMSFeatureInfo(map,L,latlng,url,layerName);
}
window.AtlasGeoportal={mount,createLayer,capabilities,allowedUrl,getTreeInfo,getFeatureInfo,services:SERVICES};
})();