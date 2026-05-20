'use strict';
/* PFEvent Control — app.js v3 */

const socket = io();

const S = {
  user: null, room: null,
  activeStripId: null, pdcStripId: null,
  myStripId: null, flightRules: 'IFR',
  starRating: 0, clearanceShown: false,
  atcIssuerId: null, voiceUrl: null
};

const esc = s => s == null ? '' : String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ── Show one screen ─────────────────────────────────── */
function show(id) {
  ['s-login','s-role','s-home','s-atc','s-pilot'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = id === 's-atc' ? 'flex' : 'block';
}

/* ── Boot ────────────────────────────────────────────── */
async function boot() {
  try {
    const { user } = await fetch('/api/me').then(r => r.json());
    const urlErr = new URLSearchParams(location.search).get('error');
    if (urlErr) {
      const el = document.getElementById('login-err');
      if (el) el.textContent = urlErr === 'auth_failed' ? 'Discord login failed. Try again.' : 'Error: ' + urlErr;
    }
    if (!user) {
      // Check if coming from a /file/:roomId link
      const m = location.pathname.match(/^\/file\/([A-Z0-9]{4,8})$/i);
      if (m) sessionStorage.setItem('pendingRoom', m[1].toUpperCase());
      show('s-login');
      return;
    }
    S.user = user;
    // Check if there's a pending room to join as pilot
    const pending = sessionStorage.getItem('pendingRoom');
    if (pending) {
      sessionStorage.removeItem('pendingRoom');
      if (!user.role) {
        await fetch('/api/me/role', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role:'pilot' }) });
        S.user.role = 'pilot';
      }
      socketJoin(pending);
      return;
    }
    user.role ? showHome() : showRole();
  } catch(e) {
    show('s-login');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* ── Role ────────────────────────────────────────────── */
function showRole() {
  show('s-role');
  const el = document.getElementById('nav-user-role');
  if (el) el.textContent = S.user.username;
}

async function selectRole(role) {
  await fetch('/api/me/role', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({role}) });
  S.user.role = role;
  showHome();
}
function switchRole() { S.user.role = null; showRole(); }

/* ── Home ────────────────────────────────────────────── */
function showHome() {
  show('s-home');
  const nu = document.getElementById('nav-user-home'); if (nu) nu.textContent = S.user.username;
  const nb = document.getElementById('nav-role-badge');
  if (nb) { nb.textContent = S.user.role.toUpperCase(); nb.className = 'nav-role-badge ' + S.user.role; }
  const cards = document.getElementById('home-cards');
  if (!cards) return;
  if (S.user.role === 'atc') {
    cards.innerHTML = `
      <div class="home-card" onclick="openModal('create-modal')"><div class="home-card-icon">🗼</div><div class="home-card-title">Create event room</div><div class="home-card-desc">Start a new ATC session and get a room code</div></div>
      <div class="home-card" onclick="openModal('join-modal')"><div class="home-card-icon">🔑</div><div class="home-card-title">Join room</div><div class="home-card-desc">Join an existing event by room code</div></div>`;
  } else {
    cards.innerHTML = `
      <div class="home-card" onclick="openModal('join-modal')"><div class="home-card-icon">✈️</div><div class="home-card-title">Join event</div><div class="home-card-desc">Enter the room code to file your flight plan</div></div>`;
  }
}

function goHome() {
  S.room = null; S.activeStripId = null; S.myStripId = null;
  S.pdcStripId = null; S.clearanceShown = false;
  showHome();
}

/* ── Profile modal ───────────────────────────────────── */
async function openModal(id) {
  document.getElementById(id)?.classList.add('open');
  if (id === 'profile-modal') await renderProfile(S.user.id);
}

function renderProfile(userId) {
  return fetch('/api/users/' + userId).then(r => r.json()).then(u => {
    const el = document.getElementById('profile-content');
    if (!el) return;
    const avg = u.ratings?.length ? (u.ratings.reduce((a,r) => a+r.stars,0)/u.ratings.length).toFixed(1) : null;
    const stars = avg ? '★'.repeat(Math.round(avg)) + '☆'.repeat(5-Math.round(avg)) : '—';
    // Generate pilot filing link
    const fileLink = S.user.role === 'atc' && S.room ? `${location.origin}/file/${S.room.id}` : null;
    el.innerHTML = `
      <div class="profile-wrap">
        <img class="profile-avatar" src="${esc(u.avatar)}" alt="${esc(u.username)}">
        <div class="profile-name">${esc(u.username)}</div>
        <div class="profile-role">${esc((u.role||'').toUpperCase())}</div>
        <div class="profile-stats">
          <div class="pstat"><div class="pstat-val">${u.totalFlights||0}</div><div class="pstat-lbl">Flights</div></div>
          <div class="pstat"><div class="pstat-val">${avg||'—'}</div><div class="pstat-lbl">Avg rating</div></div>
          <div class="pstat"><div class="pstat-val">${u.ratings?.length||0}</div><div class="pstat-lbl">Ratings</div></div>
        </div>
        ${avg ? `<div style="font-size:18px;color:#fbbf24;letter-spacing:2px;margin-top:4px">${stars}</div>` : ''}
        ${fileLink ? `<div class="profile-link-box"><div class="profile-link-label">Pilot filing link — share this with pilots</div><div class="profile-link">${esc(fileLink)}</div><button class="btn-primary" style="margin-top:8px" onclick="navigator.clipboard.writeText('${esc(fileLink)}');this.textContent='Copied!'">Copy link</button></div>` : ''}
        ${u.ratings?.length ? `
          <div class="profile-divider"></div>
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);width:100%;margin-bottom:6px">Ratings received</div>
          <div class="profile-ratings">
            ${u.ratings.slice().reverse().map(r => `<div class="prating-item"><div class="prating-top"><span class="prating-pilot">${esc(r.pilotName)}</span><span class="prating-stars">${'★'.repeat(r.stars)}</span></div>${r.comment?`<div class="prating-cmt">${esc(r.comment)}</div>`:''}</div>`).join('')}
          </div>` : ''}
      </div>`;
  }).catch(() => {});
}

function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

document.querySelectorAll('.modal-bg').forEach(b => {
  b.addEventListener('click', e => { if (e.target === b) b.classList.remove('open'); });
});

/* ── Create / Join room ──────────────────────────────── */
async function createRoom() {
  const name    = document.getElementById('c-name').value.trim();
  const airport = document.getElementById('c-airport').value.trim().toUpperCase();
  const errEl   = document.getElementById('create-err');
  if (!name) { errEl.textContent = 'Event name required.'; return; }
  errEl.textContent = '';
  const data = await fetch('/api/rooms', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({eventName:name,airport}) }).then(r=>r.json());
  if (data.error) { errEl.textContent = data.error; return; }
  closeModal('create-modal');
  socketJoin(data.roomId);
}

function joinRoom() {
  const code  = document.getElementById('j-code').value.trim().toUpperCase();
  const errEl = document.getElementById('join-err');
  if (!code || code.length < 4) { errEl.textContent = 'Enter a valid room code.'; return; }
  errEl.textContent = '';
  closeModal('join-modal');
  socketJoin(code);
}

function socketJoin(roomId) {
  socket.emit('room:join', { roomId, userId: S.user.id });
}

/* ═══════════════ SOCKET EVENTS ═══════════════ */
socket.on('room:joined', room => {
  S.room = room;
  S.user.role === 'atc' ? launchATC(room) : launchPilot(room);
});

socket.on('room:error', ({ message }) => {
  const el = document.getElementById('join-err');
  if (el) el.textContent = message;
  openModal('join-modal');
});

socket.on('room:update', room => {
  S.room = room;
  if (S.user.role === 'atc') {
    renderStrips(room.strips);
    updateATCStats(room);
    if (room.atis) renderATISBanner(room.atis);
  } else {
    updatePilotStats(room);
    if (room.atis) renderATISList(room.atis);
    renderControllers(room);
    if (!S.clearanceShown && S.myStripId) {
      const s = room.strips.find(s => s.id === S.myStripId);
      if (s?.pdcStatus === 'issued' && s.clearance) showClearance(s);
    }
  }
});

socket.on('room:message', ({ text }) => {
  if (S.user?.role === 'pilot') tline(text, 'cyan', '[MSG]', 'atc');
  toast(S.user?.role === 'atc' ? 'atc-toast' : 'pilot-toast', text);
});

socket.on('flightplan:accepted', ({ stripId }) => { S.myStripId = stripId; });

// Direct PDC push to pilot
socket.on('room:update', room => {
  if (S.user?.role !== 'pilot' || S.clearanceShown || !S.myStripId) return;
  const strip = room.strips.find(s => s.id === S.myStripId);
  if (strip?.pdcStatus === 'issued' && strip.clearance) showClearance(strip);
});

socket.on('chat:receive', data => {
  ['atc-msgs','pilot-msgs'].forEach(id => {
    const c = document.getElementById(id);
    if (!c) return;
    const me = data.userId === S.user?.id;
    const d = document.createElement('div');
    d.className = 'chat-msg' + (me?' me':'');
    d.innerHTML = `<div class="chat-meta"><span class="chat-name">${esc(data.username)}</span><span class="chat-role-tag ${esc(data.role)}">${esc((data.role||'').toUpperCase())}</span></div><div class="chat-bubble">${esc(data.message)}</div>`;
    c.appendChild(d); c.scrollTop = c.scrollHeight;
    if (!me) document.querySelectorAll('.unread-btn').forEach(b => b.classList.add('unread'));
  });
});

socket.on('voice:update', url => {
  S.voiceUrl = url;
  const a1 = document.getElementById('voice-a'),   box1 = document.getElementById('voice-active');
  const a2 = document.getElementById('pilot-voice-a'), box2 = document.getElementById('pilot-voice-active'), none = document.getElementById('pilot-voice-none');
  if (a1)   a1.href = url;
  if (box1) box1.style.display = 'flex';
  if (a2)   a2.href = url;
  if (box2) box2.style.display = 'flex';
  if (none) none.style.display = 'none';
});

socket.on('atc:rated', () => toast('pilot-toast', 'Rating submitted!'));

/* ═══════════════ ATC BOARD ═══════════════ */
function launchATC(room) {
  show('s-atc');
  const n = document.getElementById('atc-event-name'); if (n) n.textContent = room.eventName + (room.airport?' — '+room.airport:'');
  const c = document.getElementById('atc-room-code'); if (c) c.textContent = room.id;
  renderStrips(room.strips);
  updateATCStats(room);
  if (room.atis) renderATISBanner(room.atis);
  if (room.voiceUrl) socket.emit('voice:update', room.voiceUrl);
}

function updateATCStats(room) {
  const t = document.getElementById('atc-total'); if (t) t.textContent = room.strips.length;
  const c = document.getElementById('atc-conn');  if (c) c.textContent = room.connectedCount || 1;
  const pending = room.strips.filter(s => s.pdcStatus==='pending').length;
  const chip = document.getElementById('atc-pdc-chip'), cnt = document.getElementById('atc-pdc-cnt');
  if (chip) chip.style.display = pending > 0 ? 'flex' : 'none';
  if (cnt)  cnt.textContent = pending;
}

const COLS = [
  {key:'registered',color:'#6b7280'},{key:'departing',color:'#3b82f6'},
  {key:'enroute',color:'#22c55e'},{key:'arrived',color:'#a855f7'}
];

const zulu = ts => new Date(ts).toISOString().slice(11,16)+'z';

function renderStrips(strips) {
  COLS.forEach(({key}) => {
    const body = document.getElementById('strips-'+key);
    const cnt  = document.getElementById('cnt-'+key);
    if (!body) return;
    const lane = strips.filter(s=>s.status===key);
    if (cnt) cnt.textContent = lane.length;
    body.innerHTML = lane.length ? lane.map(buildStrip).join('') : '<div class="strip-empty">No flights</div>';
  });
  document.querySelectorAll('.strip').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.id)));
}

function buildStrip(f) {
  const pdc = f.pdcStatus==='pending' ? ' pdc-pending' : '';
  return `<div class="strip${pdc}" data-id="${esc(f.id)}" data-status="${esc(f.status)}">
    <div class="sr1"><span class="scs">${esc(f.callsign)}</span><span class="sac">${esc(f.actype)}</span><span class="srules ${(f.flightRules||'IFR').toLowerCase()}">${esc(f.flightRules||'IFR')}</span><span class="sva">${esc(f.va||'—')}</span></div>
    <div class="sr2"><span>${esc(f.orig)}</span><span class="sarr">→</span><span>${esc(f.dest)}</span>${f.gate?`<span style="margin-left:auto;font-size:10px;color:var(--t3)">${esc(f.gate)}</span>`:''}</div>
    <div class="sr3">
      ${f.fl?`<span class="stag">${esc(f.fl)}</span>`:''}
      ${f.squawk?`<span class="stag sq">SQ ${esc(f.squawk)}</span>`:''}
      ${f.pdcStatus==='pending'?`<span class="stag pdc">PDC</span>`:''}
      ${f.sid?`<span class="stag">${esc(f.sid)}</span>`:''}
      <span class="spilot">${esc(f.pilot)}</span>
    </div>
  </div>`;
}

function openDetail(id) {
  const f = S.room?.strips.find(s=>s.id===id);
  if (!f) return;
  S.activeStripId = id;
  const hdr = document.getElementById('d-cs-hdr'); if (hdr) hdr.textContent = f.callsign;
  const body = document.getElementById('detail-body'); if (!body) return;
  body.innerHTML = `
    <div class="det-cs">${esc(f.callsign)}</div>
    <div class="det-sub">${esc(f.orig)} → ${esc(f.dest)} · ${esc(f.flightRules)} · ${zulu(f.addedAt)}</div>
    ${f.squawk?`<div class="sq-big">${esc(f.squawk)}</div>`:''}
    <div class="det-grid">
      <div class="det-item"><label>Aircraft</label><span>${esc(f.actype)}</span></div>
      <div class="det-item"><label>VA</label><span>${esc(f.va||'—')}</span></div>
      <div class="det-item"><label>Gate</label><span>${esc(f.gate||'—')}</span></div>
      <div class="det-item"><label>FL</label><span>${esc(f.fl||'—')}</span></div>
      <div class="det-item"><label>Pilot</label><span>${esc(f.pilot)}</span></div>
      <div class="det-item"><label>PDC</label><span style="color:${f.pdcStatus==='issued'?'#4ade80':f.pdcStatus==='pending'?'#fbbf24':'var(--t2)'}">${esc(f.pdcStatus)}</span></div>
      ${f.sid?`<div class="det-item"><label>SID</label><span>${esc(f.sid)}</span></div>`:''}
      ${f.star?`<div class="det-item"><label>STAR</label><span>${esc(f.star)}</span></div>`:''}
    </div>
    ${f.pdcStatus==='pending'?`<div class="pdc-alert">⚠ Pilot requesting PDC clearance</div><button class="btn-primary" style="margin-bottom:10px" onclick="openPDC('${esc(f.id)}')">Issue PDC Clearance</button>`:''}
    <div class="det-lbl">Move to status</div>
    <div class="status-btns">
      ${COLS.map(col=>`<button class="sbtn ${f.status===col.key?'on':''}" onclick="moveStrip('${col.key}')"><span class="sdot" style="background:${col.color}"></span>${col.key.charAt(0).toUpperCase()+col.key.slice(1)}</button>`).join('')}
    </div>
    <div class="det-lbl">Squawk</div>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input id="sq-inp" class="mono" style="flex:1;background:var(--bg3);border:1px solid var(--bd);border-radius:8px;padding:7px 10px;color:var(--t);font-size:14px;outline:none" maxlength="4" placeholder="0000" value="${esc(f.squawk||'')}">
      <button onclick="assignSQ()" style="padding:7px 14px;background:var(--acc);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">Assign</button>
    </div>
    <button class="btn-danger" onclick="deleteStrip()">Remove strip</button>`;
  openPanel('detail-panel');
}

function moveStrip(s) { socket.emit('strip:update',{roomId:S.room.id,stripId:S.activeStripId,changes:{status:s}}); closePanel('detail-panel'); toast('atc-toast','Moved to '+s); }
function assignSQ() { const sq=document.getElementById('sq-inp')?.value.trim(); if(!sq)return; socket.emit('strip:update',{roomId:S.room.id,stripId:S.activeStripId,changes:{squawk:sq}}); toast('atc-toast','Squawk '+sq+' assigned'); }
function deleteStrip() { socket.emit('strip:remove',{roomId:S.room.id,stripId:S.activeStripId}); closePanel('detail-panel'); toast('atc-toast','Strip removed'); }

function addStrip() {
  const cs = document.getElementById('a-cs')?.value.trim().toUpperCase();
  if (!cs) { toast('atc-toast','Callsign required'); return; }
  socket.emit('strip:add',{roomId:S.room.id,strip:{
    callsign:cs, actype:document.getElementById('a-ac')?.value.trim().toUpperCase()||'---',
    va:document.getElementById('a-va')?.value.trim(), orig:document.getElementById('a-orig')?.value.trim().toUpperCase()||'----',
    dest:document.getElementById('a-dest')?.value.trim().toUpperCase()||'----', gate:document.getElementById('a-gate')?.value.trim().toUpperCase(),
    fl:document.getElementById('a-fl')?.value.trim().toUpperCase(), pilot:document.getElementById('a-pilot')?.value.trim()||'Unknown',
    flightRules:document.getElementById('a-rules')?.value, remarks:document.getElementById('a-rmk')?.value.trim()
  }});
  ['a-cs','a-ac','a-va','a-orig','a-dest','a-gate','a-fl','a-pilot','a-rmk'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  closePanel('add-panel'); toast('atc-toast','Strip added');
}

function openPDC(stripId) {
  S.pdcStripId = stripId;
  const f = S.room.strips.find(s=>s.id===stripId); if (!f) return;
  closePanel('detail-panel');
  const info = document.getElementById('pdc-info');
  if (info) info.innerHTML = `<strong>${esc(f.callsign)}</strong>${esc(f.pilot)} · ${esc(f.orig)}→${esc(f.dest)} · ${esc(f.flightRules)}<br>FL: ${esc(f.fl||'N/A')} · Gate: ${esc(f.gate||'N/A')}${f.route?`<br>Route: ${esc(f.route)}`:''}`;
  const fl = document.getElementById('pdc-fl'); if (fl) fl.value = f.fl||'';
  openPanel('pdc-panel');
}

function issuePDC() {
  if (!S.pdcStripId) return;
  socket.emit('pdc:issue',{roomId:S.room.id,stripId:S.pdcStripId,clearance:{
    squawk:document.getElementById('pdc-sq')?.value.trim()||null,
    sid:document.getElementById('pdc-sid')?.value.trim().toUpperCase(),
    star:document.getElementById('pdc-star')?.value.trim().toUpperCase(),
    fl:document.getElementById('pdc-fl')?.value.trim().toUpperCase(),
    freq:document.getElementById('pdc-freq')?.value.trim(),
    remarks:document.getElementById('pdc-rmk')?.value.trim()
  }});
  ['pdc-sq','pdc-sid','pdc-star','pdc-fl','pdc-freq','pdc-rmk'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  closePanel('pdc-panel'); toast('atc-toast','PDC issued');
}

function generateATIS() {
  socket.emit('atis:generate',{roomId:S.room.id,info:{
    wind:document.getElementById('at-wind')?.value.trim(), qnh:document.getElementById('at-qnh')?.value.trim(),
    vis:document.getElementById('at-vis')?.value.trim(),  rwy:document.getElementById('at-rwy')?.value.trim().toUpperCase(),
    temp:document.getElementById('at-temp')?.value.trim(), dew:document.getElementById('at-dew')?.value.trim(),
    cloud:document.getElementById('at-cloud')?.value.trim(), remarks:document.getElementById('at-rmk')?.value.trim()
  }});
  closePanel('atis-panel');
}

function renderATISBanner(atis) {
  const b=document.getElementById('atis-banner'); if(!b)return; b.style.display='flex';
  const l=document.getElementById('atis-ltr'); if(l) l.textContent=atis.letter;
  const t=document.getElementById('atis-txt'); if(t) t.textContent=atis.raw;
}

function setVoice() {
  const url = document.getElementById('voice-inp')?.value.trim();
  if (!url||!url.includes('discord')) { alert('Provide a valid Discord link.'); return; }
  socket.emit('voice:set',{roomId:S.room.id,url});
  closeModal('voice-modal');
}

/* ═══════════════ PILOT ACARS ═══════════════ */
function launchPilot(room) {
  show('s-pilot');
  S.clearanceShown = false;
  const en=document.getElementById('pilot-evtname'); if(en) en.textContent=room.eventName;
  const rc=document.getElementById('pilot-room-code'); if(rc) rc.textContent=room.id;
  setBar('bar-file');
  const myStrip = room.strips.find(s=>s.pilotId===S.user.id);
  if (myStrip) {
    S.myStripId = myStrip.id;
    setTitle(myStrip.callsign);
    renderFlightNotes(myStrip);
    if (myStrip.pdcStatus==='issued'&&myStrip.clearance) { setBar('bar-done'); showClearance(myStrip); }
    else if (myStrip.pdcStatus==='pending') setBar('bar-pdc');
  }
  updatePilotStats(room);
  if (room.atis) renderATISList(room.atis);
  if (room.voiceUrl) { S.voiceUrl=room.voiceUrl; socket.emit('voice:update',room.voiceUrl); }
  setTimeout(()=>{
    tline('DO NOT CLOSE THIS WINDOW. CONTROLLERS MAY SEND PRE DEPARTURE CLEARANCES THROUGH THE ACARS TERMINAL','red');
    tline('System ready. File a flight plan to begin.','dim');
  },200);
  document.querySelectorAll('.star').forEach(star=>{
    star.addEventListener('click',()=>{
      S.starRating=parseInt(star.dataset.v);
      document.querySelectorAll('.star').forEach(s=>s.classList.toggle('on',parseInt(s.dataset.v)<=S.starRating));
    });
  });
}

function setBar(id) { ['bar-file','bar-pdc','bar-done'].forEach(b=>{const e=document.getElementById(b);if(e)e.style.display=b===id?'block':'none';}); }
function setTitle(cs) { const t=document.getElementById('acars-title'); if(t) t.textContent=cs+' ACARS'; }

function updatePilotStats(room) {
  const el=document.getElementById('pilot-conn'); if(el) el.textContent=room.connectedCount||1;
  renderControllers(room);
}

function renderControllers(room) {
  const el=document.getElementById('ctrl-list'); if(!el) return;
  if (!room.atcUsers?.length) { el.innerHTML='<div class="acars-empty">No controllers online</div>'; return; }
  Promise.all(room.atcUsers.map(u=>fetch('/api/users/'+u.id).then(r=>r.json()).catch(()=>u))).then(users=>{
    el.innerHTML = users.map(u=>{
      const avg = u.ratings?.length ? (u.ratings.reduce((a,r)=>a+r.stars,0)/u.ratings.length).toFixed(1) : null;
      return `<div class="ctrl-item">
        <img class="ctrl-avatar" src="${esc(u.avatar||'https://cdn.discordapp.com/embed/avatars/0.png')}" alt="">
        <div class="ctrl-info"><div class="ctrl-name">${esc(u.username)}</div><div class="ctrl-pos">ATC · APP</div></div>
        ${avg?`<div class="ctrl-rating">★ ${avg}</div>`:''}
      </div>`;
    }).join('');
  });
}

function renderATISList(atis) {
  const el=document.getElementById('atis-list'); if(!el) return;
  el.innerHTML=`<div class="atis-itm"><div class="atis-itm-ap">${esc(S.room?.airport||'EVENT')} ATIS ${esc(atis.letter)}</div><div class="atis-itm-txt">${esc(atis.raw)}</div></div>`;
}

function tline(msg,color='',src='[SYSTEM]',srcClass='sys') {
  const term=document.getElementById('acars-term'); if(!term) return;
  const now=new Date().toISOString().slice(11,16)+'Z';
  const line=document.createElement('div'); line.className='tl';
  const t=document.createElement('span'); t.className='tl-time'; t.textContent=now;
  const s=document.createElement('span'); s.className='tl-src '+srcClass; s.textContent=src+':';
  const m=document.createElement('span'); m.className='tl-msg '+(color||''); m.textContent=msg;
  line.append(t,s,m); term.appendChild(line); term.scrollTop=term.scrollHeight;
}

function setRules(r) {
  S.flightRules=r;
  document.getElementById('btn-ifr')?.classList.toggle('active',r==='IFR');
  document.getElementById('btn-vfr')?.classList.toggle('active',r==='VFR');
}

function fileFlight() {
  const cs=document.getElementById('p-cs')?.value.trim().toUpperCase();
  if(!cs){toast('pilot-toast','Callsign required');return;}
  const plan={
    callsign:cs, actype:document.getElementById('p-ac')?.value.trim().toUpperCase()||'---',
    va:document.getElementById('p-va')?.value.trim(),
    orig:document.getElementById('p-orig')?.value.trim().toUpperCase()||'----',
    dest:document.getElementById('p-dest')?.value.trim().toUpperCase()||'----',
    gate:document.getElementById('p-gate')?.value.trim().toUpperCase(),
    fl:document.getElementById('p-fl')?.value.trim().toUpperCase(),
    flightRules:S.flightRules,
    route:document.getElementById('p-route')?.value.trim().toUpperCase(),
    runway:document.getElementById('p-rwy')?.value.trim().toUpperCase(),
    remarks:document.getElementById('p-rmk')?.value.trim()
  };
  closeModal('file-modal');
  socket.emit('flightplan:file',{roomId:S.room.id,plan});
  setTitle(cs);
  tline('FLIGHT PLAN DETAILS,','white');
  tline(`    CALLSIGN: ${plan.callsign} (${plan.va||'Independent'}),`,'white');
  tline(`    TYPE: ${plan.actype},`,'white');
  tline(`    RULES: ${plan.flightRules},`,'white');
  if(plan.gate)   tline(`    STAND: ${plan.gate},`,'white');
  if(plan.runway) tline(`    RUNWAY: ${plan.runway},`,'white');
  tline(`    DEPARTING: ${plan.orig},`,'white');
  tline(`    ARRIVING: ${plan.dest}`,'white');
  if(plan.route) tline(`    ROUTE: ${plan.route}`,'white');
  if(plan.fl)    tline(`    CRUISING FL: ${plan.fl}`,'white');
  tline(`FLIGHT PLAN: ${plan.callsign} SUBMITTED SUCCESSFULLY`,'green');
  setBar('bar-pdc');
  renderFlightNotes(plan);
}

function renderFlightNotes(plan) {
  const el=document.getElementById('fnotes'); if(!el) return;
  el.innerHTML=`
    <div class="fn-row"><div class="fn-key">Callsign</div><div class="fn-val">${esc(plan.callsign)}${plan.va?' ('+esc(plan.va)+')':''}</div></div>
    <div class="fn-row"><div class="fn-key">Aircraft</div><div class="fn-val">${esc(plan.actype)}</div></div>
    <div class="fn-row"><div class="fn-key">Type</div><div class="fn-val">${esc(plan.flightRules||'IFR')}</div></div>
    <div class="fn-div"></div>
    <div class="fn-row"><div class="fn-key">Departure</div><div class="fn-val">${esc(plan.orig)}</div></div>
    <div class="fn-row"><div class="fn-key">Arrival</div><div class="fn-val">${esc(plan.dest)}</div></div>
    ${plan.gate?`<div class="fn-row"><div class="fn-key">Stand</div><div class="fn-val">${esc(plan.gate)}</div></div>`:''}
    ${plan.runway?`<div class="fn-row"><div class="fn-key">Runway</div><div class="fn-val">${esc(plan.runway)}</div></div>`:''}
    ${plan.fl?`<div class="fn-row"><div class="fn-key">Req FL</div><div class="fn-val">${esc(plan.fl)}</div></div>`:''}
    ${plan.route?`<div class="fn-row"><div class="fn-key">Route</div><div class="fn-val" style="font-size:10px">${esc(plan.route)}</div></div>`:''}
    <div class="fn-div"></div>
    <div class="fn-row"><div class="fn-key">Notes</div><textarea class="fn-notes" rows="4" placeholder="Your personal notes..."></textarea></div>`;
}

function reqPDC() {
  if(!S.myStripId){toast('pilot-toast','File a flight plan first');return;}
  socket.emit('pdc:request',{roomId:S.room.id,stripId:S.myStripId});
  tline('PRE-DEPARTURE CLEARANCE REQUESTED. STANDBY...','yellow');
}

function showClearance(strip) {
  if(S.clearanceShown) return;
  S.clearanceShown=true;
  S.atcIssuerId=strip.clearance?.issuedById||null;
  tline('═══════════════════════════════════════════','dim');
  tline('PRE-DEPARTURE CLEARANCE','green');
  tline('═══════════════════════════════════════════','dim');
  tline(`CALLSIGN:    ${strip.callsign}`,'white');
  tline(`SQUAWK:      ${strip.squawk}`,'green');
  tline(`RULES:       ${strip.flightRules}`,'white');
  tline(`CLEARED TO:  ${strip.dest}`,'white');
  tline(`CLEARED FL:  ${strip.clearance?.fl||strip.fl}`,'green');
  if(strip.clearance?.sid)     tline(`SID:         ${strip.clearance.sid}`,'white');
  if(strip.clearance?.star)    tline(`STAR:        ${strip.clearance.star}`,'white');
  if(strip.clearance?.freq)    tline(`FREQUENCY:   ${strip.clearance.freq}`,'white');
  if(strip.clearance?.remarks) tline(`REMARKS:     ${strip.clearance.remarks}`,'yellow');
  tline(`ISSUED BY:   ${strip.clearance?.issuedBy}`,'dim');
  tline('═══════════════════════════════════════════','dim');
  const fn=document.getElementById('fnotes');
  if(fn&&strip.squawk){
    const sq=document.createElement('div'); sq.className='fn-row';
    sq.innerHTML=`<div class="fn-key">Squawk</div><div class="fn-val big">${esc(strip.squawk)}</div>`;
    fn.insertBefore(sq,fn.firstChild);
    if(strip.clearance?.sid){
      const sid=document.createElement('div'); sid.className='fn-row';
      sid.innerHTML=`<div class="fn-key">SID</div><div class="fn-val blue">${esc(strip.clearance.sid)}</div>`;
      fn.insertBefore(sid,fn.children[1]);
    }
  }
  setBar('bar-done');
  toast('pilot-toast','✅ PDC received — Squawk '+strip.squawk);
}

function showVoice() { openModal('pilot-voice-modal'); }

function submitRating() {
  if(!S.starRating){toast('pilot-toast','Pick a star rating');return;}
  socket.emit('atc:rate',{atcId:S.atcIssuerId||'unknown',stars:S.starRating,comment:document.getElementById('rate-cmt')?.value.trim()});
  closeModal('rate-modal');
  tline(`Rating submitted: ${'★'.repeat(S.starRating)} — Thank you!`,'green');
}

/* ═══════════════ CHAT ═══════════════ */
function sendChat() {
  const id = S.user.role==='atc' ? 'atc-chat-inp' : 'pilot-chat-inp';
  const input=document.getElementById(id);
  const msg=input?.value.trim();
  if(!msg||!S.room) return;
  socket.emit('chat:send',{roomId:S.room.id,message:msg});
  if(input) input.value='';
}

/* ═══════════════ PANELS / DRAWERS ═══════════════ */
function openPanel(id) {
  document.querySelectorAll('.side-panel').forEach(p=>p.classList.remove('open'));
  document.getElementById(id)?.classList.add('open');
}
function closePanel(id) {
  document.getElementById(id)?.classList.remove('open');
  if(id==='detail-panel') S.activeStripId=null;
  if(id==='pdc-panel')    S.pdcStripId=null;
}
function toggleDrawer(id) {
  const el=document.getElementById(id); if(!el) return;
  el.classList.toggle('open');
  document.querySelectorAll('.unread-btn').forEach(b=>b.classList.remove('unread'));
}

function toast(elId,msg) {
  const t=document.getElementById(elId); if(!t) return;
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),3000);
}

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    document.querySelectorAll('.side-panel.open').forEach(p=>p.classList.remove('open'));
    document.querySelectorAll('.modal-bg.open').forEach(m=>m.classList.remove('open'));
    document.querySelectorAll('.chat-drawer.open').forEach(d=>d.classList.remove('open'));
  }
  if(e.key==='n'&&!e.target.matches('input,textarea,select')&&S.room&&S.user?.role==='atc'){
    openPanel('add-panel');
    setTimeout(()=>document.getElementById('a-cs')?.focus(),50);
  }
});