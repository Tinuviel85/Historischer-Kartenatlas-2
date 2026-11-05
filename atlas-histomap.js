/* HistoMap Berlin live WMS catalogue integration. */
(function(){
"use strict";
const SERVICE="https://histomapberlin.de:8443/geoserver/histomap/wms", HOME="https://histomapberlin.de/";
function elm(tag,text,cl){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cl)n.className=cl;return n;}
function direct(n,key){return [...(n.children||[])].find(x=>x.localName===key);}
function value(n,key){return direct(n,key)?.textContent?.trim()||"";}
function bbox(layer){
 for(let n=layer;n&&n.nodeType===1;n=n.parentElement){
  let b=direct(n,"LatLonBoundingBox");
  if(b){let v=["minx","miny","maxx","maxy"].map(k=>Number(b.getAttribute(k)));if(v.every(Number.isFinite)&&v[0]<v[2]&&v[1]<v[3])return v;}
  b=direct(n,"EX_GeographicBoundingBox");
  if(b){let v=["westBoundLongitude","southBoundLatitude","eastBoundLongitude","northBoundLatitude"].map(k=>Number(value(b,k)));if(v.every(Number.isFinite)&&v[0]<v[2]&&v[1]<v[3])return v;}
 }
 return null;
}
function catalog(raw){
 if(raw.length>14000000)throw Error("Kartenkatalog zu groß");
 const doc=new DOMParser().parseFromString(raw,"application/xml");
 if(doc.getElementsByTagName("parsererror").length)throw Error("Ungültige XML-Kartenliste");
 const l=[...doc.getElementsByTagNameNS("*","Layer")],out=[];
 for(const x of l){
  if(direct(x,"Layer"))continue;
  const name=value(x,"Name"),title=value(x,"Title")||name;
  if(!name)continue;
  const years=(name+" "+title).match(/(?:18[6-9]\d|19\d{2}|20[0-2]\d)/g);
  if(years)out.push({name,title,year:Number(years[years.length-1]),bbox:bbox(x)});
 }
 if(!out.length)throw Error("Keine datierten WMS-Ebenen gefunden");
 const srs=[...doc.getElementsByTagNameNS("*","SRS"),...doc.getElementsByTagNameNS("*","CRS")];
 const compatible=srs.some(x=>/(?:^|\s)EPSG:3857(?:\s|$)/i.test(x.textContent||""));
 return {out,compatible};
}
function mount({parent,map,maps,add}){
 if(!parent||!map||!add)return;
 const styles=elm("style");
 styles.textContent=".histo-box{margin:0 0 14px;border:1px solid #c5d9c9;border-radius:12px;background:#f3f8f2;padding:13px}.histo-box summary{font-size:13px;font-weight:800;color:#225040;cursor:pointer}.histo-box p{font-size:12px;line-height:1.45;color:#607367}.histo-box select,.histo-box button{box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #bed3c3;border-radius:9px;background:white;color:#254b3c;font-size:13px}.histo-box button{font-weight:750}.histo-box button.primary{background:#245040;color:white}.histo-box button:disabled{opacity:.5}.histo-box input[type=file]{font-size:12px;max-width:100%;margin:9px 0}.histo-box label{font-size:12px;font-weight:650}";
 document.head.appendChild(styles);
 const box=elm("details",undefined,"histo-box");
 box.innerHTML='<summary>HistoMap Berlin · historische Kartenwerke</summary><p>Über 3.000 historische Berliner Kartenblätter. Jahr wählen und passende Blätter für den aktuellen Ort übernehmen – ohne Karten-URLs.</p><button id="hmLoad" type="button">Kartenbestand laden</button><label for="hmYear">Historischer Jahrgang</label><select id="hmYear" disabled><option>Bestand noch nicht geladen</option></select><button id="hmAdd" class="primary" type="button" disabled>Jahrgang am aktuellen Ort hinzufügen</button><p id="hmStatus" role="status">Noch nicht verbunden.</p><p>Quelle: © Landesarchiv Berlin, HistoMap Berlin. <a href="https://histomapberlin.de/" target="_blank" rel="noopener noreferrer">HistoMap direkt öffnen</a></p><label for="hmXml">Alternative: WMS-Katalogdatei (XML) laden</label><input id="hmXml" type="file" accept=".xml,application/xml,text/xml">';
 parent.prepend(box);
 const $=id=>box.querySelector("#"+id);let records=null,chosen=[],isCompatible=false;
 function choices(){
  if(!records)return;
  const year=Number($("hmYear").value),p=map.getCenter();
  const hits=records.filter(r=>r.year===year&&(!r.bbox||(r.bbox[0]<=p.lng&&r.bbox[2]>=p.lng&&r.bbox[1]<=p.lat&&r.bbox[3]>=p.lat)));
  const known=hits.filter(r=>r.bbox);const matches=known.length?known:hits;chosen=[];let size=0;
  for(const r of matches){if(chosen.length>=6||size+r.name.length+1>235)break;chosen.push(r);size+=r.name.length+1;}
  $("hmAdd").disabled=!chosen.length||!isCompatible;
  $("hmStatus").textContent=!isCompatible?"Der WMS meldet keine Unterstützung für EPSG:3857; eine korrekte Überlagerung kann nicht gewährleistet werden.":!chosen.length?"Für "+year+" ist an dieser Kartenposition kein Blatt verzeichnet. Karte verschieben und HistoMap erneut öffnen.":year+": "+matches.length+" mögliche Blätter, davon "+chosen.length+" gemeinsam übernehmbar."+(matches.length>chosen.length?" Für weitere Blätter ist eine weitere Auswahl nötig.":"");
 }
 function loadXml(raw){
  const data=catalog(raw);records=data.out;isCompatible=data.compatible;
  const years=[...new Set(records.map(r=>r.year))].sort((a,b)=>a-b);
  $("hmYear").replaceChildren();for(const year of years){const o=elm("option",year);o.value=String(year);$("hmYear").appendChild(o);}
  $("hmYear").value=String(years.includes(1928)?1928:years[0]);$("hmYear").disabled=false;choices();
 }
 $("hmLoad").addEventListener("click",async()=>{
  const b=$("hmLoad");b.disabled=true;$("hmStatus").textContent="HistoMap-Kartenverzeichnis wird abgefragt …";
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000);
  try{
   const response=await fetch(SERVICE+"?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities",{mode:"cors",signal:controller.signal});
   if(!response.ok)throw Error("HTTP "+response.status);
   loadXml(await response.text());
  }catch(e){$("hmStatus").textContent="Der HistoMap-Dienst lässt sich im Browser nicht auslesen ("+(e.name==="AbortError"?"Zeitüberschreitung":e.message)+"). Die Originalseite kann geöffnet werden. Alternativ kann eine WMS-Katalogdatei verwendet werden.";}
  finally{clearTimeout(timer);b.disabled=false;}
 });
 $("hmYear").addEventListener("change",choices);
 box.addEventListener("toggle",()=>{if(box.open&&records)choices();});
 $("hmXml").addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>14000000)throw Error("Datei zu groß");loadXml(await file.text());}catch(err){$("hmStatus").textContent=err.message;}e.target.value="";});
 $("hmAdd").addEventListener("click",()=>{
  if(!chosen.length||!isCompatible)return;
  const year=Number($("hmYear").value),layerName=chosen.map(x=>x.name).join(",");
  if(maps.some(m=>m&&!m.hidden&&m.type==="wms"&&m.sourceUrl===SERVICE&&m.layerName===layerName)){$("hmStatus").textContent="Diese Blätter sind bereits in der Bibliothek.";return;}
  try{add({name:"HistoMap Berlin "+year+" · Kartenausschnitt",year,region:"Berlin",sourceUrl:SERVICE,type:"wms",layerName,provider:"Landesarchiv Berlin / HistoMap Berlin",detailUrl:HOME},null);$("hmStatus").textContent="Karte übernommen und gespeichert."; }
  catch(e){$("hmStatus").textContent="Übernahme fehlgeschlagen: "+e.message;}
 });
}
window.AtlasHistoMap={mount};
})();