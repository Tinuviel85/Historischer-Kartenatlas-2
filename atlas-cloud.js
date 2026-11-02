/* Historical Atlas: optional Supabase Auth and cloud storage.
   Guest mode remains fully local. No service-role credentials in the browser. */
(function(){
"use strict";
const GUEST_KEY="historischer-atlas-v2-library";
const FAVORITES_KEY="historischer-atlas-favoriten";
const GUEST_FAV_KEY="historischer-atlas-guest-favorites";
const CONFIG=window.ATLAS_SUPABASE_CONFIG||{};
const configured=/^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(String(CONFIG.url||"")) &&
  /^(sb_publishable_|eyJ)/.test(String(CONFIG.publishableKey||""));
let client=null, user=null, booted=false, pending=null, sending=false, lastError="", account=null;
const id=x=>document.getElementById(x);
function validState(value) {
  return value && typeof value==="object" && !Array.isArray(value) && value.version===2 &&
    Array.isArray(value.custom) && Array.isArray(value.regions);
}
function readJSON(key) {
  try {return JSON.parse(localStorage.getItem(key)||"null");}catch(_){return null;}
}
function keyFor(uid) {return "historischer-atlas-v2-user-"+uid;}
function meaningful(s) {
  return validState(s) && (s.custom.length>0||s.regions.length>0||
    (s.hidden&&s.hidden.length>0)||(s.overrides&&Object.keys(s.overrides).length>0)||
    (s.favorites&&s.favorites.length>0));
}
function renderState() {
  if(!account)return;
  const label=id("atlasAccountButton");
  if(label)label.textContent=user?(user.email||"Mein Konto")+" · ☁":"☁ Anmelden";
  const summary=id("atlasAuthSummary");
  if(summary)summary.textContent=user?
    "Angemeldet als "+(user.email||"Benutzer")+" · Änderungen werden mit deiner Online-Bibliothek synchronisiert.":
    configured?"Ohne Anmeldung bleibt deine Kartenbibliothek ausschließlich in diesem Browser gespeichert.":
      "Lokaler Modus aktiv. Für geräteübergreifende Anmeldung fehlt noch die Supabase-Konfiguration.";
  const form=id("atlasLoginForm"), logout=id("atlasLogout");
  if(form)form.hidden=!!user||!configured;
  if(logout)logout.hidden=!user;
  const status=id("atlasAuthStatus");
  if(status)status.textContent=lastError;
}
function attachUI() {
  if(account)return;
  const css=document.createElement("style");
  css.textContent=".atlas-account{width:100%;padding:10px;border:1px solid #dbe5dc;border-radius:10px;background:#f7faf6;color:#225244;font-weight:700;margin:7px 0 0;cursor:pointer}.atlas-account:focus-visible{outline:3px solid #6e9d89}.atlas-auth-modal{border:1px solid #d7e2d7;border-radius:16px;padding:0;box-shadow:0 20px 70px #0f281f70;color:#213b2f;width:min(450px,calc(100% - 20px))}.atlas-auth-modal::backdrop{background:#132d2390}.atlas-auth-inner{padding:24px}.atlas-auth-inner h2{font:700 23px Georgia,serif;margin:0 0 13px}.atlas-auth-inner p{color:#62766a;font-size:13px;line-height:1.5}.atlas-auth-inner label{display:block;font-size:13px;font-weight:700}.atlas-auth-inner input{width:100%;padding:12px;border:1px solid #c9d8cd;border-radius:9px;margin:8px 0 12px;font:inherit}.atlas-auth-inner button{border-radius:9px;border:1px solid #b5cbbc;padding:10px;background:white;color:#225244;font-weight:700;cursor:pointer}.atlas-auth-inner .atlas-primary{background:#225244;color:white;border-color:#225244}.atlas-auth-buttons{display:flex;gap:8px;flex-wrap:wrap}.atlas-auth-status{margin-top:10px;min-height:19px;color:#a44a3b;font-size:13px}";
  document.head.appendChild(css);
  const btn=document.createElement("button");btn.id="atlasAccountButton";btn.className="atlas-account";btn.type="button";
  const sidebar=document.getElementById("sidebar");
  const bottom=sidebar&&sidebar.querySelector(".sidebar-bottom");
  if(bottom)bottom.appendChild(btn);
  account=document.createElement("dialog");account.className="atlas-auth-modal";account.id="atlasAuthDialog";
  account.innerHTML='<div class="atlas-auth-inner"><h2>Mein Kartenkonto</h2><p id="atlasAuthSummary"></p><form id="atlasLoginForm"><label for="atlasEmail">E-Mail-Adresse</label><input id="atlasEmail" type="email" autocomplete="email" required placeholder="name@beispiel.de"><div class="atlas-auth-buttons"><button class="atlas-primary" type="submit">Anmeldelink per E-Mail senden</button></div></form><div class="atlas-auth-buttons"><button type="button" id="atlasLogout" hidden>Abmelden</button><button type="button" id="atlasAuthClose">Schließen</button></div><p id="atlasAuthStatus" class="atlas-auth-status" role="status"></p><p>Ohne Konto: nur auf diesem Gerät. Mit Konto: private Cloud-Bibliothek auf allen Geräten. Die Anmeldung ist erst nach Einrichtung des Supabase-Projekts verfügbar.</p></div>';
  document.body.appendChild(account);
  btn.addEventListener("click",()=>{renderState();account.showModal();});
  id("atlasAuthClose").addEventListener("click",()=>account.close());
  account.addEventListener("click",e=>{if(e.target===account)account.close();});
  id("atlasLoginForm").addEventListener("submit",async e=>{
    e.preventDefault();
    if(!client)return;
    const email=id("atlasEmail").value.trim();
    if(!email)return;
    const submit=id("atlasLoginForm").querySelector("[type=submit]");
    submit.disabled=true;lastError="Anmeldelink wird verschickt …";renderState();
    try {
      const cleanURL=location.origin+location.pathname;
      const {error}=await client.auth.signInWithOtp({email,options:{emailRedirectTo:cleanURL}});
      if(error)throw error;
      lastError="Bitte dein E-Mail-Postfach öffnen und den Anmeldelink anklicken.";
    } catch(e){lastError="Anmeldung fehlgeschlagen: "+(e.message||e);}
    finally {submit.disabled=false;renderState();}
  });
  id("atlasLogout").addEventListener("click",async()=>{
    if(!client)return;
    if(sending||pending){if(!confirm("Es stehen möglicherweise noch nicht synchronisierte Änderungen aus. Trotzdem abmelden?"))return;}
    const {error}=await client.auth.signOut();
    if(error){lastError="Abmelden fehlgeschlagen: "+error.message;renderState();return;}
    localStorage.setItem(FAVORITES_KEY,localStorage.getItem(GUEST_FAV_KEY)||"[]");
    location.reload();
  });
  renderState();
}
async function loadLibrary() {
  const personalKey=keyFor(user.id);
  window.AtlasManagerStoreKey=personalKey;
  const cached=readJSON(personalKey), guest=readJSON(GUEST_KEY);
  if(localStorage.getItem(GUEST_FAV_KEY)===null) localStorage.setItem(GUEST_FAV_KEY,localStorage.getItem(FAVORITES_KEY)||"[]");
  let cloud=null, readFailed=false;
  try {
    const {data,error}=await client.from("atlas_user_libraries").select("library").eq("owner_id",user.id).maybeSingle();
    if(error)throw error;
    cloud=validState(data?.library)?data.library:null;
  }catch(e) {
    readFailed=true;lastError="Cloud-Abfrage fehlgeschlagen: "+(e.message||e)+". Lokale Kopie bleibt erhalten.";
  }
  if(cloud) {
    // Server data is canonical on login. Do not mingle private accounts' browser caches.
    localStorage.setItem(personalKey,JSON.stringify(cloud));
    localStorage.setItem(FAVORITES_KEY,JSON.stringify(Array.isArray(cloud.favorites)?cloud.favorites:[]));
  } else if(!readFailed) {
    let initial=validState(cached)?cached:null;
    if(!initial && meaningful(guest) && confirm("Deine bisherige lokale Kartenbibliothek in dein neues Online-Konto übernehmen?")) {
      initial=Object.assign({},guest,{favorites:readJSON(FAVORITES_KEY)||[]});
    }
    if(initial) {
      localStorage.setItem(personalKey,JSON.stringify(initial));
      localStorage.setItem(FAVORITES_KEY,JSON.stringify(initial.favorites||[]));
      await saveLibrary(initial);
    } else {
      localStorage.removeItem(personalKey);
      localStorage.setItem(FAVORITES_KEY,"[]");
    }
  } else {
    // Offline: show only own authenticated user's cached library, never the guest library.
    localStorage.setItem(FAVORITES_KEY,JSON.stringify(cached?.favorites||[]));
  }
}
async function init() {
  if(booted)return;booted=true;
  window.AtlasManagerStoreKey=GUEST_KEY;
  if(!configured){attachUI();return;}
  try {
    if(!window.supabase?.createClient) {
      await new Promise((resolve,reject)=>{
        const s=document.createElement("script");
        s.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
        s.onload=resolve;s.onerror=()=>reject(new Error("Supabase-Bibliothek konnte nicht geladen werden."));
        document.head.appendChild(s);
      });
    }
    client=window.supabase.createClient(String(CONFIG.url).replace(/\/$/,""),CONFIG.publishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    const {data,error}=await client.auth.getSession();
    if(error)throw error;
    user=data?.session?.user||null;
    if(user)await loadLibrary();
  }catch(e) {lastError="Online-Anmeldung derzeit nicht verfügbar: "+(e.message||e);}
  attachUI();renderState();
}
async function saveLibrary(state) {
  if(!client||!user||!validState(state))return false;
  pending=JSON.parse(JSON.stringify(state));
  if(sending)return true;
  sending=true;
  while(pending) {
    const value=pending;pending=null;
    try {
      const {error}=await client.from("atlas_user_libraries").upsert({
        owner_id:user.id,library:value,updated_at:new Date().toISOString()
      },{onConflict:"owner_id"});
      if(error)throw error;
      lastError="";
    }catch(e) {
      lastError="Cloud-Speicherung fehlgeschlagen. Die lokale Kopie bleibt erhalten: "+(e.message||e);
      // Do not lose a newer pending edit; newest state wins.
      pending=pending||value;break;
    }
  }
  sending=false;renderState();
  return !lastError;
}
function syncFavorites(favorites) {
  if(!user)return;
  const data=readJSON(keyFor(user.id))||{version:2,regions:[],custom:[],overrides:{},hidden:[]};
  data.favorites=Array.isArray(favorites)?favorites:[];
  localStorage.setItem(keyFor(user.id),JSON.stringify(data));
  void saveLibrary(data);
}
window.addEventListener("online",()=>{
  if(user&&pending&&!sending)void saveLibrary(pending);
});
window.AtlasCloud={
  init:init, isAuthenticated:()=>!!user,saveLibrary:saveLibrary,syncFavorites:syncFavorites,
  isConfigured:()=>configured
};
}());
