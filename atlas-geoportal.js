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
 // Auch Dienste mit EPSG:4326 werden in der Ebenenauswahl angezeigt.
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
   crs:(function(){
    const set=new Set();
    for(let anc=layer;anc&&anc.nodeType===1;anc=anc.parentElement){
     for(const el of directChildren(anc,"CRS").concat(directChildren(anc,"SRS")))
      for(const code of (el.textContent||"").trim().split(/\\s+/))if(code)set.add(code);
     if(anc.localName==="Capability")break;
    }
    return [...set];
   })(),
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
// ETRS89 / UTM Zone 33N (EPSG:25833), amtliches Karten-CRS in Berlin.
// Leaflet bringt nur 3857/4326 mit. Die Projektion wird hier lokal in
// WMS-BBOX-Koordinaten umgerechnet; keine zusaetzliche Bibliothek noetig.
function berlinUTM33(L){
 const a=6378137,f=1/298.257222101,e2=f*(2-f),ep2=e2/(1-e2),k0=.9996;
 return {code:"EPSG:25833",project:function(ll){
  const p=ll.lat*Math.PI/180,d=(ll.lng-15)*Math.PI/180;
  const sn=Math.sin(p),cs=Math.cos(p),tan=Math.tan(p),T=tan*tan,C=ep2*cs*cs,A=cs*d;
  const n=a/Math.sqrt(1-e2*sn*sn);
  const m=a*((1-e2/4-3*e2*e2/64-5*e2**3/256)*p
   -(3*e2/8+3*e2*e2/32+45*e2**3/1024)*Math.sin(2*p)
   +(15*e2*e2/256+45*e2**3/1024)*Math.sin(4*p)
   -35*e2**3/3072*Math.sin(6*p));
  return L.point(500000+k0*n*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120),
   k0*(m+n*tan*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720)));
 }};
}
// Oeffentlich dokumentierte Luftbildkacheln von Code for Germany / OpenStreetMap.
// Nur exakt nachgewiesene Jahrgaenge; nie Jahrgaenge umetikettieren.
const PHOTO_TMS={
 "1928":"https://tiles.codefor.de/berlin-1928/{z}/{x}/{y}.png",
 "1953":"https://tiles.codefor.de/berlin-1953/{z}/{x}/{y}.png",
 "2014":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2014-dop20rgb/{z}/{x}/{y}.png",
 "2015":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2015-dop20rgb/{z}/{x}/{y}.png",
 "2016":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2016-dop20rgb/{z}/{x}/{y}.png",
 "2017":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2017-dop20rgb/{z}/{x}/{y}.png",
 "2018":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2018-dop20rgb/{z}/{x}/{y}.png",
 "2019":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2019-dop20rgb/{z}/{x}/{y}.png",
 "2020":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2020-truedop20rgb/{z}/{x}/{y}.png",
 "2021":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2021-dop20rgbi/{z}/{x}/{y}.png",
 "2022":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2022-dop20rgbi/{z}/{x}/{y}.png",
 "2023":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2023-dop20rgbi/{z}/{x}/{y}.png",
 "2024":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2024-dop20rgbi/{z}/{x}/{y}.png",
 "2025":"https://tiles.codefor.de/berlin/geoportal/luftbilder/2025-dop20rgb/{z}/{x}/{y}.png"
};
function mirrorFor(url){
 const slug=url.split("/").pop()||"";
 const yr=slug.match(/(?:^|_)(19\d{2}|20\d{2})(?:_|$)/)?.[1]||"";
 if(yr==="2025"&&/sommer|true/i.test(slug))
  return "https://tiles.codefor.de/berlin/geoportal/luftbilder/2025-truedop20rgb/{z}/{x}/{y}.png";
 return PHOTO_TMS[yr]||null;
}
function supportedCrsFor(info,names){
 const list=(info?.leaves||[]).filter(l=>names.split(",").some(n=>l.name===n||l.name.endsWith(":"+n)));
 return [...new Set(list.flatMap(l=>l.crs||[]).flatMap(x=>String(x).split(/\s+/)).filter(Boolean))];
}
function createLayer(L,url,onError,options={}){
 if(!allowedUrl(url))throw Error("Unbekannter Berliner Kartendienst.");
 const service=serviceForUrl(url);
 if(service?.indexOnly)throw Error("Der Dienst stellt nur einen Bildnachweis bereit.");
 // Aerial photo mosaics need far fewer, larger WMS GetMap requests than
 // repeatedly requesting small 256-pixel tiles. This viewport WMS layer
 // supports native Leaflet lifecycle + opacity, including instant removal.
 // Other Fachkarten use ordinary WMS tiles as before.
 const photo=/luftbild|dop_|orthophoto|straubeplan/i.test(url);
 if(photo){
  const PhotoWMS=L.Layer.extend({
   initialize:function(){
    this._map=null;this._inner=null;this._opacity=1;this._version=0;this._stage=0;
    this._loaded=false;this._warned=false;this._names="";this._retryTimer=null;this._variants=[];
   },
   onAdd:function(map){
    this._map=map;const v=++this._version;
    const explicit=typeof options.layerName==="string"&&options.layerName.trim()&&options.layerName!=="auto"
      ?options.layerName.trim():"";
    if(explicit){
     this._start(explicit,v,cache.get(url));
     return;
    }
    capabilities(url).then(info=>{
     if(v!==this._version||this._map!==map)return;
     this._start(selectedWmsLayers(url,info,"auto").map(x=>x.name).join(","),v,info);
    }).catch(e=>{
     if(v!==this._version||this._map!==map)return;
     if(service?.wmsLayers?.length)this._start(service.wmsLayers.join(","),v,null);
     else onError?.("Luftbild-Layer nicht abrufbar: "+e.message);
    });
   },
   _start:function(names,v,info){
    if(!names||v!==this._version||!this._map)return;
    this._names=names;
    // Keine 3857-Anfragen senden, wenn der amtliche Dienst nur 25833
    // und/oder 4326 anbietet (haeufig bei Berliner Luftbildern).
    const codes=supportedCrsFor(info,names);
    const permitted=code=>!codes.length||codes.includes(code);
    const crs=[
     ["EPSG:25833",berlinUTM33(L)],
     ["EPSG:4326",L.CRS.EPSG4326],
     ["EPSG:3857",L.CRS.EPSG3857]
    ].filter(([code])=>permitted(code)).map(([,crs])=>crs);
    // Bei fehlenden SRS-Daten zunaechst ETRS89 / UTM33 probieren.
    if(!crs.length)crs.push(berlinUTM33(L),L.CRS.EPSG4326);
    const isHistorical=/luftbild_19[0-9]{2}|straubeplan/i.test(url);
    const formats=isHistorical?["image/png","image/jpeg"]:["image/jpeg","image/png"];
    this._variants=[];
    for(const crsOption of crs)for(const format of formats)
     this._variants.push({crs:crsOption,format});
    const tileUrl=mirrorFor(url);
    if(tileUrl)this._variants.push({tileUrl});
    this._stage=0;this._draw(v);
   },
   _draw:function(v){
    if(v!==this._version||!this._map)return;
    const map=this._map,variant=this._variants[this._stage];
    clearTimeout(this._retryTimer);this._retryTimer=null;
    if(!variant){
     if(!this._warned){
      this._warned=true;
      onError?.("Luftbild konnte nicht geladen werden: Der amtliche Bilddienst hat alle unterstuetzten Abrufe abgewiesen.");
     }
     return;
    }
    const old=this._inner;
    if(old&&map.hasLayer(old))map.removeLayer(old);
    this._loaded=false;
    const inner=variant.tileUrl
     ?L.tileLayer(variant.tileUrl,{
       tms:true,tileSize:256,minZoom:2,maxZoom:19,keepBuffer:0,noWrap:true,
       updateWhenIdle:true,updateWhenZooming:false,opacity:this._opacity,
       attribution:"Geoportal Berlin / Land Berlin · Code for Germany"
      })
     :L.tileLayer.wms(url,{
       layers:this._names,styles:"",format:variant.format,
       transparent:variant.format==="image/png",
       crs:variant.crs,version:"1.1.1",tileSize:256,minZoom:2,maxZoom:19,
       keepBuffer:0,noWrap:true,updateWhenIdle:true,
       updateWhenZooming:false,opacity:this._opacity
      });
    this._inner=inner;
    inner.on("tileload",()=>{
     if(this._inner!==inner||v!==this._version)return;
     this._loaded=true;clearTimeout(this._retryTimer);this._retryTimer=null;
    });
    inner.on("tileerror",()=>{
     if(this._inner!==inner||v!==this._version||this._loaded)return;
     if(!this._retryTimer){
      this._retryTimer=setTimeout(()=>{
       this._retryTimer=null;
       if(this._inner===inner&&v===this._version&&!this._loaded){
        this._stage++;this._draw(v);
       }
      },500);
     }
    });
    inner.addTo(map);
   },
   onRemove:function(map){
    this._version++;clearTimeout(this._retryTimer);this._retryTimer=null;
    if(this._inner&&map.hasLayer(this._inner))map.removeLayer(this._inner);
    this._inner=null;this._map=null;
   },
   setOpacity:function(value){
    this._opacity=Math.max(0,Math.min(1,Number(value)));
    this._inner?.setOpacity(this._opacity);return this;
   },
   getOpacity:function(){return this._opacity;}
  });
  return new PhotoWMS();
 }
 const NativeWMS=L.Layer.extend({
  initialize:function(){this._map=null;this._inner=null;this._version=0;this._opacity=1;this._warned=false;},
  onAdd:function(map){
   this._map=map;const version=++this._version;
   capabilities(url).then(info=>{
    if(version!==this._version||this._map!==map)return;
    const names=selectedWmsLayers(url,info,options.layerName).map(l=>l.name);
    const inner=L.tileLayer.wms(url,{layers:names.join(","),format:"image/png",
     transparent:true,version:"1.1.1",minZoom:2,maxZoom:19,
     updateWhenIdle:true,updateWhenZooming:false,keepBuffer:2,noWrap:true,
     opacity:this._opacity});
    inner.on("tileerror",()=>{
     if(!this._warned&&version===this._version){this._warned=true;onError?.("Einige Kartenbilder konnten vom Dienst nicht abgerufen werden.");}
    });
    if(version!==this._version||this._map!==map)return;
    this._inner=inner;inner.addTo(map);
   }).catch(e=>{if(version===this._version&&this._map)onError?.("Geoportal Berlin: "+e.message);});
  },
  onRemove:function(map){this._version++;if(this._inner&&map.hasLayer(this._inner))map.removeLayer(this._inner);this._inner=null;this._map=null;},
  setOpacity:function(v){this._opacity=Math.max(0,Math.min(1,Number(v)));this._inner?.setOpacity(this._opacity);return this;},
  getOpacity:function(){return this._opacity;}
 });
 return new NativeWMS();
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
function mount({parent,maps,preview}){
 if(!parent||!preview)return;
 const style=document.createElement("style");
 style.textContent=".gdi-catalog{margin:9px 0;border:1px solid #d5e4d9;border-radius:12px;background:#fff;overflow:hidden}.gdi-catalog>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:14px 15px;background:#f3f8f4;color:#264b3a;font-size:14px;font-weight:800;border-radius:11px}.gdi-catalog>summary::-webkit-details-marker{display:none}.gdi-catalog>summary:after{content:'⌄';font-size:20px;color:#527262;margin-left:10px;transition:transform .2s}.gdi-catalog[open]>summary:after{transform:rotate(180deg)}.gdi-catalog[open]>summary{border-bottom:1px solid #dfe9e1;border-radius:11px 11px 0 0}.gdi-catalog .gdi-provider-content{padding:12px}.gdi-catalog:focus-within{outline-color:#b6d2bc}";
 document.head.appendChild(style);
 const wrap=document.createElement("details");wrap.className="gdi-catalog";wrap.id="managerGeoportalProvider";
 const summary=document.createElement("summary");summary.textContent="Geoportal Berlin";
 const content=document.createElement("div");content.className="gdi-provider-content";
 wrap.append(summary,content);parent.prepend(wrap);
 if(window.AtlasGeoSearch)window.AtlasGeoSearch.mount({parent:content,maps,preview,capabilities,services:SERVICES});
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