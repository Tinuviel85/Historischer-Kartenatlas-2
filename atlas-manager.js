/* Historischer Kartenatlas 2 – Karten- und Regionenverwaltung.
   Diese Version speichert Änderungen lokal im Browser. Keine Anmeldung/Synchronisation. */
(function () {
  "use strict";
  var KEY = window.AtlasManagerStoreKey || "historischer-atlas-v2-library";
  function el(id) { return document.getElementById(id); }
  function safeHttp(value) {
    try { var original = String(value || "").trim(); var u = new URL(original); return (u.protocol === "https:" || u.protocol === "http:") ? original : ""; }
    catch (_) { return ""; }
  }
  function loadStore() {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (_) { return {}; }
  }
  function node(tag, css, txt) {
    var n = document.createElement(tag);
    if (css) n.className = css;
    if (txt !== undefined) n.textContent = String(txt);
    return n;
  }
  function validCoords(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }
  function mount(api) {
    // Resolve the browser storage namespace only AFTER AtlasCloud.init() has
    // loaded the current authenticated user and their private Cloud library.
    // At script evaluation time the account is not known yet.
    KEY = window.AtlasManagerStoreKey || "historischer-atlas-v2-library";
    var maps = api.maps, defs = api.regionDefinitions, regions = api.definedRegions;
    var defaultCount = maps.length;
    var defaults = maps.map(function (m) { return Object.assign({}, m); });
    var saved = loadStore();
    var storedRegions = Array.isArray(saved.regions) ? saved.regions : [];
    var baseRegionNames = new Set(regions);
    var deletedRegions = Array.isArray(saved.deletedRegions)
      ? [...new Set(saved.deletedRegions.filter(function (n) {return typeof n === "string" && n !== "Berlin" && n !== "Unbekannt";}))]
      : [];
    // Built-in regions removed by the user must remain removed after reloading.
    deletedRegions.forEach(function (name) {
      var ix = regions.indexOf(name);
      if (ix !== -1) regions.splice(ix, 1);
      delete defs[name];
    });
    var custom = Array.isArray(saved.custom) ? saved.custom : [];
    var overrides = saved.overrides && typeof saved.overrides === "object" ? saved.overrides : {};
    var hidden = new Set(Array.isArray(saved.hidden) ? saved.hidden.filter(Number.isInteger) : []);

    function registerRegion(name, lat, lon, zoom) {
      name = String(name || "").trim().slice(0, 100);
      lat = Number(lat); lon = Number(lon); zoom = Number(zoom);
      if (!name || !validCoords(lat, lon)) throw new Error("Bitte gültigen Regionsnamen und Koordinaten eingeben.");
      if (!Number.isFinite(zoom) || zoom < 2 || zoom > 19) zoom = 12;
      defs[name] = {center: [lat, lon], zoom: zoom};
      if (!regions.includes(name)) regions.splice(Math.max(1, regions.indexOf("Favoriten")), 0, name);
      return name;
    }
    storedRegions.forEach(function (r) {
      try { if (r && r.name) registerRegion(r.name, r.lat, r.lon, r.zoom); } catch (_) {}
    });
    Object.keys(overrides).forEach(function (key) {
      var id = Number(key), edit = overrides[key];
      if (!Number.isInteger(id) || id < 0 || id >= defaultCount || !edit || typeof edit !== "object") return;
      if (!safeHttp(edit.sourceUrl)) return;
      Object.assign(maps[id], sanitizeMap(edit));
    });
    custom.forEach(function (c) {
      if (!c || typeof c !== "object") { maps.push({id: maps.length,hidden:true}); return; }
      var item = sanitizeMap(c);
      // Older HistoMap entries were incorrectly stored as individual
      // sheets such as 4044_1992. Treat them as their complete map work
      // without changing the saved map ID (favorites and links survive).
      if (item.type === "histomap" && Number.isInteger(item.year) &&
          item.layerName.startsWith(String(item.year)+"|sheet:") &&
          window.AtlasHistoMap && typeof window.AtlasHistoMap.identifyWork === "function") {
        var oldSheetName=item.layerName.slice((String(item.year)+"|sheet:").length);
        if(window.AtlasHistoMap.identifyWork(oldSheetName,oldSheetName).key === "berliner-blattkarten") {
          item.layerName=String(item.year)+"|berliner-blattkarten";
          item.name="HistoMap Berlin "+item.year+" · Historische Berliner Blattkarten";
          item.displayName=item.name;
        }
      }
      item.id = maps.length; item.custom = true;
      if (!item.sourceUrl || !item.name) item.hidden = true;
      maps.push(item);
    });
    maps.forEach(function (m, index) { m.id = index; m.hidden = !!m.hidden || hidden.has(index); });
    // Keine automatisch installierten Karten. Auch der Baumbestand wird
    // ausschliesslich ueber die Fachkartensuche auf Wunsch hinzugefuegt.

    // Bounding boxes: geographische Koordinaten in der Form
    // [[sued,west],[nord,ost]]; MapWarper liefert lon,lat,lon,lat.
    function normalizeMapBounds(raw){
      var p=null;
      if(Array.isArray(raw)&&raw.length===2&&Array.isArray(raw[0])&&Array.isArray(raw[1]))
        p=[Number(raw[0][0]),Number(raw[0][1]),Number(raw[1][0]),Number(raw[1][1])];
      else if(typeof raw==="string"){
        var a=raw.split(",").map(Number);
        if(a.length===4)p=[a[1],a[0],a[3],a[2]];
      }
      if(!p||!p.every(Number.isFinite))return null;
      var [south,west,north,east]=p;
      if(south>=north||west>=east||south< -90||north>90||west< -180||east>180)return null;
      return [[south,west],[north,east]];
    }
    function sanitizeMap(v) {
      var type = v.type === "georef" ? "georef" : v.type === "geoportal" ? "geoportal" : v.type === "histomap" ? "histomap" : v.type === "wms" ? "wms" : v.type === "wmts" ? "wmts" : v.type === "tms" ? "tms" : "xyz";
      var name = String(v.name || "").trim().slice(0, 220);
      var url = type==="georef"&&/^atlas-georef:[a-z0-9-]{10,70}$/i.test(String(v.sourceUrl||""))
        ?String(v.sourceUrl):safeHttp(v.sourceUrl);
      return {
        name: name, displayName: name, year: Number.isInteger(Number(v.year)) && Number(v.year) >= 1 && Number(v.year) <= 2100 ? Number(v.year) : null,
        region: String(v.region || "Berlin").trim().slice(0, 100),
        sourceUrl: url,
        detailUrl: safeHttp(v.detailUrl) || url,
        provider: String(v.provider || "Eigene Karte").slice(0, 140),
        type: type, layerName: String(v.layerName || "").trim().slice(0, 250),
        bounds: normalizeMapBounds(v.bounds||v.bbox),
        previewBounds: normalizeMapBounds(v.previewBounds)
      };
    }
    function persist() {
      var obj = {
        version: 2,
        regions: storedRegions,
        deletedRegions: deletedRegions,
        geoportalOverlays: [], // Legacy overlay mode intentionally disabled.
        custom: maps.slice(defaultCount).map(function (m) {
          return {name:m.name,region:m.region,year:m.year,sourceUrl:m.sourceUrl,detailUrl:m.detailUrl,provider:m.provider,type:m.type,layerName:m.layerName,bounds:m.bounds||null,previewBounds:m.previewBounds||null};
        }),
        overrides: overrides,
        hidden: maps.filter(function (m) {return m.hidden;}).map(function (m) {return m.id;})
      };
      try { obj.favorites=JSON.parse(localStorage.getItem("historischer-atlas-favoriten")||"[]"); localStorage.setItem(KEY, JSON.stringify(obj)); if(window.AtlasCloud?.isAuthenticated())void window.AtlasCloud.saveLibrary(obj); return true; }
      catch (_) { api.setNotice("Speichern nicht möglich. Bitte Browserspeicher prüfen."); return false; }
    }
    function redraw() { api.renderRegions(); api.renderList(); api.updateTimeline(); }
    var css = node("style");
    css.textContent = ".manager-launch{width:100%;margin:10px 0 0;border:1px solid #b6cfbe;background:#eaf3ec;color:#214c3f;border-radius:10px;padding:10px;font-weight:750;font-size:12px;text-align:center}.manager-launch:hover{background:#dcecdf}.manager-edit{background:#f4f8f3;border:1px solid #dce6dd;color:#466b55;border-radius:8px;padding:5px 7px;font-size:13px}.manager-edit:hover{background:#dfebdd}.manager-modal{border:1px solid #dbe5db;border-radius:17px;padding:0;width:min(640px,calc(100% - 18px));max-height:90dvh;box-shadow:0 20px 90px #132d2b55;color:#284438;background:white}.manager-modal::backdrop{background:#11291f91}.manager-inner{padding:22px;max-height:87dvh;overflow:auto}.manager-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px}.manager-head h2{font:700 22px Georgia,serif;margin:0}.manager-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 15px}.manager-tab{border:1px solid #d9e3d9;background:#f8faf6;border-radius:9px;padding:9px 12px;font-size:12px;font-weight:700;color:#375b4c}.manager-tab[aria-selected=true]{background:#245044;color:white}.manager-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.manager-fields label,.manager-label{display:block;font-size:12px;font-weight:700;color:#435a4b}.manager-fields input,.manager-fields select,.manager-search{width:100%;margin-top:5px;padding:11px 10px;border:1px solid #d1ddce;border-radius:9px;background:white;color:#20382c;font-size:14px}.manager-wide{grid-column:1/-1}.manager-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:15px}.manager-action{padding:10px 13px;border:1px solid #b8ccbf;background:#fff;color:#26483c;border-radius:9px;font-size:13px;font-weight:700}.manager-primary{background:#214d3e;color:white;border-color:#214d3e}.manager-danger{color:#933e34;border-color:#ecd0cd}.manager-muted{font-size:12px;color:#6a7c70;line-height:1.5}.manager-results{display:grid;gap:9px;margin-top:12px;max-height:38dvh;overflow:auto}.manager-result{padding:12px;border:1px solid #d9e3d9;border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:12px}.manager-result strong{display:block;font-size:13px;overflow-wrap:anywhere}.manager-result small{display:block;color:#718075;margin-top:4px}.manager-region-row{flex-wrap:wrap}.manager-region-actions{display:flex;gap:7px;flex-wrap:wrap}.manager-region-confirm{width:100%;margin-top:7px;padding:11px;border:1px solid #eededb;border-radius:11px;background:#fffaf8}.manager-region-confirm p{margin:0 0 9px}.manager-region-target{display:block;width:100%;margin-top:7px;padding:10px;border:1px solid #d1ddce;border-radius:9px;background:white;font-size:14px}.manager-status{margin:9px 0;color:#4c6657;font-size:12px}.manager-hidden{display:none!important}@media(max-width:500px){.manager-fields{grid-template-columns:1fr}.manager-inner{padding:14px}.manager-head h2{font-size:19px}}";
    css.textContent += ".manager-provider{margin:9px 0;border:1px solid #d5e4d9;border-radius:12px;background:#fff;overflow:visible}.manager-provider>summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:14px 15px;background:#f3f8f4;color:#264b3a;font-weight:800;font-size:14px;border-radius:11px}.manager-provider>summary::-webkit-details-marker{display:none}.manager-provider>summary:after{content:'⌄';font-size:20px;color:#527262;margin-left:10px;transform:rotate(0deg);transition:transform .2s}.manager-provider[open]>summary:after{transform:rotate(180deg)}.manager-provider[open]>summary{border-bottom:1px solid #dfe9e1;border-radius:11px 11px 0 0}.manager-provider>form,.manager-provider>section,.manager-provider>p,.manager-provider>.gdi-catalog{margin:12px!important}.manager-provider .manager-fields{padding:3px}.manager-provider #managerMap{margin:13px}.manager-provider>.gdi-catalog{border:0;padding:0;background:none}";
    css.textContent += ".manager-editor-dialog{width:min(570px,calc(100% - 22px))}.manager-editor-dialog #managerMap{margin:0}.manager-editor-dialog .manager-editor-content{padding:2px 0}.manager-editor-dialog .manager-head{margin-bottom:17px}.manager-editor-dialog .manager-editor-subtitle{font-size:12px;color:#60796b;margin:-3px 0 13px;overflow-wrap:anywhere}.manager-editor-dialog #managerEditorClose{flex:none;min-width:44px;min-height:44px;border-radius:12px;background:#edf5ef;color:#264c3c;font-size:23px;display:grid;place-items:center}";
    css.textContent += ".manager-modal .manager-inner{position:relative;isolation:isolate}.manager-modal .manager-head{position:sticky;top:0;z-index:60;background:rgba(255,255,255,.98);padding:14px 2px;margin:0 0 12px;border-bottom:1px solid #e2ebe3;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}.manager-modal #managerClose{flex:none;display:grid;place-items:center;min-width:44px;min-height:44px;border-radius:12px;background:#edf5ef;color:#264c3c;font-size:23px;padding:6px}.manager-modal #managerClose:focus-visible{outline:3px solid #2c7153}.manager-modal .manager-tabs{position:static;background:rgba(255,255,255,.97);padding:4px 0 10px;border-bottom:1px solid #e5ece5}@media(max-width:500px){.manager-modal .manager-head{top:0;padding:13px 0;margin:0 0 9px}}";
    document.head.appendChild(css);
    var launcher = node("button", "manager-launch", "+ Karten entdecken und verwalten");
    launcher.type = "button";
    el("regions").after(launcher);
    var dialog = node("dialog", "manager-modal");
    dialog.id = "managerDialog";
    dialog.innerHTML = '<div class="manager-inner"><div class="manager-head"><h2>Kartenbibliothek verwalten</h2><button id="managerClose" class="manager-action" type="button" aria-label="Schließen">✕</button></div><div class="manager-tabs"><button id="managerDiscoverTab" class="manager-tab" type="button">Karten entdecken</button><button id="managerRegionTab" class="manager-tab" type="button">Regionen</button><button id="managerBackupTab" class="manager-tab" type="button">Sicherung</button></div><section id="managerDiscover"><form id="managerDiscoverForm"><label class="manager-label" for="managerDiscoverQuery">Historische Karten nach Ort oder Begriff suchen</label><div style="display:flex;gap:7px"><input id="managerDiscoverQuery" class="manager-search" required minlength="2" maxlength="90" value="Berlin" placeholder="Berlin, Wien, Rom …"><button class="manager-action manager-primary" type="submit">Suchen</button></div></form><p class="manager-muted">MapWarper selbst ist kostenlos. Die Bildrechte einzelner Karten müssen vor öffentlicher Nutzung geprüft werden. Direkt übernehmbare Karten mit dokumentierter kostenloser Lizenz findest du unter „Kostenlose georeferenzierte Karten“.</p><div id="managerSearchStatus" class="manager-status" role="status"></div><div id="managerResults" class="manager-results"></div><p class="manager-muted"><a href="https://mapwarper.net/" target="_blank" rel="noopener noreferrer">MapWarper öffnen ↗</a> · Weitere Geoportale werden später angebunden.</p></section><section id="managerMap" class="manager-hidden"><form id="managerMapForm" class="manager-fields"><label class="manager-wide">Kartenname<input id="mgrName" required maxlength="220" placeholder="z. B. Berlin 1910"></label><label>Jahr (optional)<input id="mgrYear" type="number" min="1" max="2100" placeholder="1910"></label><label>Region<select id="mgrRegion"></select></label><label>Kartentyp<select id="mgrType"><option value="xyz">XYZ (Kachelvorlage)</option><option value="tms">TMS (Kachelvorlage)</option><option value="wms">WMS (Kartenserver)</option><option value="wmts">WMTS (REST-Kachelvorlage)</option><option value="geoportal" disabled>Geoportal Berlin (über „Karten entdecken“)</option><option value="histomap" disabled>HistoMap-Altbestand (Detailrecherche empfohlen)</option></select></label><label>Kartenanbieter<input id="mgrProvider" placeholder="z. B. MapWarper"></label><label class="manager-wide">Kachel-URL oder WMS-Endpunkt<input id="mgrUrl" type="text" required spellcheck="false" placeholder="https://…/{z}/{x}/{y}.png"></label><label class="manager-wide" id="mgrLayerWrap">WMS-Layername<input id="mgrLayer" placeholder="Technischer Name der Kartenebene"></label><label class="manager-wide">Link zur Originalquelle (optional)<input id="mgrDetails" spellcheck="false" placeholder="https://…"></label><div class="manager-actions manager-wide"><button class="manager-action manager-primary" type="submit">Karte speichern</button><button id="mgrDelete" class="manager-action manager-danger manager-hidden" type="button">Karte entfernen</button><button id="mgrCancelEdit" class="manager-action" type="button">Abbrechen</button></div></form><p class="manager-muted">XYZ und TMS benötigen {z}, {x} und {y}. Bei WMTS werden auch {TileMatrix}, {TileCol} und {TileRow} automatisch erkannt; die Vorlage muss Web-Mercator (EPSG:3857) verwenden. Für WMS gib die Dienstadresse und den Layernamen aus GetCapabilities ein. Allgemeine WMTS-GetCapabilities-Dienste mit TileMatrixSet müssen vor der Einbindung in eine kompatible Kachelvorlage umgewandelt werden. Mit angemeldetem Konto werden Änderungen mit deiner Cloud-Bibliothek synchronisiert.</p></section><section id="managerRegion" class="manager-hidden"><form id="managerRegionForm" class="manager-fields"><label class="manager-wide">Neue Region / Ort<input id="mgrRegionName" required maxlength="100" placeholder="z. B. Potsdam"></label><label>Breitengrad<input id="mgrLat" type="number" min="-90" max="90" step="any" placeholder="52.4"></label><label>Längengrad<input id="mgrLon" type="number" min="-180" max="180" step="any" placeholder="13.0"></label><label>Karten-Zoom<input id="mgrZoom" type="number" min="2" max="19" value="12"></label><div class="manager-actions manager-wide"><button class="manager-action" type="button" id="mgrLookupRegion">Koordinaten automatisch suchen</button><button class="manager-action manager-primary" type="submit">Region speichern</button></div></form><p id="mgrRegionStatus" class="manager-status" role="status"></p><div id="mgrRegionList" class="manager-results"></div><p class="manager-muted">Regionen können angelegt, bearbeitet und gelöscht werden. Vor dem Löschen werden zugehörige Karten in eine andere Region verschoben. Berlin bleibt als Startregion erhalten. Für die Ortssuche verwenden wir OpenStreetMap / Nominatim.</p></section><section id="managerBackup" class="manager-hidden"><p class="manager-muted">Änderungen werden derzeit nur auf diesem Gerät gespeichert. Exportiere eine Sicherung, bevor du den Browser wechselst oder lokale Daten löschst. Die Datei enthält deine individuellen Karteneinträge, Regionen und ausgeblendeten Karten.</p><div class="manager-actions"><button id="mgrExport" class="manager-action manager-primary">Sicherung herunterladen</button><button id="mgrRestore" class="manager-action">Entfernte Karten wiederherstellen</button><label class="manager-action" for="mgrImport" style="cursor:pointer">Sicherung importieren</label><input id="mgrImport" type="file" accept="application/json,.json" hidden></div><p class="manager-muted">Ein Konto und geräteübergreifende Speicherung werden als nächste Ausbaustufe ergänzt.</p></section></div>';
    document.body.appendChild(dialog);
    // Provider architecture: add each future provider as one native details
    // element under managerDiscover without creating more top-level tabs.
    function disclosure(id,label){
      const d=document.createElement("details");
      d.id=id;d.className="manager-provider";
      const summary=document.createElement("summary");summary.textContent=label;
      d.appendChild(summary);
      return d;
    }
    const discover=el("managerDiscover");
    const warperPanel=disclosure("managerMapWarperProvider","MapWarper");
    while(discover.firstChild)warperPanel.appendChild(discover.firstChild);
    discover.appendChild(warperPanel);
    const manualPanel=disclosure("managerManualProvider","Manuell hinzufügen · XYZ / TMS / WMS / WMTS");
    const manualSection=el("managerMap");
    manualSection.classList.remove("manager-hidden");
    manualPanel.appendChild(manualSection);
    discover.appendChild(manualPanel);
    // Der Stift einer bereits gespeicherten Karte oeffnet einen eigenen
    // Dialog. Das existierende Formular wird verschoben statt dupliziert:
    // dadurch bleiben IDs, Eingabevalidierung und Speicherlogik eindeutig.
    const editorDialog=node("dialog","manager-modal manager-editor-dialog");
    editorDialog.id="managerEditorDialog";
    editorDialog.innerHTML='<div class="manager-inner"><div class="manager-head"><h2>Karte bearbeiten</h2><button id="managerEditorClose" class="manager-action" type="button" aria-label="Kartenbearbeitung schließen">✕</button></div><p id="managerEditorSubtitle" class="manager-editor-subtitle"></p><div id="managerEditorContent" class="manager-editor-content"></div></div>';
    document.body.appendChild(editorDialog);
    const editorSlot=el("managerEditorContent");
    function restoreManualForm(){
      if(manualSection.parentElement!==manualPanel)manualPanel.appendChild(manualSection);
    }
    function closeMapEditor(){
      if(editorDialog.open)editorDialog.close();
      else restoreManualForm();
    }
    editorDialog.addEventListener("close",function(){
      restoreManualForm();
      editing=null;
      updateManualSubmit();
    });
    el("managerEditorClose").addEventListener("click",closeMapEditor);
    function open(tab) {
      restoreManualForm();
      const target=tab==="map"?"discover":(tab||"discover");
      switchTab(target);
      if(tab==="map"){manualPanel.open=true;populateRegions();}
      if (!dialog.open) dialog.showModal();
    }
    function switchTab(tab) {
      ["Discover","Region","Backup"].forEach(function (x) {
        var selected = x.toLowerCase() === tab;
        el("manager"+x).classList.toggle("manager-hidden", !selected);
        el("manager"+x+"Tab").setAttribute("aria-selected", String(selected));
      });
      if (tab === "discover") populateRegions();
      if (tab === "region") renderRegionList();
    }
    launcher.addEventListener("click", function () { open("discover"); });
    el("managerClose").addEventListener("click", function () { dialog.close(); });
    ["Discover","Region","Backup"].forEach(function (name) {
      el("manager"+name+"Tab").addEventListener("click", function () {
        open(name.toLowerCase());
      });
    });
    function populateRegions() {
      var select = el("mgrRegion"), old = select.value;
      select.replaceChildren();
      regions.filter(function (r) {return !["Alle","Favoriten","Weitere"].includes(r);}).forEach(function (r) {
        var opt = node("option", "", r); opt.value = r; select.appendChild(opt);
      });
      if (Array.from(select.options).some(function (o) {return o.value === old;})) select.value = old;
    }
    var editing = null;
    function beginNewMap() {
      editing = null;
      updateManualSubmit();
      el("managerMapForm").reset();
      el("mgrDelete").classList.add("manager-hidden");
      el("mgrType").value = "xyz";
      populateRegions();
      el("mgrLayerWrap").classList.add("manager-hidden");
      open("map");
      el("mgrName").focus();
    }
    function editMap(id) {
      var m = maps[id]; if (!m || m.hidden) return;
      if(dialog.open)dialog.close();
      editing = id;
      editorSlot.appendChild(manualSection);
      el("managerEditorSubtitle").textContent=m.name||"Gespeicherte Karte";
      populateRegions();
      updateManualSubmit();
      el("mgrName").value = m.name || "";
      el("mgrYear").value = m.year || "";
      el("mgrRegion").value = m.region;
      el("mgrType").value = m.type || "xyz";
      el("mgrProvider").value = m.provider || "";
      el("mgrUrl").value = m.sourceUrl || "";
      el("mgrLayer").value = m.layerName || "";
      el("mgrDetails").value = m.detailUrl || "";
      el("mgrDelete").classList.remove("manager-hidden");
      toggleLayer();
      if(!editorDialog.open)editorDialog.showModal();
      editorDialog.querySelector(".manager-inner").scrollTop=0;
      el("mgrName").focus({preventScroll:true});
    }
    function toggleLayer() { el("mgrLayerWrap").classList.toggle("manager-hidden", el("mgrType").value !== "wms"); }
    el("mgrType").addEventListener("change", toggleLayer);
    el("mgrCancelEdit").addEventListener("click",function(){if(editing!==null)closeMapEditor();else beginNewMap();});
    function mapExists(item, exceptId) {
      return maps.some(function (m) {return m && !m.hidden && m.id !== exceptId && m.sourceUrl === item.sourceUrl && (m.layerName || "") === (item.layerName || "");});
    }
    function normalizePreview(item){
      var clean=sanitizeMap(item);
      if(clean.type==="wmts"){
        clean.sourceUrl=clean.sourceUrl.replace(/\{TileMatrix\}/gi,"{z}")
          .replace(/\{TileCol\}/gi,"{x}").replace(/\{TileRow\}/gi,"{y}");
      }
      if(!clean.name||!clean.sourceUrl)throw Error("Name und Kartenadresse erforderlich.");
      if(clean.type==="wms"&&!clean.layerName)throw Error("WMS-Layername fehlt.");
      if(!["wms","geoportal","histomap","georef"].includes(clean.type)&&
         !["{z}","{x}","{y}"].every(p=>clean.sourceUrl.includes(p)))
        throw Error("Für diese Kartenart werden {z}, {x} und {y} in der URL benötigt.");
      return clean;
    }
    function previewDiscoveredMap(item){
      var clean=normalizePreview(item);
      api.previewMap(clean);
    }
    async function saveDiscoveredMap(item){
      var clean=normalizePreview(item);
      if(!defs[clean.region]){
        const bounds=normalizeMapBounds(clean.bounds);
        if(bounds){
          const centerLat=(bounds[0][0]+bounds[1][0])/2;
          const centerLon=(bounds[0][1]+bounds[1][1])/2;
          saveRegion(clean.region,centerLat,centerLon,12);
        }else await ensureRegion(clean.region);
      }
      return upsert(clean,null,true);
    }
    function upsert(item, id, keepView=false) {
      item = sanitizeMap(item);
      if(item.type==="wmts"){
        // WMTS REST endpoints typically use the OGC variable names below.
        // Leaflet's tile engine needs the equivalent XYZ placeholders.
        item.sourceUrl=item.sourceUrl
          .replace(/\{TileMatrix\}/gi,"{z}")
          .replace(/\{TileCol\}/gi,"{x}")
          .replace(/\{TileRow\}/gi,"{y}");
      }
      if (!item.name || !item.sourceUrl) throw new Error("Name und gültige HTTP(S)-Adresse sind erforderlich.");
      if (!defs[item.region]) throw new Error("Bitte zuerst eine Region anlegen.");
      if (item.type === "wms" && !item.layerName) throw new Error("Bitte den WMS-Layernamen angeben.");
      if (item.type !== "wms" && item.type !== "histomap" && item.type !== "geoportal" && item.type !== "georef" && !["{z}","{x}","{y}"].every(function (v) {return item.sourceUrl.includes(v);}))
        throw new Error("Eine XYZ-/TMS-URL muss {z}, {x} und {y} enthalten.");
      if (item.type === "histomap") {
        if (!window.AtlasHistoMap || item.sourceUrl !== "https://histomapberlin.de:8443/geoserver/histomap/wms" ||
            !Number.isInteger(item.year)) throw new Error("Ungültiger HistoMap-Jahrgang.");
        // Preserve the selected HistoMap map series (year|work).
        // Older whole-year entries stored only the year and remain valid.
        if (!item.layerName || (item.layerName !== String(item.year) &&
            !item.layerName.startsWith(String(item.year)+"|")))
          throw new Error("Bitte ein gültiges HistoMap-Kartenwerk auswählen.");
      }
      if (item.type === "geoportal") {
        if(!window.AtlasGeoportal?.allowedUrl(item.sourceUrl))
          throw new Error("Dieser Geoportal-Dienst ist nicht im geprüften Berliner Katalog.");
        if(!item.layerName)item.layerName="auto";
      }
      if (mapExists(item, id)) throw new Error("Diese Karte ist bereits in deiner Bibliothek.");
      if (id === null || id === undefined) {
        item.id = maps.length; item.custom = true; maps.push(item);
      } else {
        item.id = id; item.custom = id >= defaultCount;
        Object.assign(maps[id], item);
        if (id < defaultCount) overrides[id] = Object.assign({}, item);
      }
      persist(); redraw(); api.selectMap(item.id,{restoreView:keepView}); return item;
    }
    // Manual entry is also a real map preview; only editing an existing
    // library item saves directly.
    const manualSubmit=el("managerMapForm").querySelector('button[type="submit"]');
    function updateManualSubmit(){if(manualSubmit)manualSubmit.textContent=editing===null?"Auf Karte legen":"Änderungen speichern";}
    updateManualSubmit();
    el("managerMapForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      try {
        const proposed={
          name:el("mgrName").value,year:el("mgrYear").value,region:el("mgrRegion").value,
          type:el("mgrType").value,sourceUrl:el("mgrUrl").value,layerName:el("mgrLayer").value,
          provider:el("mgrProvider").value,detailUrl:el("mgrDetails").value
        };
        if(editing!==null&&maps[editing]?.sourceUrl===proposed.sourceUrl)
          proposed.bounds=maps[editing].bounds||null;
        if(editing===null){
          previewDiscoveredMap(proposed);
        }else{
          upsert(proposed,editing);
          closeMapEditor();api.setNotice("Änderungen gespeichert.");
        }
      } catch (e) { api.setNotice(e.message, 6000); window.alert(e.message); }
    });
    function removeMap(id) {
      var item = maps[id]; if (!item || item.hidden) return;
      if (!window.confirm("„" + item.name + "“ aus deiner Kartenbibliothek entfernen? Die Originalquelle bleibt erhalten.")) return;
      var active = api.getActive();
      item.hidden = true;
      if (active && active.id === id) {
        var next = maps.find(function (m) {return m && !m.hidden;});
        if (next) api.selectMap(next.id);
      }
      persist(); redraw(); closeMapEditor(); dialog.close(); api.setNotice("Karte aus Bibliothek entfernt.");
    }
    el("mgrDelete").addEventListener("click", function () { if (editing !== null) removeMap(editing); });
    async function lookupLocation(q) {
      var u = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=" + encodeURIComponent(q);
      var response = await fetch(u, {headers:{"Accept":"application/json"}});
      if (!response.ok) throw new Error("Ortssuche aktuell nicht erreichbar (HTTP " + response.status + ").");
      var hits = await response.json();
      if (!Array.isArray(hits) || !hits.length) throw new Error("Keine geografischen Koordinaten gefunden.");
      return {lat:Number(hits[0].lat),lon:Number(hits[0].lon)};
    }
    async function ensureRegion(name) {
      if (defs[name]) return name;
      var hit = await lookupLocation(name);
      return saveRegion(name, hit.lat, hit.lon, 12);
    }
    function saveRegion(name, lat, lon, zoom) {
      name = registerRegion(name, lat, lon, zoom);
      deletedRegions = deletedRegions.filter(function (n) {return n !== name;});
      var data = {name:name,lat:Number(lat),lon:Number(lon),zoom:Number(zoom)};
      var idx = storedRegions.findIndex(function (r) {return r.name === name;});
      if (idx >= 0) storedRegions[idx] = data; else storedRegions.push(data);
      persist(); redraw(); populateRegions(); return name;
    }
    el("mgrLookupRegion").addEventListener("click", async function () {
      var q = el("mgrRegionName").value.trim();
      if (!q) {el("mgrRegionStatus").textContent = "Zuerst eine Region eingeben.";return;}
      el("mgrRegionStatus").textContent = "Suche Koordinaten …";
      try {
        var loc = await lookupLocation(q);
        el("mgrLat").value = loc.lat; el("mgrLon").value = loc.lon;
        el("mgrRegionStatus").textContent = "Koordinaten gefunden. Bitte „Region speichern“ auswählen.";
      } catch (e) { el("mgrRegionStatus").textContent = e.message; }
    });
    el("managerRegionForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      try {
        var name = saveRegion(el("mgrRegionName").value, el("mgrLat").value === "" ? NaN : Number(el("mgrLat").value), el("mgrLon").value === "" ? NaN : Number(el("mgrLon").value), Number(el("mgrZoom").value));
        api.setRegionFilter(name); redraw(); renderRegionList();
        el("mgrRegionStatus").textContent = "Region „" + name + "“ gespeichert.";
      } catch (e) {el("mgrRegionStatus").textContent = e.message;}
    });
    function removeRegion(name, target) {
      if (!regions.includes(name) || ["Alle","Berlin","Favoriten","Weitere","Unbekannt"].includes(name)) return;
      if (target === name) throw new Error("Bitte eine andere Zielregion auswählen.");
      var destination = target === "Weitere" ? "Unbekannt" : target;
      if (!defs[destination]) throw new Error("Die Zielregion existiert nicht mehr.");
      var affected = maps.filter(function (m) {return m && m.region === name;});
      affected.forEach(function (m) {
        m.region = destination;
        // Original maps cannot be deleted from their source array. Preserve their new
        // region assignment explicitly as an override in each user's cloud library.
        if (m.id < defaultCount) overrides[m.id] = sanitizeMap(m);
      });
      var ix = regions.indexOf(name);
      regions.splice(ix, 1);
      if (baseRegionNames.has(name) && !deletedRegions.includes(name)) deletedRegions.push(name);
      storedRegions = storedRegions.filter(function (r) {return r && r.name !== name;});
      delete defs[name];
      persist();
      api.setRegionFilter("Alle");
      redraw(); populateRegions(); renderRegionList();
      el("mgrRegionStatus").textContent="Region „"+name+"“ gelöscht."+(affected.length ? " "+affected.length+" Karte(n) wurden der gewählten Region zugeordnet." : "");
      api.setNotice("Region „"+name+"“ entfernt.");
    }
    function renderRegionList() {
      var wrap = el("mgrRegionList"); wrap.replaceChildren();
      regions.filter(function (r) {return !["Alle","Favoriten","Weitere"].includes(r);}).forEach(function (name) {
        var r = defs[name];
        if (!r) return;
        var row = node("div","manager-result manager-region-row"), title = node("div");
        title.append(node("strong","",name),node("small","",r.center[0].toFixed(4)+", "+r.center[1].toFixed(4)+" · Zoom "+r.zoom));
        var actions = node("div","manager-region-actions");
        var edit = node("button","manager-action","Bearbeiten"); edit.type = "button";
        edit.addEventListener("click",function () {
          el("mgrRegionName").value=name;el("mgrLat").value=r.center[0];el("mgrLon").value=r.center[1];el("mgrZoom").value=r.zoom;
          el("mgrRegionStatus").textContent="Region kann mit neuen Koordinaten aktualisiert werden.";
          el("mgrRegionName").focus();
        });
        actions.appendChild(edit);
        if (name !== "Berlin") {
          var del = node("button","manager-action manager-danger","Löschen");
          del.type = "button";
          del.setAttribute("aria-label","Region "+name+" löschen");
          del.addEventListener("click",function () {
            var old = row.querySelector(".manager-region-confirm");
            if (old) {old.remove();return;}
            var affected = maps.filter(function (m) {return m && m.region === name;});
            if (!affected.length) {
              if (window.confirm("Region „"+name+"“ wirklich löschen?")) removeRegion(name,"Weitere");
              return;
            }
            // Explicit reassignment prevents removing users' original or custom maps.
            var panel = node("div","manager-region-confirm");
            panel.appendChild(node("p","manager-muted",
              "Die Region enthält "+affected.length+" Karte(n). Die Karten bleiben erhalten. Bitte wähle, welcher Region sie zugeordnet werden sollen."));
            var label = node("label","manager-label","Karten verschieben nach");
            var select = node("select","manager-region-target");
            var options = regions.filter(function (n) {
              return n !== name && !["Alle","Favoriten","Weitere"].includes(n);
            });
            options.push("Weitere");
            options.forEach(function (n) {
              var opt = node("option","",n); opt.value=n; select.appendChild(opt);
            });
            select.value = ["Spandau","Charlottenburg","Tiergarten","Grunewald"].includes(name) && regions.includes("Berlin") ? "Berlin" : "Weitere";
            label.appendChild(select); panel.appendChild(label);
            var buttons = node("div","manager-actions");
            var confirmDelete = node("button","manager-action manager-danger","Region löschen und Karten verschieben");
            confirmDelete.type = "button";
            confirmDelete.addEventListener("click",function () {
              if (!window.confirm("Region „"+name+"“ löschen und "+affected.length+" Karte(n) nach „"+select.value+"“ verschieben?")) return;
              try {removeRegion(name,select.value);}
              catch(e) {el("mgrRegionStatus").textContent=e.message;}
            });
            var cancel = node("button","manager-action","Abbrechen");
            cancel.type = "button";cancel.addEventListener("click",function () {panel.remove();});
            buttons.append(confirmDelete,cancel);panel.appendChild(buttons);
            row.appendChild(panel);
          });
          actions.appendChild(del);
        }
        row.append(title,actions);wrap.appendChild(row);
      });
    }
    // Allmaps Tile Server converts existing IIIF georeference annotations to XYZ tiles.
    const allmapsForm=document.createElement("form");
    allmapsForm.id="atlasAllmapsImport";
    allmapsForm.style.cssText="border-top:1px solid #dce6dd;padding-top:15px;margin-top:15px";
    allmapsForm.innerHTML='<label class="manager-label" for="atlasAllmapsURL">Allmaps: georeferenzierte IIIF-Karte ansehen</label><input id="atlasAllmapsURL" class="manager-search" type="url" required placeholder="https://annotations.allmaps.org/maps/…"><div class="manager-fields" style="margin-top:8px"><label>Kartenname<input id="atlasAllmapsName" required placeholder="Historische Karte"></label><label>Region<input id="atlasAllmapsRegion" required value="Berlin"></label></div><div class="manager-actions"><button class="manager-action manager-primary" type="submit">Auf Karte legen</button><a class="manager-action" href="https://viewer.allmaps.org/" target="_blank" rel="noopener noreferrer">Allmaps-Karten ansehen ↗</a></div><p class="manager-muted">Füge die URL einer bereits georeferenzierten Allmaps-Annotation ein. Eine bloße IIIF-Bild-URL ohne Georeferenzierung reicht nicht. XYZ-Tiles werden automatisch erzeugt.</p><p class="manager-status" id="atlasAllmapsStatus" role="status"></p>';
    const allmapsPanel=disclosure("managerAllmapsProvider","Allmaps · georeferenzierte IIIF-Karten");
    allmapsPanel.appendChild(allmapsForm);
    discover.insertBefore(allmapsPanel,manualPanel);
    allmapsForm.addEventListener("submit",async function(e){
      e.preventDefault();
      const raw=el("atlasAllmapsURL").value.trim();
      const region=el("atlasAllmapsRegion").value.trim();
      const name=el("atlasAllmapsName").value.trim();
      const status=el("atlasAllmapsStatus");
      const uri=safeHttp(raw);
      if(!uri||!uri.startsWith("https:")){status.textContent="Die Annotations-URL muss mit https:// beginnen.";return;}
      status.textContent="Region ermitteln und Karte hinzufügen …";
      try {
        const tiles="https://allmaps.xyz/{z}/{x}/{y}.png?url="+encodeURIComponent(uri);
        previewDiscoveredMap({name:name,region:region,provider:"Allmaps / IIIF",type:"xyz",sourceUrl:tiles,detailUrl:uri});
        status.textContent="Karte als Vorschau auf der Karte geöffnet – noch nicht gespeichert.";
      }catch(e){status.textContent=e.message;}
    });
    el("managerDiscoverForm").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var query=el("managerDiscoverQuery").value.trim();
      var out=el("managerResults"), status=el("managerSearchStatus");
      if (query.length<2) return;
      out.replaceChildren();
      var count=0, remote=0, listed=new Set();
      function appendSuggestion(item) {
        var url=safeHttp(item.sourceUrl).replace(/^http:/,"https:");
        if (!url || listed.has(url)) return;
        listed.add(url); item.sourceUrl=url;
        var found=maps.some(function(m) {return m&&!m.hidden&&String(m.sourceUrl).replace(/^http:/,"https:")===url;});
        var row=node("div","manager-result"), box=node("div");
        box.append(node("strong","",item.name),node("small","",(item.year?item.year+" · ":"")+item.provider+" · Kartenkacheln"));
        var btn=node("button","manager-action manager-primary",found?"Auf Karte ansehen":"Auf Karte legen");
        btn.disabled=false;btn.type="button";
        btn.addEventListener("click",async function () {
          btn.disabled=true;btn.textContent="Öffne Vorschau …";
          try {
            previewDiscoveredMap(item);
          } catch(e) {api.setNotice(e.message,6500);window.alert(e.message);}
          finally{btn.disabled=false;btn.textContent=found?"Auf Karte ansehen":"Auf Karte legen";}
        });
        row.append(box,btn);out.appendChild(row);count++;
      }
      // MapWarper-Treffer ausschliesslich aus der echten API beziehen.
      // Lizenzgepruefte Karten stehen im separaten kostenlosen Katalog.
      status.textContent=count?count+" Karten im integrierten Katalog. Zusätzliche MapWarper-Treffer werden gesucht …":"Suche georeferenzierte MapWarper-Karten …";
      try {
        var endpoint="https://mapwarper.net/api/v1/maps.json?show_warped=1&per_page=35&query="+encodeURIComponent(query);
        var response=await fetch(endpoint,{headers:{"Accept":"application/json"}});
        if (!response.ok) throw new Error("HTTP "+response.status);
        var data=await response.json(), rows=Array.isArray(data.data)?data.data:[];
        rows.forEach(function(record) {
          var a=record.attributes||{}, links=record.links||{};
          var url=safeHttp(links.tiles);
          if (!url||!["{z}","{x}","{y}"].every(function(v){return url.includes(v);})) return;
          var name=String(a.title||"Historische Karte").slice(0,220);
          var match=String(a.date_depicted||a.issue_year||name).match(/(?:1[0-9]{3}|20[0-9]{2})/);
          appendSuggestion({name:name,year:match?Number(match[0]):null,region:query,sourceUrl:url,detailUrl:"https://mapwarper.net/maps/"+encodeURIComponent(record.id),provider:"MapWarper",type:"xyz",bbox:a.bbox||null});
          remote++;
        });
        status.textContent=count+" Kartenangebote insgesamt; "+remote+" MapWarper-Einträge ausgewertet (erste Ergebnisseite).";
        if (!count) status.textContent="Keine übernehmbaren XYZ-Karten gefunden. Probiere einen anderen Suchbegriff.";
      } catch(e) {
        status.textContent=(count?count+" Karten aus dem integrierten Katalog verfügbar. ":"")+"Live-Suche bei MapWarper aktuell nicht möglich ("+e.message+"). Die Karten können weiterhin manuell hinzugefügt werden.";
      }
    });
    el("mgrRestore").addEventListener("click",function () {
      var removed=maps.filter(function(m){return m&&m.hidden;});
      if(!removed.length){api.setNotice("Keine entfernten Karten vorhanden.");return;}
      if(!window.confirm(removed.length+" entfernte Karte(n) wieder in die Bibliothek aufnehmen?"))return;
      removed.forEach(function(m){m.hidden=false;});
      persist();redraw();api.setNotice("Entfernte Karten wiederhergestellt.");
    });
    el("mgrExport").addEventListener("click",function () {
      persist();
      var blob=new Blob([localStorage.getItem(KEY)||"{}"],{type:"application/json"});
      var url=URL.createObjectURL(blob), link=node("a");link.href=url;link.download="historischer-kartenatlas-sicherung.json";link.click();
      setTimeout(function () {URL.revokeObjectURL(url);},1000);
    });
    el("mgrImport").addEventListener("change",async function (event) {
      var file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 1000000) throw new Error("Sicherungsdatei ist zu groß.");
        var data=JSON.parse(await file.text());
        if (!data || data.version !== 2 || !Array.isArray(data.custom) || !Array.isArray(data.regions)) throw new Error("Keine gültige Atlas-2-Sicherung.");
        if (!window.confirm("Die jetzige lokale Bibliothek wird durch die Sicherung ersetzt. Fortfahren?")) return;
        localStorage.setItem(KEY, JSON.stringify(data));location.reload();
      } catch(e) { api.setNotice("Import fehlgeschlagen: "+e.message,6500); }
    });
    // HistoMap is intentionally no longer offered as a faux citywide
    // year-series. Existing user maps remain readable and removable.
    var histoNote=node("p","manager-muted");
    histoNote.innerHTML='HistoMap Berlin eignet sich für <strong>grundstücks- und blattgenaue Detailrecherchen</strong>, nicht für einheitliche Gesamtberliner Jahrgänge. <a href="https://histomapberlin.de/" target="_blank" rel="noopener noreferrer">HistoMap im Original öffnen ↗</a>';
    // HistoMap explanation remains available, but does not create
    // historically inaccurate uniform city-wide year maps.
    // Nur dokumentierte, georeferenzierte XYZ-Karten ohne Bezahlschranke.
    // Die Inhalte werden nicht vorinstalliert. Jede Karte bleibt eine
    // ungespeicherte Vorschau, bis der Nutzer "Karte speichern" waehlt.
    // Kachelquelle, Lizenz und Urheber sind auf Historic.Place dokumentiert.
    const freeHistoricalMaps=[
      {
        name:"Sitzenrodaer Forstrevier 1780",year:1780,region:"Sitzenroda",
        sourceUrl:"https://tiles.historic.place/region/Sitzenrodaer-Forst_1780/{z}/{x}/{y}.png",
        detailUrl:"https://wiki.historic.place/doku.php?id=de:karten",
        provider:"SLUB Dresden / Historic.Place",license:"CC0 1.0",licenceUrl:"https://creativecommons.org/publicdomain/zero/1.0/"
      },
      {
        name:"Schmettausches Kartenwerk Brandenburg 1767–1787",year:1787,region:"Brandenburg",
        sourceUrl:"https://tiles.historic.place/region/Schmettau-1787/{z}/{x}/{y}.png",
        detailUrl:"https://wiki.historic.place/doku.php?id=de:karten",
        provider:"LGB Brandenburg, Staatsbibliothek zu Berlin / Historic.Place",license:"dl-de/by-2.0",licenceUrl:"https://www.govdata.de/dl-de/by-2-0"
      },
      {
        name:"Industriekarte der Region Paris 1927",year:1927,region:"Paris",
        sourceUrl:"https://mapwarper.net/mosaics/tile/867/{z}/{x}/{y}.png",
        detailUrl:"https://mapwarper.net/layers/867",
        provider:"Bibliothèque nationale de France / MapWarper",license:"Licence Ouverte 2.0",licenceUrl:"https://www.etalab.gouv.fr/licence-ouverte-open-licence/"
      },
      {
        name:"Verkehrskarte Magdeburg 1922",year:1922,region:"Magdeburg",
        sourceUrl:"https://tiles.historic.place/region/Verkehrskarte_Magdeburg_1922/{z}/{x}/{y}.png",
        detailUrl:"https://wiki.historic.place/doku.php?id=de:karten",
        provider:"Hans Ravenstein / Historic.Place",license:"Public Domain",licenceUrl:"https://commons.wikimedia.org/wiki/File:Neue_Spezial-_und_Verkehrskarte_f%C3%BCr_den_Regierungsbezirk_Magdeburg.jpg"
      },
      {
        name:"Atlas Tyrolensis 1774",year:1774,region:"Tirol",
        sourceUrl:"https://tiles.historic.place/region/Atlas_Tyrolensis/{z}/{x}/{y}.png",
        detailUrl:"https://wiki.historic.place/doku.php?id=de:karten",
        provider:"Tiroler Landesarchiv / Historic.Place",license:"Public Domain",licenceUrl:"https://commons.wikimedia.org/wiki/File:Atlas_Tyrolensis-small.jpg"
      },
      {
        name:"Großherzogtum Baden 1839",year:1839,region:"Baden-Württemberg",
        sourceUrl:"https://tiles.historic.place/region/Herzogtum_Baden/{z}/{x}/{y}.png",
        detailUrl:"https://wiki.historic.place/doku.php?id=de:karten",
        provider:"Universitätsbibliothek Heidelberg / Historic.Place",license:"CC BY-SA 3.0 DE",licenceUrl:"https://creativecommons.org/licenses/by-sa/3.0/de/"
      },
      {
        name:"Sächsische Kantoneinteilung 1814",year:1814,region:"Sachsen",
        sourceUrl:"https://tiles.historic.place/region/Saechsische_Kantoneinteilung_(1814)/{z}/{x}/{y}.png",
        detailUrl:"https://wiki.historic.place/doku.php?id=de:karten",
        provider:"Wikimedia Commons / Historic.Place",license:"Public Domain",licenceUrl:"https://wiki.historic.place/doku.php?id=de:karten"
      },
      {
        name:"Königreich Sachsen 1857",year:1857,region:"Sachsen",
        sourceUrl:"https://tiles.historic.place/region/Sachsen_1857/{z}/{x}/{y}.png",
        detailUrl:"https://wiki.historic.place/doku.php?id=de:karten",
        provider:"Leibniz-Institut für Länderkunde / Historic.Place",license:"CC0 1.0",licenceUrl:"https://creativecommons.org/publicdomain/zero/1.0/"
      }
    ];
    const archivePanel=disclosure("managerHistoricalCollectionsProvider","Kostenlose georeferenzierte Karten");
    const archiveWrap=node("div","manager-results");
    archiveWrap.style.cssText="max-height:50dvh;overflow:auto;margin:12px";
    for(const item of freeHistoricalMaps){
      const row=node("div","manager-result");
      const info=node("div");
      info.style.minWidth="0";
      info.appendChild(node("strong","",item.name));
      const license=node("small","",item.year+" · "+item.region+" · kostenlos · "+item.license);
      info.appendChild(license);
      const source=node("a","manager-label","Kartenquelle");
      source.href=item.detailUrl;
      source.target="_blank";source.rel="noopener noreferrer";
      source.style.cssText="display:inline-block;font-size:11px;margin-top:5px;text-decoration:underline";
      const licence=node("a","manager-label","Nutzungslizenz");
      licence.href=item.licenceUrl;licence.target="_blank";licence.rel="noopener noreferrer";
      licence.style.cssText="display:inline-block;font-size:11px;margin:5px 0 0 12px;text-decoration:underline";
      info.append(source,licence);
      const button=node("button","manager-action manager-primary","Auf Karte legen");
      button.type="button";
      button.style.cssText="white-space:nowrap;flex:none";
      button.addEventListener("click",()=>{
        try{
          previewDiscoveredMap({
            name:item.name,year:item.year,region:item.region,
            provider:item.provider+" · "+item.license,
            type:"xyz",sourceUrl:item.sourceUrl,detailUrl:item.detailUrl
          });
        }catch(e){api.setNotice("Vorschau nicht möglich: "+e.message,3000);}
      });
      row.append(info,button);
      archiveWrap.appendChild(row);
    }
    archivePanel.appendChild(archiveWrap);
    discover.insertBefore(archivePanel,manualPanel);
    const histoPanel=disclosure("managerHistoMapInfoProvider","HistoMap Berlin · Detailrecherche");
    histoPanel.appendChild(histoNote);
    discover.appendChild(histoPanel);
    if (window.AtlasGeoportal) window.AtlasGeoportal.mount({
      parent:el("managerDiscover"),maps:maps,preview:previewDiscoveredMap
    });
    return {open:open,editMap:editMap,beginNewMap:beginNewMap,removeMap:removeMap,previewDiscoveredMap,saveDiscoveredMap};
  }
  window.AtlasManager = {mount:mount};
}());
