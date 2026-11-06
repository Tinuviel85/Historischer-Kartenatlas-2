/* Geoportal Berlin: verified public Berlin WMS catalogue and overlay integration.
   Provider URLs are maintained by Berlin GDI, never the retired FIS-Broker. */
(function(){
"use strict";
const ROOT="https://gdi.berlin.de/services/wms/";
const SERVICES=[
 {id:"aerial1928",year:1928,title:"Luftbilder Berlin 1928",group:"Historische Luftbilder",slug:"luftbild_1928_04",note:"Senkrechtaufnahmen 1:4.000; historische Abdeckung nicht überall vollständig"},
 {id:"aerial1938",year:1938,title:"Luftbilder Berlin 1938",group:"Historische Luftbilder",slug:"luftbild_1938_04",note:"Senkrechtaufnahmen 1:4.000; stellenweise Lücken"},
 {id:"aerial1953",year:1953,title:"Luftbilder Berlin 1953",group:"Historische Luftbilder",slug:"luftbild_1953_22",note:"Luftbilder 1:22.000, mit Überlappungen"},
 {id:"aerial1964",year:1964,title:"Luftbilder Berlin 1964",group:"Historische Luftbilder",slug:"luftbild_1964_04",note:"Nur ausgewählte Berliner Teilgebiete"},
 {id:"aerial1989",year:1989,title:"Luftbilder West-Berlin 1989",group:"Historische Luftbilder",slug:"luftbild_1989_04",note:"Teilgebiete West-Berlins; keine vollständige Abdeckung"},
 {id:"aerial2025",year:2025,title:"Digitale Orthophotos Berlin 2025",group:"Aktuelle Luftbilder",slug:"dop_2025_fruehjahr",note:"Aktuelle Luftbilder mit hoher Auflösung"},
 {id:"straube",year:1910,title:"Straubes Übersichtsplan 1910",group:"Historische Karten",slug:"straubeplan",note:"Historische Mitte, 44 Blätter; kein Gesamt-Berlin"},
 {id:"trees",year:null,title:"Baumbestand Berlin",group:"Natur und Umwelt",slug:"baumbestand",note:"Heutige Straßen- und Anlagenbäume (soweit mit Koordinaten); separate Ebene",overlay:true}
];
const BY_ID=new Map(SERVICES.map(s=>[s.id,s]));
const cache=new Map();
const pending=new Map();
function urlFor(id){const entry=BY_ID.get(id);return entry?ROOT+entry.slug:null;}
function allowedUrl(url){return SERVICES.some(s=>url===ROOT+s.slug);}
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
 if(xml.getElementsByTagName("parsererror").length)throw Error("Der Dienst liefert keine gültige Kartenliste.");
 const layers=Array.from(xml.getElementsByTagNameNS("*","Layer"));
 if(!layers.length)throw Error("Der Dienst nennt keine WMS-Kartenebenen.");
 const crs=Array.from(xml.getElementsByTagNameNS("*","SRS")).concat(Array.from(xml.getElementsByTagNameNS("*","CRS")));
 if(!crs.some(e=>/(^|\s)EPSG:3857(\s|$)/i.test(e.textContent||"")))
  throw Error("Der Dienst bestätigt keine Darstellung in Web-Mercator (EPSG:3857).");
 const named=layers.map(l=>({name:directText(l,"Name"),title:directText(l,"Title"),group:directChildren(l,"Layer").length>0,box:geoBox(l)}))
   .filter(l=>l.name);
 if(!named.length)throw Error("Keine benannte Kartenebene gefunden.");
 const group=named.find(l=>l.group&&l.name.length<200);
 const leaves=named.filter(l=>!l.group);
 if(!group&&!leaves.length)throw Error("Kein darstellbares Kartenwerk gefunden.");
 return {group:group?.name||null,leaves:leaves.length?leaves:named};
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
 const overlay=!!options.overlay, minZoom=overlay?12:2;
 let notified=false;
 function warn(message){if(!notified){notified=true;onError?.(message);}}
 const source=L.GridLayer.extend({
  createTile:function(coords,done){
   const tile=document.createElement("div"),size=this.getTileSize();
   tile.style.cssText="width:"+size.x+"px;height:"+size.y+"px;position:relative;overflow:hidden";
   if(coords.z<minZoom){done(null,tile);return tile;}
   const info=cache.get(url);
   if(!info){
    capabilities(url).then(()=>{if(this._map)this.redraw();})
     .catch(e=>warn("Geoportal Berlin konnte die Kartendaten nicht laden: "+e.message));
    done(null,tile);return tile;
   }
   const bounds=this._tileCoordsToBounds(coords),area=[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()];
   const intersects=box=>!box||(box[0]<=area[2]&&box[2]>=area[0]&&box[1]<=area[3]&&box[3]>=area[1]);
   const names=info.group?[info.group]:info.leaves.filter(x=>intersects(x.box)).map(x=>x.name).slice(0,180);
   if(!names.length){done(null,tile);return tile;}
   // WMS GetMap is tried in small batches, then retried per sheet on failure.
   const getImage=(parts,index)=>new Promise(resolve=>{
    const img=document.createElement("img");img.alt="";img.draggable=false;
    img.style.cssText="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:"+index;
    let settled=false;
    const timeout=setTimeout(()=>finish(false),14000);
    function finish(ok){
      if(settled)return;settled=true;clearTimeout(timeout);img.onload=null;img.onerror=null;
      if(!ok){img.remove();img.src="";}resolve(ok);
    }
    img.onload=()=>finish(true);img.onerror=()=>finish(false);tile.appendChild(img);
    const q=wmsImage(parts,bounds,L,size);img.src=url+"?"+q.toString();
   });
   async function draw(parts,index){
    if(await getImage(parts,index))return true;
    if(parts.length===1)return false;
    const half=Math.ceil(parts.length/2);
    const both=await Promise.all([draw(parts.slice(0,half),index),draw(parts.slice(half),index+half)]);
    return both.some(Boolean);
   }
   const jobs=[];
   for(let i=0;i<names.length;i+=5)jobs.push(draw(names.slice(i,i+5),i));
   Promise.all(jobs).then(results=>{
    if(!results.some(Boolean))warn("Geoportal Berlin liefert für diesen Ausschnitt keine Kartenbilder.");
    done(null,tile);
   }).catch(()=>{warn("Beim Abrufen der Berliner Karten ist ein Fehler aufgetreten.");done(null,tile);});
   return tile;
  }
 });
 return new source({tileSize:256,minZoom,maxZoom:19,keepBuffer:0,
  updateWhenIdle:true,updateWhenZooming:false,noWrap:true});
}
function mount({parent,maps,add,overlayState=[],updateOverlay}){
 if(!parent||!add)return;
 const style=document.createElement("style");
 style.textContent=".gdi-catalog{border:1px solid #c4d8c8;border-radius:13px;background:#f3f8f4;margin-bottom:14px;padding:12px}.gdi-catalog summary{font-size:14px;font-weight:800;color:#214b3c;cursor:pointer}.gdi-catalog p{font-size:12px;color:#617568;line-height:1.5}.gdi-group{font-weight:800;margin:13px 0 7px;color:#355b47;font-size:12px}.gdi-entry{display:flex;gap:9px;align-items:center;justify-content:space-between;border:1px solid #dce8de;border-radius:10px;background:white;margin:7px 0;padding:10px}.gdi-entry strong{display:block;font-size:12px;color:#284434}.gdi-entry small{display:block;font-size:11px;color:#62786b;margin-top:4px}.gdi-entry button{font-size:12px;font-weight:750;padding:9px;border-radius:9px;border:1px solid #bdd0c2;background:#245544;color:white;flex:none}.gdi-entry button:disabled{opacity:.65}.gdi-status{font-size:11px;line-height:1.4;color:#4c6d59;margin:7px 0}.gdi-entry a{font-size:11px;color:#2b684f}.gdi-check{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;white-space:nowrap}";
 document.head.appendChild(style);
 const wrap=document.createElement("details");wrap.className="gdi-catalog";
 wrap.innerHTML='<summary>Geoportal Berlin · Luftbilder, Karten &amp; Bäume</summary><p>Amtliche Berliner Geodaten in wenigen Schritten übernehmen. Luftbilder und Karten werden als eigene Karten gespeichert; der aktuelle Baumbestand ist eine zusätzliche Ebene, die du ein- und ausschalten kannst.</p><div id="gdiItems"></div><p class="gdi-status" id="gdiStatus" role="status"></p><p><a href="https://gdi.berlin.de/" target="_blank" rel="noopener noreferrer">Offizielles Geoportal Berlin öffnen</a> · <a href="https://daten.berlin.de/" target="_blank" rel="noopener noreferrer">Daten und Lizenzen</a></p>';
 parent.prepend(wrap);
 const listing=wrap.querySelector("#gdiItems"),status=wrap.querySelector("#gdiStatus");
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
  function overlayActive(){return overlayState.some(o=>o&&o.id===entry.id);}
  function refreshButton(){
   button.textContent=entry.overlay?(overlayActive()?"Ausblenden":"Einblenden"):(alreadyMap()?"Vorhanden":"+ Hinzufügen");
   button.disabled=!entry.overlay&&alreadyMap();
  }
  refreshButton();
  button.addEventListener("click",async()=>{
   button.disabled=true;button.textContent="Verbinde …";status.textContent="Prüfe Kartendienst "+entry.title+" …";
   try{
    if(entry.overlay&&overlayActive()){
      updateOverlay(entry,false);status.textContent="Baumbestand ausgeblendet.";
    }else{
      await capabilities(urlFor(entry.id));
      if(entry.overlay){
        updateOverlay({...entry,sourceUrl:urlFor(entry.id)},true);
        status.textContent="Baumbestand als separate Ebene eingeschaltet. Die Anzeige beginnt beim Hineinzoomen.";
      }else{
        add({name:entry.title,year:entry.year,region:"Berlin",sourceUrl:urlFor(entry.id),
          type:"geoportal",layerName:"auto",detailUrl:"https://gdi.berlin.de/view/"+entry.slug,
          provider:"Geoportal Berlin / Land Berlin"},null);
        status.textContent="Amtliche Karte wurde deiner Bibliothek hinzugefügt.";
        wrap.closest("dialog")?.close();
        document.getElementById("sidebar")?.classList.remove("open");
      }
    }
   }catch(e){
    status.textContent="Die Karte konnte nicht automatisch übernommen werden ("+
      (e.name==="AbortError"?"Zeitüberschreitung":e.message)+"). Über „Originalquelle“ kannst du sie im Geoportal ansehen.";
   }finally{refreshButton();}
  });
  row.append(detail,button);listing.appendChild(row);
 }
}
window.AtlasGeoportal={mount,createLayer,capabilities,allowedUrl,services:SERVICES};
})();