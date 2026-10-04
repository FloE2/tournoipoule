// ============================================================
//  Tournoi poule — Collège Yves du Manoir de Vaucresson
//  © Eude Florian
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInAnonymously, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, onSnapshot, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import {
  uid, DEFAULT_SETTINGS, parseStudentRows, fullName, shortName, buildEntries, makePools,
  buildPoolMatches, computeStandings, computeMoves, fpPoints, parseAtpStudents, matchAtp, defiState,
} from './logic.js';
import { DEFAULT_DEFIS, SCHEMAS, courtSvg } from './defis-data.js';
import { atpConfig } from './atp-config.js';

// ---------- Initialisation ----------
const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');
const configured = !String(firebaseConfig.apiKey).includes('A_REMPLACER');

let auth, db;
if (configured) {
  const fb = initializeApp(firebaseConfig);
  auth = getAuth(fb);
  // Connexion compatible avec les filtres des réseaux scolaires (proxy) :
  // le « long polling » remplace la connexion continue souvent bloquée.
  // Pas de stockage local : un résultat n'est affiché comme enregistré que s'il est bien arrivé sur le serveur.
  db = initializeFirestore(fb, { experimentalForceLongPolling: true });
}

const APP_NAME = 'Tournoi poule';
const SCHOOL = 'Collège Yves du Manoir de Vaucresson';
const footer = () => `<footer class="credits">© ${new Date().getFullYear()} Eude Florian · ${SCHOOL}</footer>`;

const POOL_COLORS = ['#1D5FA8', '#E0A100', '#23855A', '#C23E36', '#6B4FA0', '#0F8A8A', '#D2691E', '#4E5D6C'];
const poolColor = (i) => POOL_COLORS[i % POOL_COLORS.length];
const FORMAT_LABEL = { simple: 'Simple (1 contre 1)', double: 'Double (2 contre 2)', equipe: 'Équipes' };

const S = {
  user: null, teacher: null, classes: [], active: [], activeDefi: [], history: null, defiHistory: null,
  view: 'loading', p: {}, session: null, code: null, coll: 'sessions', unsub: null, wiz: null, poolTab: 'all', dw: null, atpClasses: null,
};

// ---------- Utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (ms) => new Date(ms).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
let toastTimer;
function toast(msg, err = false) {
  $toast.textContent = msg; $toast.hidden = false; $toast.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => ($toast.hidden = true), err ? 5000 : 2500);
}
function fail(e) { console.error(e); toast('Erreur : ' + (e.message || e), true); }
const LIVE_VIEWS = ['live', 'tablet-pool', 'defi-live', 'tablet-defi'];
function go(view, p = {}) { S.view = view; S.p = p; if (!LIVE_VIEWS.includes(view)) stopLive(); render(); window.scrollTo(0, 0); }
const starsHtml = (v, attrs = '') =>
  `<span class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= v ? 'on' : ''}" data-v="${n}" ${attrs} aria-label="Niveau ${n}">★</button>`).join('')}</span>`;
const starsRo = (v) => `<span class="stars ro" title="Niveau ${v.toFixed(1)}">${'★'.repeat(Math.round(v))}</span>`;
const sexeBadge = (s) => `<span class="sexe ${s || 'X'}">${s || '?'}</span>`;

// ---------- Modales ----------
function openModal(html, cls = '') { $modal.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`; $modal.hidden = false; }
function closeModal() {
  const wasScore = S.modal?.type === 'score' || S.modal?.type === 'defi';
  $modal.hidden = true; $modal.innerHTML = ''; S.modal = null;
  if (wasScore) render(); // affiche les mises à jour reçues pendant la saisie
}
$modal.addEventListener('click', (e) => { if (e.target === $modal) closeModal(); });
function confirmBox(msg, ok = 'Confirmer', danger = true) {
  return new Promise((resolve) => {
    openModal(`<h2>${esc(msg)}</h2><div class="modal-actions"><button class="btn" id="cNo">Annuler</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cOk">${esc(ok)}</button></div>`, 'narrow');
    $modal.querySelector('#cNo').onclick = () => { closeModal(); resolve(false); };
    $modal.querySelector('#cOk').onclick = () => { closeModal(); resolve(true); };
  });
}
function promptBox(title, value = '') {
  return new Promise((resolve) => {
    openModal(`<h2>${esc(title)}</h2><input id="pIn" value="${esc(value)}" style="width:100%"><div class="modal-actions"><button class="btn" id="pNo">Annuler</button><button class="btn primary" id="pOk">Enregistrer</button></div>`, 'narrow');
    const inp = $modal.querySelector('#pIn'); inp.focus(); inp.select();
    const ok = () => { const v = inp.value.trim(); closeModal(); resolve(v || null); };
    $modal.querySelector('#pOk').onclick = ok;
    inp.onkeydown = (e) => e.key === 'Enter' && ok();
    $modal.querySelector('#pNo').onclick = () => { closeModal(); resolve(null); };
  });
}

// ---------- Données enseignant ----------
const tRef = () => doc(db, 'teachers', S.user.uid);
const classRef = (id) => doc(db, 'teachers', S.user.uid, 'classes', id);
const histCol = () => collection(db, 'teachers', S.user.uid, 'history');

async function loadTeacher() {
  const snap = await getDoc(tRef());
  if (!snap.exists()) {
    S.teacher = { name: S.user.displayName || '', email: S.user.email || '', sports: [], settings: structuredClone(DEFAULT_SETTINGS), createdAt: Date.now() };
    await setDoc(tRef(), S.teacher);
  } else {
    const t = snap.data();
    t.settings = { ...DEFAULT_SETTINGS, ...(t.settings || {}), pts: { ...DEFAULT_SETTINGS.pts, ...(t.settings?.pts || {}) } };
    t.sports = t.sports || [];
    S.teacher = t;
  }
  if (!S.teacher.defis) {
    S.teacher.defis = DEFAULT_DEFIS.map((d) => ({ id: uid(), ...d }));
    await updateDoc(tRef(), { defis: S.teacher.defis });
  }
}
async function saveTeacher(fields) { Object.assign(S.teacher, fields); await updateDoc(tRef(), fields); }
async function loadClasses() {
  const q = await getDocs(collection(db, 'teachers', S.user.uid, 'classes'));
  S.classes = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
}
async function saveClass(c) { const { id, ...data } = c; await setDoc(classRef(id), data); }
async function loadActive() {
  const q = await getDocs(query(collection(db, 'sessions'), where('ownerUid', '==', S.user.uid), where('active', '==', true)));
  S.active = q.docs.map((d) => d.data()).sort((a, b) => b.createdAt - a.createdAt);
  const q2 = await getDocs(query(collection(db, 'defiSessions'), where('ownerUid', '==', S.user.uid), where('active', '==', true)));
  S.activeDefi = q2.docs.map((d) => d.data()).sort((a, b) => b.createdAt - a.createdAt);
}
const defiHistCol = () => collection(db, 'teachers', S.user.uid, 'defiHistory');
async function loadDefiHistory(force = false) {
  if (S.defiHistory && !force) return;
  const q = await getDocs(defiHistCol());
  S.defiHistory = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.date - a.date);
}
// Code à 4 chiffres libre (tournois et défis partagent les mêmes codes)
async function freeCode() {
  for (let k = 0; k < 30; k++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const [a, b] = await Promise.all([getDoc(doc(db, 'sessions', code)), getDoc(doc(db, 'defiSessions', code))]);
    if (!a.exists() && !b.exists()) return code;
  }
  throw new Error('Impossible de trouver un code libre, réessaie.');
}
async function loadHistory(force = false) {
  if (S.history && !force) return;
  const q = await getDocs(histCol());
  S.history = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.date - a.date);
}
const getClass = (id) => S.classes.find((c) => c.id === id);

// ---------- Rendu ----------
function render() {
  if (!configured) { $app.innerHTML = vNoConfig(); return; }
  const views = {
    loading: () => '<div class="loading">Chargement…</div>',
    login: vLogin, seance: vSeance, wizard: vWizard, classes: vClasses, classe: vClasse,
    historique: vHistorique, 'histo-detail': vHistoDetail, suivi: vSuivi, reglages: vReglages,
    live: vLive, 'tablet-join': vTabletJoin, 'tablet-pool': vTabletPool,
    defis: vDefis, 'defi-live': vDefiLive, 'tablet-defi': vTabletDefi, 'defi-histo': vDefiHisto,
  };
  $app.innerHTML = (views[S.view] || views.loading)();
  updateTimers();
}

function shell(content) {
  const tabs = [['seance', 'Séances'], ['defis', 'Défi solidaire'], ['classes', 'Classes'], ['historique', 'Historique'], ['suivi', 'Suivi des élèves'], ['reglages', 'Réglages']];
  const cur = { wizard: 'seance', live: 'seance', classe: 'classes', 'histo-detail': 'historique', 'defi-live': 'defis', 'defi-histo': 'defis' }[S.view] || S.view;
  return `<header class="topbar"><div class="brand">${APP_NAME}<small>${SCHOOL}</small></div>
    <nav class="nav">${tabs.map(([v, l]) => `<button class="${cur === v ? 'on' : ''}" data-a="nav" data-v="${v}">${l}</button>`).join('')}</nav>
    <div class="who"><span>${esc(S.user?.displayName || '')}</span><button class="btn small ghost" style="color:inherit" data-a="logout">Se déconnecter</button></div>
  </header><main class="main">${content}</main>${footer()}`;
}

function vNoConfig() {
  return `<div class="hero"><div class="hero-card"><div class="hero-court"><h1>Configuration</h1><p>Une dernière étape avant de commencer</p></div>
  <div class="hero-body"><p>Ouvre le fichier <b>js/firebase-config.js</b> et colle la configuration de ton projet Firebase. Les étapes détaillées sont dans le fichier <b>README.md</b>.</p></div></div></div>`;
}

function vLogin() {
  return `<div class="hero"><div class="hero-card">
    <div class="hero-court"><h1>${APP_NAME}</h1><p>${SCHOOL}</p></div>
    <div class="hero-body">
      <button class="btn primary big" data-a="loginGoogle">Espace enseignant (compte Google)</button>
      <button class="btn big" data-a="loginTablet">Mode tablette élève</button>
      <p class="small muted">Chaque collègue se connecte avec son propre compte Google et retrouve ses classes. Les tablettes n'ont besoin que du code affiché au lancement de la séance.</p>
    </div></div>${footer()}</div>`;
}

// ---------- Vue : séances ----------
function vSeance() {
  const act = S.active.length
    ? S.active.map((s) => `<div class="panel row between"><div><h3>${esc(s.sport)} · ${esc(s.className)}</h3>
        <div class="muted small">Lancée le ${fmtDate(s.createdAt)} · code ${s.code} · ${s.pools.length} poules</div></div>
        <button class="btn primary" data-a="openLive" data-code="${s.code}">Reprendre</button></div>`).join('')
    : `<div class="empty">Aucune séance en cours.</div>`;
  return shell(`
    <div class="section-title"><h1>Séances</h1><button class="btn primary big" data-a="newSession" ${S.classes.length ? '' : 'disabled'}>Nouvelle séance</button></div>
    ${S.classes.length ? '' : `<div class="panel"><p>Commence par importer une classe dans l'onglet <b>Classes</b>.</p><button class="btn primary" data-a="nav" data-v="classes">Importer une classe</button></div>`}
    <h2>En cours</h2>${act}`);
}

// ---------- Vue : classes ----------
function vClasses() {
  const list = S.classes.length
    ? `<div class="grid">${S.classes.map((c) => {
        const f = c.students.filter((s) => s.sexe === 'F').length;
        return `<button class="panel" style="text-align:left;border:0;cursor:pointer;font:inherit;color:inherit" data-a="openClass" data-id="${c.id}">
          <h2>${esc(c.name)}</h2><div class="muted">${c.students.length} élèves · ${f} filles · ${c.students.length - f} garçons</div></button>`;
      }).join('')}</div>`
    : `<div class="empty">Aucune classe pour l'instant.</div>`;
  return shell(`
    <h1>Classes</h1>
    <div class="panel"><h3>Importer une classe depuis Excel</h3>
      <p class="small muted">Colonnes attendues : Nom, Prénom, Sexe (F ou G). La première ligne peut contenir les titres des colonnes.${S.teacher.settings.truncateNames ? ' Les noms seront réduits à leur initiale (réglage RGPD activé).' : ''}</p>
      <div class="row"><label class="f">Nom de la classe<input id="newClassName" placeholder="ex. 4e B"></label>
      <label class="f">Fichier<input type="file" id="newClassFile" accept=".xlsx,.xls,.csv,.ods"></label>
      <button class="btn primary" data-a="importClass">Importer</button>
      <button class="btn" data-a="emptyClass">Créer une classe vide</button></div>
    </div>
    <div class="section-title"><h2>Mes classes</h2></div>${list}`);
}

function vClasse() {
  const c = getClass(S.p.id);
  if (!c) return shell('<div class="empty">Classe introuvable.</div>');
  const sort = S.p.sort || 'nom';
  const st = [...c.students].sort(sort === 'niveau'
    ? (a, b) => b.niveau - a.niveau || a.nom.localeCompare(b.nom, 'fr')
    : (a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'));
  return shell(`
    <div class="section-title"><div class="row"><button class="btn ghost" data-a="nav" data-v="classes">‹ Classes</button><h1 style="margin:0">${esc(c.name)}</h1>
      <button class="icon-btn" data-a="renameClass" title="Renommer">✎</button></div>
      <button class="btn danger" data-a="deleteClass">Supprimer la classe</button></div>
    <div class="panel"><h3>Ajouter des élèves</h3><div class="row">
      <input id="addNom" placeholder="Nom"><input id="addPrenom" placeholder="Prénom">
      <select id="addSexe"><option value="F">Fille</option><option value="G">Garçon</option></select>
      <button class="btn primary" data-a="addStudent">Ajouter</button>
      <span class="muted">ou</span>
      <input type="file" id="moreFile" accept=".xlsx,.xls,.csv,.ods"><button class="btn" data-a="importMore">Importer un fichier</button></div></div>
    <div class="panel"><div class="row between"><h3>${c.students.length} élèves</h3>
      <div class="seg"><button class="${sort === 'nom' ? 'on' : ''}" data-a="sortClass" data-v="nom">Par nom</button><button class="${sort === 'niveau' ? 'on' : ''}" data-a="sortClass" data-v="niveau">Par niveau</button></div></div>
      <p class="small muted">Clique sur les étoiles pour régler le niveau, sur F/G pour changer le sexe. Les modifications sont enregistrées automatiquement.</p>
      <div class="table-wrap"><table><thead><tr><th>Nom</th><th>Prénom</th><th class="num">Sexe</th><th>Niveau</th><th></th></tr></thead><tbody>
      ${st.map((s) => `<tr><td><input value="${esc(s.nom)}" data-a-change="editStudent" data-sid="${s.id}" data-field="nom"></td>
        <td><input value="${esc(s.prenom)}" data-a-change="editStudent" data-sid="${s.id}" data-field="prenom"></td>
        <td class="num"><button class="sexe ${s.sexe || 'X'}" data-a="toggleSexe" data-sid="${s.id}">${s.sexe || '?'}</button></td>
        <td>${starsHtml(s.niveau, `data-a="setLevel" data-cid="${c.id}" data-sid="${s.id}"`)}</td>
        <td><button class="icon-btn" data-a="delStudent" data-sid="${s.id}" title="Supprimer">✕</button></td></tr>`).join('')}
      </tbody></table></div></div>`);
}

// ---------- Vue : nouvelle séance ----------
function newWizard() {
  const s = S.teacher.settings;
  const c = S.classes[0];
  S.wiz = {
    classId: c.id, sportId: S.teacher.sports[0]?.id || '', format: S.teacher.sports[0]?.format || 'simple',
    teamSize: S.teacher.sports[0]?.format === 'equipe' ? S.teacher.sports[0].teamSize || 4 : 4, status: {}, nPools: 3, mode: 'homogene', mixite: 'indifferent',
    base: 'niveaux', courts: 1, roles: s.roles.join(', '), preview: null,
  };
}
function wizCounts() {
  const c = getClass(S.wiz.classId);
  const present = c.students.filter((s) => (S.wiz.status[s.id] || 'present') === 'present');
  const ts = S.wiz.format === 'simple' ? 1 : S.wiz.format === 'double' ? 2 : Math.max(2, +S.wiz.teamSize || 2);
  const nEntries = ts === 1 ? present.length : Math.max(1, Math.floor(present.length / ts));
  return { c, present, ts, nEntries };
}
function lastHistoryFor(classId) { return (S.history || []).find((h) => h.classId === classId); }

function vWizard() {
  const w = S.wiz;
  const { c, present, ts, nEntries } = wizCounts();
  const sport = S.teacher.sports.find((x) => x.id === w.sportId);
  const nP = Math.max(1, Math.min(+w.nPools || 1, nEntries));
  const minS = Math.floor(nEntries / nP), maxS = Math.ceil(nEntries / nP);
  const last = lastHistoryFor(w.classId);
  const statusLabel = { present: 'Présent', absent: 'Absent', dispense: 'Dispensé' };
  const nAbs = c.students.filter((s) => w.status[s.id] === 'absent').length;
  const nDisp = c.students.filter((s) => w.status[s.id] === 'dispense').length;

  let html = `<div class="section-title"><div class="row"><button class="btn ghost" data-a="nav" data-v="seance">‹ Séances</button><h1 style="margin:0">Nouvelle séance</h1></div></div>
  <div class="panel"><h3>Classe et activité</h3><div class="row">
    <label class="f">Classe<select data-bind="classId" data-rerender>${S.classes.map((x) => `<option value="${x.id}" ${x.id === w.classId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="f">Activité<select data-a-change="pickSport">${S.teacher.sports.length ? '' : '<option value="">— ajoute une activité —</option>'}
      ${S.teacher.sports.map((x) => `<option value="${x.id}" ${x.id === w.sportId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="f">Format de jeu<select data-bind="format" data-rerender>${Object.entries(FORMAT_LABEL).map(([k, l]) => `<option value="${k}" ${k === w.format ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${w.format === 'equipe' ? `<label class="f">Joueurs par équipe<input type="number" min="2" max="12" value="${w.teamSize}" data-bind="teamSize" data-rerender></label>` : ''}
  </div>
  <details style="margin-top:.8rem"><summary class="small" style="cursor:pointer">Ajouter une nouvelle activité</summary>
    <div class="row" style="margin-top:.6rem"><input id="newSportName" placeholder="ex. Badminton">
    <select id="newSportFormat"><option value="simple">Simple par défaut</option><option value="double">Double par défaut</option><option value="equipe">Équipes par défaut</option></select>
    <button class="btn" data-a="addSport">Enregistrer l'activité</button></div></details>
  ${sport ? '' : '<p class="small muted" style="margin-top:.6rem">Choisis ou crée une activité : elle sera gardée en mémoire pour les prochaines séances.</p>'}
  </div>

  <div class="panel"><div class="row between"><h3>Présences et niveaux</h3>
    <span class="muted">${present.length} présents · ${nAbs} absents · ${nDisp} dispensés</span></div>
    <p class="small muted">Touche le statut pour passer de Présent à Absent puis Dispensé. Les dispensés reçoivent des rôles d'arbitre, de coach ou d'observateur.</p>
    <div class="table-wrap"><table><tbody>
    ${[...c.students].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((s) => {
      const st = w.status[s.id] || 'present';
      return `<tr class="${st === 'absent' ? 'is-absent' : ''}"><td>${esc(fullName(s))}</td><td>${sexeBadge(s.sexe)}</td>
        <td>${starsHtml(s.niveau, `data-a="setLevel" data-cid="${c.id}" data-sid="${s.id}"`)}</td>
        <td style="text-align:right"><button class="btn small status ${st}" data-a="cycleStatus" data-sid="${s.id}">${statusLabel[st]}</button></td></tr>`;
    }).join('')}</tbody></table></div></div>

  <div class="panel"><h3>Organisation des poules</h3><div class="row" style="align-items:flex-end">
    <label class="f">Nombre de poules<input type="number" min="1" max="${Math.max(1, nEntries)}" value="${nP}" data-bind="nPools" data-rerender></label>
    <label class="f">ou ${ts === 1 ? 'joueurs' : 'équipes'} par poule<input type="number" min="2" value="${maxS}" data-a-change="setPoolSize"></label>
    <div class="muted" style="padding-bottom:.6rem">${nEntries} ${ts === 1 ? 'joueurs' : 'équipes'} → ${nP} poule${nP > 1 ? 's' : ''} de ${minS === maxS ? minS : minS + ' à ' + maxS}</div>
    <label class="f">Terrains par poule<input type="number" min="1" max="6" value="${w.courts}" data-bind="courts"></label>
  </div>
  <div class="row" style="margin-top:1rem">
    <div><div class="small" style="font-weight:600;margin-bottom:.3rem">Niveau des poules</div><div class="seg">
      <button class="${w.mode === 'homogene' ? 'on' : ''}" data-a="setWiz" data-k="mode" data-v="homogene">Homogènes (par niveau)</button>
      <button class="${w.mode === 'equilibre' ? 'on' : ''}" data-a="setWiz" data-k="mode" data-v="equilibre">Équilibrées (hétérogènes)</button></div></div>
    <div><div class="small" style="font-weight:600;margin-bottom:.3rem">Mixité</div><div class="seg">
      <button class="${w.mixite === 'indifferent' ? 'on' : ''}" data-a="setWiz" data-k="mixite" data-v="indifferent">Indifférent</button>
      <button class="${w.mixite === 'mixte' ? 'on' : ''}" data-a="setWiz" data-k="mixite" data-v="mixte">Mixte</button>
      <button class="${w.mixite === 'separe' ? 'on' : ''}" data-a="setWiz" data-k="mixite" data-v="separe">Filles / garçons séparés</button></div></div>
  </div>
  <div class="row" style="margin-top:1rem">
    <div><div class="small" style="font-weight:600;margin-bottom:.3rem">Répartir selon</div><div class="seg">
      <button class="${w.base === 'niveaux' ? 'on' : ''}" data-a="setWiz" data-k="base" data-v="niveaux">Les étoiles</button>
      <button class="${w.base === 'historique' ? 'on' : ''}" data-a="setWiz" data-k="base" data-v="historique" ${last ? '' : 'disabled'}>Montées/descentes de la dernière séance</button>
      <button class="${w.base === 'atp' ? 'on' : ''}" data-a="setWiz" data-k="base" data-v="atp">Classement ATP</button></div>
      ${last ? `<div class="small muted" style="margin-top:.3rem">Dernière séance : ${fmtDate(last.date)} (${esc(last.sport)})</div>` : ''}</div>
    <label class="f" style="flex:1;min-width:260px">Rôles des joueurs au repos (séparés par des virgules)<input value="${esc(w.roles)}" data-bind="roles"></label>
  </div>
  ${w.base === 'atp' ? atpPanel(c) : ''}
  <div class="row" style="margin-top:1.2rem"><button class="btn primary big" data-a="genPools" ${present.length < 2 || !sport || (w.base === 'atp' && !w.atp) ? 'disabled' : ''}>${w.preview ? 'Regénérer les poules' : 'Générer les poules'}</button></div>
  </div>`;

  if (w.preview) html += vPreview();
  return shell(html);
}

function entryLabel(e, people) {
  return e.members.map((pid) => shortName(people[pid])).join(' · ');
}
function vPreview() {
  const { pools, entries, people } = S.wiz.preview;
  return `<div class="section-title"><h2>Aperçu des poules</h2><span class="muted small">La première poule est la plus forte. Renomme les poules, déplace un joueur ou change l'ordre avant de lancer.</span></div>
  <div class="grid">${pools.map((p, i) => {
    const lvl = (e) => e.members.reduce((s, pid) => s + (people[pid]?.niveau || 3), 0) / e.members.length;
    return `<div class="pool" style="--pc:${poolColor(i)}">
      <div class="pool-head"><input value="${esc(p.name)}" data-bind="preview.pools.${i}.name" aria-label="Nom de la poule">
        <button class="icon-btn" data-a="movePool" data-i="${i}" data-d="-1" title="Monter" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="icon-btn" data-a="movePool" data-i="${i}" data-d="1" title="Descendre" ${i === pools.length - 1 ? 'disabled' : ''}>▼</button></div>
      <div class="small muted">${p.entryIds.length} ${S.wiz.format === 'simple' ? 'joueurs' : 'équipes'}</div>
      ${p.entryIds.map((eid) => {
        const e = entries[eid];
        return `<div class="entry"><div class="who-names">${e.name && S.wiz.format !== 'simple' ? `<b>${esc(e.name)}</b><br><span class="small">${esc(entryLabel(e, people))}</span>` : esc(entryLabel(e, people))}</div>
          ${S.wiz.base === 'atp' && S.wiz.atp ? e.members.map((pid) => { const a = S.wiz.atp.list.find((x) => x.sid === pid); return a ? `<span class="tag" title="Rang ATP">#${a.rank}</span>` : ''; }).join('') : starsRo(lvl(e))}
          <select data-a-change="moveEntry" data-eid="${eid}" aria-label="Déplacer">${pools.map((q, j) => `<option value="${j}" ${j === i ? 'selected' : ''}>${j === i ? 'Déplacer…' : esc(q.name)}</option>`).join('')}</select></div>`;
      }).join('')}
      ${p.officials.length ? `<div class="small" style="margin-top:.5rem"><span class="tag">Dispensés</span> ${p.officials.map((pid) => esc(shortName(people[pid]))).join(', ')}</div>` : ''}
    </div>`;
  }).join('')}</div>
  <div class="row" style="margin-top:1.4rem"><button class="btn go big" data-a="launch">Lancer la séance</button></div>`;
}

function generatePreview() {
  const w = S.wiz;
  const { c, present, ts } = wizCounts();
  const nP = Math.max(1, +w.nPools || 1);
  const last = w.base === 'historique' ? lastHistoryFor(w.classId) : null;
  const atpRank = w.base === 'atp' && w.atp ? Object.fromEntries(w.atp.list.filter((a) => a.sid).map((a) => [a.sid, a.rank])) : null;
  const players = present.map((s) => {
    let rankKey;
    const h = last?.moves?.[s.id];
    if (atpRank) return { ...s, rankKey: (atpRank[s.id] ?? 1000 - s.niveau) + Math.random() * 0.01 };
    if (h) rankKey = (h.pos + h.move) * 100 - s.niveau;
    else if (last) rankKey = ((5 - s.niveau) / 4) * (nP - 1) * 100 - s.niveau;
    else rankKey = -s.niveau;
    return { ...s, rankKey: rankKey + Math.random() * 0.9 };
  });
  const opts = { mode: w.mode, mixite: w.mixite };
  const list = buildEntries(players, ts, opts);
  const pools = makePools(list, nP, opts);
  const people = {};
  c.students.filter((s) => (w.status[s.id] || 'present') !== 'absent')
    .forEach((s) => (people[s.id] = { nom: s.nom, prenom: s.prenom, sexe: s.sexe || '', niveau: s.niveau }));
  const entries = {};
  let n = 0;
  pools.forEach((p) => p.entryIds.forEach((eid) => {
    const e = list.find((x) => x.id === eid);
    n++;
    entries[eid] = { members: e.members, name: w.format === 'simple' ? '' : w.format === 'double' ? e.members.map((pid) => shortName(people[pid])).join(' & ') : `Équipe ${n}` };
  }));
  const disp = c.students.filter((s) => w.status[s.id] === 'dispense');
  disp.forEach((s, i) => pools[i % pools.length].officials.push(s.id));
  w.preview = { pools, entries, people };
}

// ---------- Séance en direct ----------
function stopLive() { if (S.unsub) { S.unsub(); S.unsub = null; } S.session = null; }
function listenSession(code, viewName, extra = {}, coll = 'sessions') {
  stopLive();
  S.code = code; S.coll = coll;
  S.view = viewName; S.p = extra;
  render();
  subscribe();
}
// Abonnement temps réel à la séance (relançable après une mise en veille)
function subscribe() {
  if (S.unsub) S.unsub();
  const code = S.code, viewName = S.view;
  setSync('wait');
  S.unsub = onSnapshot(doc(db, S.coll, code), { includeMetadataChanges: true }, (snap) => {
    S.lastSync = Date.now();
    setSync(snap.metadata.fromCache ? 'wait' : snap.metadata.hasPendingWrites ? 'send' : 'ok');
    if (!snap.exists() || !snap.data().active) {
      if (snap.metadata.fromCache) return; // pas encore la réponse du serveur
      if (viewName === 'tablet-pool' || viewName === 'tablet-defi') { localStorage.removeItem('tournoiCode'); toast('La séance est terminée.'); go('tablet-join'); }
      else if (S.view === 'live') { go('seance'); }
      else if (S.view === 'defi-live') { go('defis'); }
      return;
    }
    const data = snap.data();
    const changed = JSON.stringify(data) !== JSON.stringify(S.session);
    S.session = data;
    if (!changed) return; // simple changement d'état de connexion
    if (!$modal.hidden && (S.modal?.type === 'score' || S.modal?.type === 'defi')) return; // ne pas perturber une saisie en cours
    render();
  }, (e) => { setSync('err'); fail(e); });
}
// Voyant de connexion
const SYNC_LABEL = { ok: 'En direct', wait: 'Connexion…', send: 'Envoi…', err: 'Hors ligne', off: 'Pas de wifi' };
function setSync(state) {
  S.sync = navigator.onLine === false ? 'off' : state;
  document.querySelectorAll('[data-sync]').forEach((el) => { el.className = 'sync ' + S.sync; el.querySelector('span').textContent = SYNC_LABEL[S.sync]; });
}
const syncBadge = () => `<button class="sync ${S.sync || 'wait'}" data-sync data-a="resync" title="Toucher pour relancer la connexion"><i></i><span>${SYNC_LABEL[S.sync || 'wait']}</span></button>`;
// Après une mise en veille de l'iPad ou une coupure wifi : on se reconnecte
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.code && S.unsub) subscribe(); });
window.addEventListener('online', () => { if (S.code && S.unsub) subscribe(); });
window.addEventListener('offline', () => setSync('off'));
const sesRef = () => doc(db, S.coll, S.code);
const personName = (pid) => shortName(S.session.people[pid]);
function entryName(eid) {
  const e = S.session.entries[eid];
  if (!e) return '?';
  return e.name || e.members.map(personName).join(' & ');
}
function poolMatches(poolId) {
  return Object.values(S.session.matches || {}).filter((m) => m.pool === poolId).sort((a, b) => a.slot - b.slot || a.court - b.court);
}

function vLive() {
  const s = S.session;
  if (!s) return shell('<div class="loading">Connexion à la séance…</div>');
  const all = Object.values(s.matches || {});
  const done = all.filter((m) => m.done).length;
  const tab = S.poolTab;
  const body = tab === 'all' || !s.pools.find((p) => p.id === tab) ? vOverview(true) : vPool(tab, true);
  return shell(`
    <div class="live-bar">
      <div><h1 style="margin:0">${esc(s.sport)} · ${esc(s.className)}</h1>
        <div class="muted">${FORMAT_LABEL[s.format.type]}${s.format.type === 'equipe' ? ' de ' + s.format.teamSize : ''} · ${done}/${all.length} matchs joués</div></div>
      <div class="code-box"><span class="small">Code tablette</span><b>${s.code}</b></div>
      ${syncBadge()}
      ${timerHtml(true)}
      <div class="row"><button class="btn go" data-a="endSession">Terminer et archiver</button>
      <button class="btn danger small" data-a="abortSession">Supprimer</button></div>
    </div>
    <div class="tabs"><button class="tab ${tab === 'all' ? 'on' : ''}" data-a="poolTab" data-v="all" style="--pc:var(--ink)">Vue d'ensemble</button>
      ${s.pools.map((p, i) => `<button class="tab ${tab === p.id ? 'on' : ''}" data-a="poolTab" data-v="${p.id}" style="--pc:${poolColor(i)}">${esc(p.name)}</button>`).join('')}</div>
    ${body}`);
}

function movesFor(s) { try { return computeMoves(s); } catch { return {}; } }

function standingsTable(pool, s, compact = false) {
  const st = computeStandings(pool.entryIds, poolMatches(pool.id), s.settings.pts);
  const moves = movesFor(s);
  const mv = (eid) => {
    const m = moves[s.entries[eid]?.members[0]]?.move;
    return m === -1 ? '<span class="mv up" title="Propose de monter">▲</span>' : m === 1 ? '<span class="mv down" title="Propose de descendre">▼</span>' : '';
  };
  return `<div class="table-wrap"><table class="standings"><thead><tr><th class="num">#</th><th>${s.format.type === 'simple' ? 'Joueur' : 'Équipe'}</th>
    <th class="num">J</th>${compact ? '' : '<th class="num">V</th><th class="num">N</th><th class="num">D</th><th class="num">Diff</th>'}<th class="num" title="Bonus/malus fair-play">FP</th><th class="num">Pts</th><th></th></tr></thead><tbody>
    ${st.map((r) => `<tr><td class="rank">${r.rank}</td><td class="name">${esc(entryName(r.id))}</td><td class="num">${r.j}</td>
      ${compact ? '' : `<td class="num">${r.v}</td><td class="num">${r.n}</td><td class="num">${r.d + r.f}</td><td class="num">${r.pm - r.pc > 0 ? '+' : ''}${r.pm - r.pc}</td>`}
      <td class="num ${r.fp > 0 ? 'fp-pos' : r.fp < 0 ? 'fp-neg' : ''}">${r.fp > 0 ? '+' : ''}${r.fp}</td><td class="pts">${r.pts}</td><td>${mv(r.id)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function vOverview() {
  const s = S.session;
  return `<div class="overview">${s.pools.map((p, i) => {
    const ms = poolMatches(p.id);
    const d = ms.filter((m) => m.done).length;
    return `<div class="pool" style="--pc:${poolColor(i)}"><div class="pool-head"><span class="pool-name">${esc(p.name)}</span><span class="muted small">${d}/${ms.length} matchs</span></div>
      <div class="progress"><i style="width:${ms.length ? (100 * d) / ms.length : 0}%"></i></div>${standingsTable(p, s, true)}
      <button class="btn small" style="margin-top:.6rem" data-a="poolTab" data-v="${p.id}">Voir les rencontres</button></div>`;
  }).join('')}</div>`;
}

const FP_ICON = { '-1': '😠', '0': '', '1': '🌟' };
function vPool(poolId, teacher) {
  const s = S.session;
  const idx = s.pools.findIndex((p) => p.id === poolId);
  const pool = s.pools[idx];
  const ms = poolMatches(poolId);
  const slots = [...new Set(ms.map((m) => m.slot))];
  const currentSlot = ms.find((m) => !m.done)?.slot;
  const resting = (slot) => {
    const playing = new Set(ms.filter((m) => m.slot === slot).flatMap((m) => [...s.entries[m.a].members, ...s.entries[m.b].members]));
    const withRole = new Set(ms.filter((m) => m.slot === slot).flatMap((m) => Object.values(m.roles || {})));
    const all = [...pool.entryIds.flatMap((e) => s.entries[e].members), ...(pool.officials || [])];
    return all.filter((p) => !playing.has(p) && !withRole.has(p));
  };
  const matchHtml = (m) => {
    const wA = m.done && (m.forfait === 'B' || (!m.forfait && +m.scoreA > +m.scoreB));
    const wB = m.done && (m.forfait === 'A' || (!m.forfait && +m.scoreB > +m.scoreA));
    const score = m.done ? (m.forfait ? `<span class="small">forfait</span>` : `${m.scoreA} – ${m.scoreB}`) : 'à jouer';
    const roles = Object.entries(m.roles || {}).filter(([, v]) => v);
    return `<div class="match ${m.done ? 'done' : ''}">
      <div class="side a ${wA ? 'win' : ''}">${esc(entryName(m.a))} ${m.done ? `<span class="fp-ico">${FP_ICON[m.fpA || 0]}</span>` : ''}</div>
      <div class="score ${m.done ? '' : 'todo'}">${score}</div>
      <div class="side b ${wB ? 'win' : ''}">${m.done ? `<span class="fp-ico">${FP_ICON[m.fpB || 0]}</span>` : ''} ${esc(entryName(m.b))}</div>
      <div class="act row" style="gap:.2rem;justify-content:flex-end"><button class="btn small ${m.done ? '' : 'primary'}" data-a="openScore" data-mid="${m.id}">${m.done ? 'Modifier' : 'Saisir'}</button>
        ${teacher ? `<button class="icon-btn" data-a="editRoles" data-mid="${m.id}" title="Modifier les rôles">👥</button>` : ''}</div>
      ${roles.length ? `<div class="roles">${roles.map(([r, p]) => `<span class="role-chip"><b>${esc(r)}</b> ${esc(personName(p))}</span>`).join('')}</div>` : ''}
    </div>`;
  };
  return `<div class="pool-layout">
    <div class="pool" style="--pc:${poolColor(idx)}"><div class="pool-head"><span class="pool-name">${esc(pool.name)}</span>
      ${teacher ? `<button class="icon-btn" data-a="renamePool" data-pid="${pool.id}" title="Renommer la poule">✎</button>` : ''}</div>
      ${standingsTable(pool, s)}
      <p class="small muted" style="margin-top:.6rem">Victoire ${s.settings.pts.victoire} pts · nul ${s.settings.pts.nul} · défaite ${s.settings.pts.defaite} · forfait ${s.settings.pts.forfait}. Fair-play : 🌟 +${s.settings.pts.bonus}, 😠 −${s.settings.pts.malus}. ▲ ▼ = proposition de montée ou de descente.</p>
      ${pool.officials?.length ? `<p class="small"><span class="tag">Dispensés</span> ${pool.officials.map((p) => esc(personName(p))).join(', ')}</p>` : ''}
    </div>
    <div class="pool" style="--pc:${poolColor(idx)}"><h3>Rencontres</h3>
      ${ms.length ? slots.map((sl) => {
        const rest = resting(sl);
        return `<div class="rot ${sl === currentSlot ? 'current' : ''}"><div class="rot-title">Rotation ${sl}${sl === currentSlot ? ' · en cours' : ''}</div>
        ${ms.filter((m) => m.slot === sl).map(matchHtml).join('')}
        ${rest.length ? `<div class="small muted">Au repos : ${rest.map((p) => esc(personName(p))).join(', ')}</div>` : ''}</div>`;
      }).join('') : '<div class="empty">Pas assez de participants pour des rencontres.</div>'}
    </div></div>`;
}

// ---------- Saisie de score ----------
function openScore(mid) {
  const m = S.session.matches[mid];
  S.modal = { type: 'score', m: { ...m, scoreA: m.scoreA ?? 0, scoreB: m.scoreB ?? 0 } };
  renderScoreModal();
}
function renderScoreModal() {
  const m = S.modal.m, s = S.session;
  const pts = s.settings.pts;
  const side = (k, eid) => {
    const fp = m['fp' + k] || 0;
    return `<div class="score-side"><h3>${esc(entryName(eid))}</h3>
      <div class="counter"><button data-a="sc" data-k="${k}" data-d="-1" aria-label="Moins">−</button>
        <input type="number" inputmode="numeric" min="0" value="${m['score' + k]}" data-a-input="scIn" data-k="${k}" aria-label="Score">
        <button data-a="sc" data-k="${k}" data-d="1" aria-label="Plus">+</button></div>
      <div class="fp-choice">
        <button class="neg ${fp === -1 ? 'on' : ''}" data-a="fp" data-k="${k}" data-v="-1"><span>😠</span>Conteste −${pts.malus}</button>
        <button class="zero ${fp === 0 ? 'on' : ''}" data-a="fp" data-k="${k}" data-v="0"><span>😐</span>Normal</button>
        <button class="pos ${fp === 1 ? 'on' : ''}" data-a="fp" data-k="${k}" data-v="1"><span>🌟</span>Exemplaire +${pts.bonus}</button></div>
      <div class="ff"><button class="btn small ${m.forfait === k ? 'danger' : 'ghost'}" data-a="ff" data-k="${k}">${m.forfait === k ? '✓ Forfait' : 'Déclarer forfait'}</button></div>
    </div>`;
  };
  openModal(`<h2>Résultat du match</h2>
    <p class="small muted">Saisir le score puis l'état d'esprit de chaque ${s.format.type === 'simple' ? 'joueur' : 'équipe'} face aux décisions de l'arbitre.</p>
    <div class="score-entry">${side('A', m.a)}${side('B', m.b)}</div>
    <div class="modal-actions">
      <div class="row">${m.done ? '<button class="btn danger" data-a="scoreClear">Effacer le résultat</button>' : ''}</div>
      <div class="row"><button class="btn" data-a="closeModal">Annuler</button><button class="btn go big" data-a="scoreSave">Valider</button></div>
    </div>`);
  S.modal = { ...S.modal, type: 'score' };
}
async function saveMatch(m) {
  setSync('send');
  const slow = setTimeout(() => toast("Résultat pas encore reçu par l'ordinateur : vérifie le wifi. Ne ferme pas la page, il sera envoyé dès le retour de la connexion.", true), 6000);
  try { await updateDoc(sesRef(), { [`matches.${m.id}`]: m, updatedAt: Date.now() }); setSync('ok'); }
  finally { clearTimeout(slow); }
}

function openRoles(mid) {
  const s = S.session, m = s.matches[mid];
  const pool = s.pools.find((p) => p.id === m.pool);
  const people = [...pool.entryIds.flatMap((e) => s.entries[e].members), ...(pool.officials || [])];
  const roles = [...new Set([...s.settings.roles, ...Object.keys(m.roles || {})])];
  S.modal = { type: 'roles', mid };
  openModal(`<h2>Rôles · ${esc(entryName(m.a))} contre ${esc(entryName(m.b))}</h2>
    <div class="stack">${roles.map((r) => `<label class="f">${esc(r)}<select data-role="${esc(r)}"><option value="">— personne —</option>
      ${people.map((p) => `<option value="${p}" ${m.roles?.[r] === p ? 'selected' : ''}>${esc(personName(p))}</option>`).join('')}</select></label>`).join('')}
      <label class="f">Ajouter un rôle pour ce match<input id="extraRole" placeholder="ex. Chronométreur"></label></div>
    <div class="modal-actions"><span></span><div class="row"><button class="btn" data-a="closeModal">Annuler</button><button class="btn primary" data-a="rolesSave">Enregistrer</button></div></div>`, 'narrow');
}

// ---------- Chronomètre partagé ----------
function timerState() {
  const t = S.session?.timer || { duration: 600, endAt: null, remaining: 600000 };
  const left = t.endAt ? t.endAt - Date.now() : t.remaining;
  return { t, left, running: !!t.endAt };
}
function fmtClock(ms) {
  const neg = ms < 0; const s = Math.ceil(Math.abs(ms) / 1000);
  return `${neg ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function timerHtml(teacher) {
  if (!S.session) return '';
  const { t, left, running } = timerState();
  return `<div class="timer"><span class="timer-display ${running ? 'run' : ''}" data-timer>${fmtClock(left)}</span>
    ${teacher ? `<div class="row" style="gap:.3rem">
      ${running ? '<button class="btn small" data-a="tPause">Pause</button>' : '<button class="btn small primary" data-a="tStart">Démarrer</button>'}
      <button class="btn small" data-a="tReset">Remettre</button>
      <input type="number" min="1" max="60" value="${Math.round(t.duration / 60)}" data-a-change="tDur" title="Durée d'une rotation (minutes)" style="width:4.5rem;min-height:34px"> min</div>` : ''}</div>`;
}
let beepedFor = null;
let audioCtx = null; // créé au premier toucher (obligatoire sur tablette)
document.addEventListener('pointerdown', () => {
  try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch { /* ignore */ }
});
function beep() {
  try {
    const ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((d) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.3, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.3);
      o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.3);
    });
  } catch { /* son indisponible */ }
}
function updateTimers() {
  const els = document.querySelectorAll('[data-timer]');
  if (!els.length || !S.session) return;
  const { t, left, running } = timerState();
  els.forEach((el) => { el.textContent = fmtClock(left); el.classList.toggle('over', running && left <= 0); el.classList.toggle('run', running && left > 0); });
  if (running && left <= 0 && beepedFor !== t.endAt) {
    beepedFor = t.endAt; beep();
    if (S.view === 'tablet-defi' || S.view === 'defi-live') render(); // bloque les validations à la fin du temps
  }
}
setInterval(updateTimers, 500);

// ---------- Tablette ----------
function vTabletJoin() {
  return `<div class="hero"><div class="hero-card"><div class="hero-court"><h1>Tablette</h1><p>Entre le code affiché sur l'ordinateur du professeur</p></div>
    <div class="hero-body"><input class="code-input" id="codeIn" inputmode="numeric" maxlength="4" placeholder="····" autocomplete="off">
    <button class="btn primary big" data-a="joinCode">Rejoindre la séance</button>
    <button class="btn ghost small" data-a="logout">Quitter le mode tablette</button></div></div>${footer()}</div>`;
}
function vTabletPool() {
  const s = S.session;
  if (!s) return '<div class="loading">Connexion à la séance…</div>';
  const poolId = S.p.pool;
  const header = `<header class="topbar"><div class="brand">${esc(s.sport)}</div><div class="nav"></div>
    ${syncBadge()}${timerHtml(false)}<button class="btn small ghost" style="color:inherit" data-a="tabletChangePool">Changer de poule</button></header>`;
  if (!poolId || !s.pools.find((p) => p.id === poolId)) {
    return `${header}<main class="main"><h1>Choisis ta poule</h1><div class="pool-pick">${s.pools.map((p, i) =>
      `<button data-a="tabletPool" data-pid="${p.id}" style="--pc:${poolColor(i)}">${esc(p.name)}</button>`).join('')}</div>
      <p style="margin-top:2rem"><button class="btn ghost small" data-a="tabletLeave">Quitter cette séance</button></p></main>${footer()}`;
  }
  return `${header}<main class="main">${vPool(poolId, false)}</main>${footer()}`;
}

// ---------- Historique ----------
function vHistorique() {
  if (!S.history) { loadHistory().then(render).catch(fail); return shell('<div class="loading">Chargement…</div>'); }
  const f = S.p.classId || '';
  const list = S.history.filter((h) => !f || h.classId === f);
  return shell(`<div class="section-title"><h1>Historique</h1>
    <select data-a-change="histFilter"><option value="">Toutes les classes</option>${S.classes.map((c) => `<option value="${c.id}" ${c.id === f ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    ${list.length ? `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Classe</th><th>Activité</th><th class="num">Poules</th><th class="num">Matchs</th><th></th></tr></thead><tbody>
    ${list.map((h) => {
      const ms = Object.values(h.session.matches || {});
      return `<tr><td>${fmtDate(h.date)}</td><td>${esc(h.className)}</td><td>${esc(h.sport)}</td><td class="num">${h.session.pools.length}</td>
      <td class="num">${ms.filter((m) => m.done).length}/${ms.length}</td><td style="text-align:right"><button class="btn small" data-a="openHist" data-id="${h.id}">Voir</button></td></tr>`;
    }).join('')}</tbody></table></div></div>` : '<div class="empty">Aucune séance archivée.</div>'}`);
}

function vHistoDetail() {
  const h = (S.history || []).find((x) => x.id === S.p.id);
  if (!h) return shell('<div class="empty">Séance introuvable.</div>');
  const s = h.session;
  const prev = S.session; S.session = s; // réutilise les fonctions d'affichage
  const moves = h.moves || {};
  const nameOf = (pid) => shortName(s.people[pid]);
  const byGroup = {};
  s.pools.forEach((p, i) => (byGroup[p.group] = byGroup[p.group] || []).push({ p, i }));
  const prop = Object.values(byGroup).map((list) => list.map(({ p, i }) => {
    const members = [...p.entryIds.flatMap((e) => s.entries[e].members)];
    const up = members.filter((m) => moves[m]?.move === -1), down = members.filter((m) => moves[m]?.move === 1);
    return `<div class="pool" style="--pc:${poolColor(i)}"><div class="pool-name">${esc(p.name)}</div><ul class="moves-list">
      ${up.length ? `<li><span class="mv up">▲ Montent</span> vers ${esc(list[list.findIndex((x) => x.p.id === p.id) - 1]?.p.name || '')} : ${up.map(nameOf).map(esc).join(', ')}</li>` : ''}
      ${down.length ? `<li><span class="mv down">▼ Descendent</span> vers ${esc(list[list.findIndex((x) => x.p.id === p.id) + 1]?.p.name || '')} : ${down.map(nameOf).map(esc).join(', ')}</li>` : ''}
      ${!up.length && !down.length ? '<li class="muted">Aucun mouvement</li>' : ''}</ul></div>`;
  }).join('')).join('');
  const html = shell(`<div class="section-title"><div class="row"><button class="btn ghost" data-a="nav" data-v="historique">‹ Historique</button>
    <h1 style="margin:0">${esc(h.sport)} · ${esc(h.className)}</h1></div><span class="muted">${fmtDate(h.date)}</span></div>
    <div class="row" style="margin-bottom:1rem"><button class="btn" data-a="reopenHist" data-id="${h.id}">Rouvrir pour modifier</button>
      <button class="btn" data-a="exportHist" data-id="${h.id}">Exporter en Excel</button>
      <button class="btn danger" data-a="deleteHist" data-id="${h.id}">Supprimer</button></div>
    <h2>Proposition pour la prochaine séance</h2>
    <p class="small muted">Réglage actuel : ${s.settings.nUp} montée(s) et ${s.settings.nDown} descente(s) par poule. Pour l'appliquer, choisis « Montées/descentes de la dernière séance » en créant la prochaine séance de cette classe.</p>
    <div class="grid">${prop}</div>
    <h2 style="margin-top:1.6rem">Classements</h2>
    <div class="overview">${s.pools.map((p, i) => `<div class="pool" style="--pc:${poolColor(i)}"><div class="pool-name">${esc(p.name)}</div>${standingsTable(p, s)}</div>`).join('')}</div>
    <h2 style="margin-top:1.6rem">Rencontres</h2>
    <div class="overview">${s.pools.map((p, i) => `<div class="pool" style="--pc:${poolColor(i)}"><div class="pool-name">${esc(p.name)}</div>
      ${poolMatches(p.id).map((m) => `<div class="small" style="padding:.25rem 0;border-bottom:1px solid var(--rule)">${esc(entryName(m.a))} <b>${m.done ? (m.forfait ? 'forfait' : m.scoreA + ' – ' + m.scoreB) : 'non joué'}</b> ${esc(entryName(m.b))} ${m.fpA ? FP_ICON[m.fpA] + 'A' : ''} ${m.fpB ? FP_ICON[m.fpB] + 'B' : ''}</div>`).join('')}</div>`).join('')}</div>`);
  S.session = prev;
  return html;
}

// ---------- Suivi des élèves ----------
function studentStats(classId) {
  const c = getClass(classId);
  const stats = Object.fromEntries(c.students.map((s) => [s.id, { s, seances: 0, j: 0, v: 0, n: 0, d: 0, bonus: 0, malus: 0, roles: {}, ups: 0, downs: 0, last: '', defis: 0, defiSeances: 0 }]));
  for (const h of (S.defiHistory || []).filter((x) => x.classId === classId)) {
    for (const [pid, k] of Object.entries(h.counts || {})) if (stats[pid]) { stats[pid].defis += k; stats[pid].defiSeances++; }
  }
  const hist = (S.history || []).filter((h) => h.classId === classId).slice().reverse();
  for (const h of hist) {
    const s = h.session;
    const entryOf = {};
    Object.entries(s.entries).forEach(([eid, e]) => e.members.forEach((pid) => (entryOf[pid] = eid)));
    Object.keys(s.people).forEach((pid) => { if (stats[pid]) stats[pid].seances++; });
    for (const m of Object.values(s.matches || {})) {
      if (m.done) for (const [r, pid] of Object.entries(m.roles || {})) {
        if (stats[pid]) stats[pid].roles[r] = (stats[pid].roles[r] || 0) + 1;
      }
      if (!m.done) continue;
      for (const [k, other] of [['A', 'B'], ['B', 'A']]) {
        const eid = m[k.toLowerCase()];
        for (const pid of s.entries[eid]?.members || []) {
          const x = stats[pid]; if (!x) continue;
          x.j++;
          const my = +m['score' + k], ot = +m['score' + other];
          if (m.forfait === k || m.forfait === 'AB') x.d++;
          else if (m.forfait === other) x.v++;
          else if (my > ot) x.v++; else if (my < ot) x.d++; else x.n++;
          if (m['fp' + k] > 0) x.bonus++; if (m['fp' + k] < 0) x.malus++;
        }
      }
    }
    for (const [pid, mv] of Object.entries(h.moves || {})) {
      const x = stats[pid]; if (!x) continue;
      if (mv.move === -1) x.ups++; if (mv.move === 1) x.downs++;
      x.last = mv.poolName || x.last;
    }
  }
  return { c, rows: Object.values(stats), n: hist.length };
}
function vSuivi() {
  if (!S.history || !S.defiHistory) { Promise.all([loadHistory(), loadDefiHistory()]).then(render).catch(fail); return shell('<div class="loading">Chargement…</div>'); }
  if (!S.classes.length) return shell('<h1>Suivi des élèves</h1><div class="empty">Aucune classe.</div>');
  const cid = S.p.classId || S.classes[0].id;
  const { rows, n } = studentStats(cid);
  rows.sort((a, b) => a.s.nom.localeCompare(b.s.nom, 'fr'));
  return shell(`<div class="section-title"><h1>Suivi des élèves</h1><div class="row">
    <select data-a-change="suiviClass">${S.classes.map((c) => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <button class="btn" data-a="exportSuivi" data-id="${cid}">Exporter en Excel</button></div></div>
    <p class="muted">Bilan sur ${n} séance${n > 1 ? 's' : ''} archivée${n > 1 ? 's' : ''}. Utile pour l'évaluation du cycle : régularité, fair-play et rôles tenus.</p>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>Élève</th><th class="num">Séances</th><th class="num">Matchs</th><th class="num">V</th><th class="num">N</th><th class="num">D</th>
      <th class="num">🌟</th><th class="num">😠</th><th>Rôles tenus</th><th class="num">▲</th><th class="num">▼</th><th>Dernière poule</th><th class="num" title="Défis solidaires validés (nombre de séances)">Défis</th></tr></thead><tbody>
    ${rows.map((x) => `<tr><td>${esc(fullName(x.s))}</td><td class="num">${x.seances}</td><td class="num">${x.j}</td><td class="num">${x.v}</td><td class="num">${x.n}</td><td class="num">${x.d}</td>
      <td class="num fp-pos">${x.bonus || ''}</td><td class="num fp-neg">${x.malus || ''}</td>
      <td class="small">${Object.entries(x.roles).map(([r, k]) => `${esc(r)} ×${k}`).join(', ')}</td><td class="num mv up">${x.ups || ''}</td><td class="num mv down">${x.downs || ''}</td><td class="small">${esc(x.last)}</td><td class="num">${x.defiSeances ? `${x.defis} <span class="small muted">(${x.defiSeances})</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`);
}

// ---------- Réglages ----------
function vReglages() {
  const st = S.teacher.settings, p = st.pts;
  const num = (k, v, label, min = 0) => `<label class="f">${label}<input type="number" min="${min}" max="10" id="set_${k}" value="${v}"></label>`;
  return shell(`<h1>Réglages</h1>
    <div class="panel"><h3>Points de classement</h3><div class="row">
      ${num('victoire', p.victoire, 'Victoire')}${num('nul', p.nul, 'Match nul')}${num('defaite', p.defaite, 'Défaite')}${num('forfait', p.forfait, 'Forfait')}</div>
      <h3 style="margin-top:1rem">Fair-play (indiqué à la fin de chaque match)</h3>
      <div class="row">${num('bonus', p.bonus, '🌟 Bonus comportement exemplaire')}${num('malus', p.malus, '😠 Malus contestation')}</div>
      <p class="small muted" style="margin-top:.6rem">Conseil : un bonus égal à l'écart entre une défaite et un nul (1 point avec le barème 3/2/1). Le fair-play pèse sans jamais renverser seul un résultat.</p></div>
    <div class="panel"><h3>Montées et descentes</h3><div class="row">${num('nUp', st.nUp, 'Joueurs qui montent par poule')}${num('nDown', st.nDown, 'Joueurs qui descendent par poule')}</div></div>
    <div class="panel"><h3>Rôles proposés par défaut</h3><input id="set_roles" value="${esc(st.roles.join(', '))}" style="width:100%"></div>
    <div class="panel"><h3>Protection des données</h3><label class="row"><input type="checkbox" id="set_trunc" ${st.truncateNames ? 'checked' : ''}> Ne garder que l'initiale du nom de famille lors des imports</label>
      <p class="small muted" style="margin-top:.5rem">Les noms sont stockés dans ton projet Firebase. Réduire les noms limite les données personnelles enregistrées.</p></div>
    <div class="row"><button class="btn primary big" data-a="saveSettings">Enregistrer les réglages</button></div>
    <div class="section-title"><h2>Activités enregistrées</h2></div>
    <div class="panel">${S.teacher.sports.length ? `<table><tbody>${S.teacher.sports.map((sp) => `<tr><td><b>${esc(sp.name)}</b></td>
      <td><select data-a-change="sportFormat" data-id="${sp.id}">${Object.entries(FORMAT_LABEL).map(([k, l]) => `<option value="${k}" ${k === sp.format ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td>${sp.format === 'equipe' ? `<input type="number" min="2" max="12" value="${sp.teamSize || 4}" data-a-change="sportTeam" data-id="${sp.id}" title="Joueurs par équipe">` : ''}</td>
      <td style="text-align:right"><button class="icon-btn" data-a="renameSport" data-id="${sp.id}" title="Renommer">✎</button><button class="icon-btn" data-a="delSport" data-id="${sp.id}" title="Supprimer">✕</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="muted">Les activités s\'ajoutent au moment de créer une séance.</div>'}</div>`);
}

// ---------- Import Excel ----------
async function readStudentsFile(file) {
  if (!window.XLSX) throw new Error('Lecteur Excel non chargé (vérifie la connexion internet).');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const list = parseStudentRows(rows, { truncate: S.teacher.settings.truncateNames });
  if (!list.length) throw new Error('Aucun élève trouvé dans le fichier.');
  return list;
}
function exportXlsx(sheets, filename) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

// ---------- Actions ----------
const A = {
  nav: (el) => go(el.dataset.v),
  async logout() { stopLive(); ['tournoiCode', 'tournoiPool', 'tournoiColl'].forEach((k) => localStorage.removeItem(k)); await signOut(auth); },
  async loginGoogle() {
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); }
    catch (e) { if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(auth, provider); else fail(e); }
  },
  async loginTablet() { await signInAnonymously(auth); },

  // Classes
  async importClass() {
    const name = document.getElementById('newClassName').value.trim();
    const file = document.getElementById('newClassFile').files[0];
    if (!name) return toast('Indique le nom de la classe.', true);
    if (!file) return toast('Choisis un fichier Excel.', true);
    const students = await readStudentsFile(file);
    const c = { id: uid(), name, students, createdAt: Date.now() };
    await saveClass(c); S.classes.push(c); S.classes.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    toast(`${students.length} élèves importés dans ${name}.`); go('classe', { id: c.id });
  },
  async emptyClass() {
    const name = document.getElementById('newClassName').value.trim() || await promptBox('Nom de la classe');
    if (!name) return;
    const c = { id: uid(), name, students: [], createdAt: Date.now() };
    await saveClass(c); S.classes.push(c); go('classe', { id: c.id });
  },
  openClass: (el) => go('classe', { id: el.dataset.id }),
  sortClass: (el) => { S.p.sort = el.dataset.v; render(); },
  async renameClass() {
    const c = getClass(S.p.id); const n = await promptBox('Nouveau nom de la classe', c.name);
    if (n) { c.name = n; await saveClass(c); render(); }
  },
  async deleteClass() {
    const c = getClass(S.p.id);
    if (!(await confirmBox(`Supprimer la classe ${c.name} ?`, 'Supprimer'))) return;
    await deleteDoc(classRef(c.id)); S.classes = S.classes.filter((x) => x.id !== c.id); toast('Classe supprimée.'); go('classes');
  },
  async addStudent() {
    const c = getClass(S.p.id);
    let nom = document.getElementById('addNom').value.trim();
    const prenom = document.getElementById('addPrenom').value.trim();
    if (!nom && !prenom) return toast('Indique au moins un nom ou un prénom.', true);
    if (S.teacher.settings.truncateNames && nom) nom = nom[0].toUpperCase() + '.';
    c.students.push({ id: uid(), nom, prenom, sexe: document.getElementById('addSexe').value, niveau: 3 });
    await saveClass(c); render(); document.getElementById('addNom')?.focus();
  },
  async importMore() {
    const c = getClass(S.p.id); const file = document.getElementById('moreFile').files[0];
    if (!file) return toast('Choisis un fichier.', true);
    const list = await readStudentsFile(file);
    c.students.push(...list); await saveClass(c); toast(`${list.length} élèves ajoutés.`); render();
  },
  async toggleSexe(el) {
    const c = getClass(S.p.id); const s = c.students.find((x) => x.id === el.dataset.sid);
    s.sexe = s.sexe === 'F' ? 'G' : 'F'; await saveClass(c); render();
  },
  async delStudent(el) {
    const c = getClass(S.p.id); const s = c.students.find((x) => x.id === el.dataset.sid);
    if (!(await confirmBox(`Retirer ${fullName(s)} de la classe ?`, 'Retirer'))) return;
    c.students = c.students.filter((x) => x.id !== s.id); await saveClass(c); render();
  },
  async setLevel(el) {
    const c = getClass(el.dataset.cid); const s = c.students.find((x) => x.id === el.dataset.sid);
    s.niveau = +el.dataset.v; render(); await saveClass(c);
  },

  // Nouvelle séance
  async newSession() { await loadHistory(); newWizard(); go('wizard'); },
  setWiz: (el) => {
    S.wiz[el.dataset.k] = el.dataset.v; S.wiz.preview = null; render();
    if (el.dataset.v === 'atp' && !S.atpClasses) loadAtpClasses().then(render).catch(fail);
  },
  cycleStatus: (el) => {
    const order = ['present', 'absent', 'dispense'];
    const cur = S.wiz.status[el.dataset.sid] || 'present';
    S.wiz.status[el.dataset.sid] = order[(order.indexOf(cur) + 1) % 3]; S.wiz.preview = null; render();
  },
  async addSport() {
    const name = document.getElementById('newSportName').value.trim();
    if (!name) return toast("Indique le nom de l'activité.", true);
    const format = document.getElementById('newSportFormat').value;
    const sp = { id: uid(), name, format, teamSize: format === 'equipe' ? 4 : format === 'double' ? 2 : 1 };
    await saveTeacher({ sports: [...S.teacher.sports, sp] });
    Object.assign(S.wiz, { sportId: sp.id, format, teamSize: format === 'equipe' ? sp.teamSize : S.wiz.teamSize, preview: null });
    toast(`${name} enregistré.`); render();
  },
  genPools() { generatePreview(); render(); setTimeout(() => document.querySelector('.grid .pool')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); },
  movePool(el) {
    const i = +el.dataset.i, j = i + +el.dataset.d, pools = S.wiz.preview.pools;
    [pools[i], pools[j]] = [pools[j], pools[i]]; render();
  },
  async launch() {
    const w = S.wiz, c = getClass(w.classId), { ts } = wizCounts();
    const sport = S.teacher.sports.find((x) => x.id === w.sportId);
    const { pools, entries, people } = w.preview;
    const roles = w.roles.split(',').map((r) => r.trim()).filter(Boolean);
    const courts = Math.max(1, +w.courts || 1);
    const matches = {};
    pools.filter((p) => p.entryIds.length).forEach((p) => buildPoolMatches(p, entries, roles, courts).forEach((m) => (matches[m.id] = m)));
    const code = await freeCode();
    const st = S.teacher.settings;
    const session = {
      code, ownerUid: S.user.uid, ownerName: S.user.displayName || '', active: true, createdAt: Date.now(), updatedAt: Date.now(),
      classId: c.id, className: c.name, sport: sport.name, format: { type: w.format, teamSize: ts },
      settings: { pts: st.pts, roles, nUp: +st.nUp, nDown: +st.nDown, courts, mixite: w.mixite, mode: w.mode },
      people, entries, pools: pools.filter((p) => p.entryIds.length || p.officials.length), matches,
      absents: c.students.filter((s) => w.status[s.id] === 'absent').map((s) => s.id),
      timer: { duration: 600, endAt: null, remaining: 600000 }, historyId: null,
    };
    await setDoc(doc(db, 'sessions', code), session);
    // mémorise le dernier format utilisé pour cette activité
    if (sport.format !== w.format || (w.format === 'equipe' && sport.teamSize !== ts)) {
      await saveTeacher({ sports: S.teacher.sports.map((x) => (x.id === sport.id ? { ...x, format: w.format, teamSize: ts } : x)) });
    }
    S.wiz = null; S.poolTab = 'all';
    S.active.unshift(session);
    listenSession(code, 'live');
  },

  // Séance en direct
  openLive: (el) => { S.poolTab = 'all'; listenSession(el.dataset.code, 'live'); },
  poolTab: (el) => { S.poolTab = el.dataset.v; render(); },
  resync: () => { if (S.code) { subscribe(); toast('Connexion relancée.'); } },
  async renamePool(el) {
    const pools = S.session.pools.map((p) => ({ ...p }));
    const p = pools.find((x) => x.id === el.dataset.pid);
    const n = await promptBox('Nom de la poule', p.name);
    if (n) { p.name = n; await updateDoc(sesRef(), { pools, updatedAt: Date.now() }); }
  },
  openScore: (el) => openScore(el.dataset.mid),
  sc(el) { const k = 'score' + el.dataset.k; S.modal.m[k] = Math.max(0, (+S.modal.m[k] || 0) + +el.dataset.d); S.modal.m.forfait = null; renderScoreModal(); },
  fp(el) { S.modal.m['fp' + el.dataset.k] = +el.dataset.v; renderScoreModal(); },
  ff(el) { const m = S.modal.m; m.forfait = m.forfait === el.dataset.k ? null : el.dataset.k; renderScoreModal(); },
  closeModal,
  async scoreSave() {
    const m = { ...S.modal.m, done: true };
    m.scoreA = +m.scoreA || 0; m.scoreB = +m.scoreB || 0;
    closeModal(); await saveMatch(m); toast('Résultat enregistré.'); render();
  },
  async scoreClear() {
    const m = { ...S.modal.m, done: false, scoreA: null, scoreB: null, fpA: 0, fpB: 0, forfait: null };
    closeModal(); await saveMatch(m); toast('Résultat effacé.'); render();
  },
  editRoles: (el) => openRoles(el.dataset.mid),
  async rolesSave() {
    const m = S.session.matches[S.modal.mid];
    const roles = {};
    $modal.querySelectorAll('select[data-role]').forEach((s) => { if (s.value) roles[s.dataset.role] = s.value; });
    const extra = $modal.querySelector('#extraRole').value.trim();
    if (extra && !(extra in roles)) roles[extra] = '';
    closeModal();
    await updateDoc(sesRef(), { [`matches.${m.id}.roles`]: roles, updatedAt: Date.now() });
    if (extra) setTimeout(() => openRoles(m.id), 300);
  },
  async tStart() { const { t } = timerState(); await updateDoc(sesRef(), { timer: { ...t, endAt: Date.now() + t.remaining } }); },
  async tPause() { const { t, left } = timerState(); await updateDoc(sesRef(), { timer: { ...t, endAt: null, remaining: Math.max(0, left) } }); },
  async tReset() { const { t } = timerState(); await updateDoc(sesRef(), { timer: { ...t, endAt: null, remaining: t.duration * 1000 } }); },
  async endSession() {
    const s = S.session;
    const all = Object.values(s.matches || {});
    const left = all.filter((m) => !m.done).length;
    if (!(await confirmBox(left ? `Il reste ${left} match(s) non joué(s). Terminer et archiver quand même ?` : 'Terminer la séance et l\'archiver ?', 'Terminer et archiver', false))) return;
    const { timer, ...data } = s;
    const rec = { date: s.createdAt, endedAt: Date.now(), classId: s.classId, className: s.className, sport: s.sport, session: { ...data, active: false }, moves: computeMoves(s) };
    let id = s.historyId;
    if (id) await setDoc(doc(histCol(), id), rec); else id = (await addDoc(histCol(), rec)).id;
    const code = s.code;
    stopLive();
    await deleteDoc(doc(db, 'sessions', code));
    S.active = S.active.filter((x) => x.code !== code);
    await loadHistory(true);
    toast('Séance archivée.'); go('histo-detail', { id });
  },
  async abortSession() {
    if (!(await confirmBox('Supprimer cette séance sans l\'archiver ? Tous les résultats seront perdus.', 'Supprimer'))) return;
    const code = S.session.code; stopLive();
    await deleteDoc(doc(db, 'sessions', code)); S.active = S.active.filter((x) => x.code !== code); go('seance');
  },

  // Tablette
  async joinCode() {
    const code = document.getElementById('codeIn').value.trim();
    if (!/^\d{4}$/.test(code)) return toast('Le code contient 4 chiffres.', true);
    for (const coll of ['sessions', 'defiSessions']) {
      const snap = await getDoc(doc(db, coll, code));
      if (snap.exists() && snap.data().active) {
        localStorage.setItem('tournoiCode', code); localStorage.setItem('tournoiColl', coll);
        return listenSession(code, coll === 'sessions' ? 'tablet-pool' : 'tablet-defi', { pool: null }, coll);
      }
    }
    toast('Aucune séance en cours avec ce code.', true);
  },
  tabletPool: (el) => { localStorage.setItem('tournoiPool', el.dataset.pid); S.p.pool = el.dataset.pid; render(); },
  tabletChangePool: () => { localStorage.removeItem('tournoiPool'); S.p.pool = null; render(); },
  tabletLeave: () => { ['tournoiCode', 'tournoiPool', 'tournoiColl'].forEach((k) => localStorage.removeItem(k)); go('tablet-join'); },

  // Historique
  openHist: (el) => go('histo-detail', { id: el.dataset.id }),
  async deleteHist(el) {
    if (!(await confirmBox('Supprimer définitivement cette séance de l\'historique ?', 'Supprimer'))) return;
    await deleteDoc(doc(histCol(), el.dataset.id)); S.history = S.history.filter((h) => h.id !== el.dataset.id); go('historique');
  },
  async reopenHist(el) {
    const h = S.history.find((x) => x.id === el.dataset.id);
    const code = await freeCode();
    const session = { ...h.session, code, active: true, ownerUid: S.user.uid, updatedAt: Date.now(), historyId: h.id, timer: { duration: 600, endAt: null, remaining: 600000 } };
    await setDoc(doc(db, 'sessions', code), session);
    S.active.unshift(session); S.poolTab = 'all';
    toast('Séance rouverte : modifie les résultats puis termine-la à nouveau pour mettre à jour l\'historique.');
    listenSession(code, 'live');
  },
  exportHist(el) {
    const h = S.history.find((x) => x.id === el.dataset.id), s = h.session;
    const nm = (eid) => s.entries[eid]?.name || s.entries[eid]?.members.map((p) => fullName(s.people[p])).join(' & ');
    const cls = [], mts = [];
    s.pools.forEach((p) => {
      const ms = Object.values(s.matches).filter((m) => m.pool === p.id);
      computeStandings(p.entryIds, ms, s.settings.pts).forEach((r) => {
        const mv = h.moves?.[s.entries[r.id].members[0]]?.move;
        cls.push({ Poule: p.name, Rang: r.rank, Nom: nm(r.id), Joués: r.j, V: r.v, N: r.n, D: r.d + r.f, 'Pts marqués': r.pm, 'Pts encaissés': r.pc, 'Fair-play': r.fp, Points: r.pts, Proposition: mv === -1 ? 'Monte' : mv === 1 ? 'Descend' : '' });
      });
      ms.sort((a, b) => a.slot - b.slot).forEach((m) => mts.push({ Poule: p.name, Rotation: m.slot, A: nm(m.a), 'Score A': m.done ? m.scoreA : '', 'Score B': m.done ? m.scoreB : '', B: nm(m.b), Forfait: m.forfait || '', 'Fair-play A': fpPoints(m.fpA || 0, s.settings.pts), 'Fair-play B': fpPoints(m.fpB || 0, s.settings.pts), Rôles: Object.entries(m.roles || {}).map(([r, pid]) => `${r} : ${fullName(s.people[pid])}`).join(' ; ') }));
    });
    exportXlsx([['Classements', cls], ['Rencontres', mts]], `${h.className}_${h.sport}_${new Date(h.date).toISOString().slice(0, 10)}.xlsx`);
  },
  exportSuivi(el) {
    const { c, rows } = studentStats(el.dataset.id);
    exportXlsx([['Suivi', rows.map((x) => ({ Nom: x.s.nom, Prénom: x.s.prenom, Sexe: x.s.sexe, Niveau: x.s.niveau, Séances: x.seances, Matchs: x.j, Victoires: x.v, Nuls: x.n, Défaites: x.d, 'Bonus fair-play': x.bonus, 'Malus fair-play': x.malus, 'Rôles tenus': Object.entries(x.roles).map(([r, k]) => `${r} x${k}`).join(', '), Montées: x.ups, Descentes: x.downs, 'Dernière poule': x.last, 'Défis solidaires validés': x.defis, 'Séances de défis': x.defiSeances }))]], `Suivi_${c.name}.xlsx`);
  },

  // Réglages
  async saveSettings() {
    const v = (k) => Math.max(0, +document.getElementById('set_' + k).value || 0);
    const settings = {
      pts: { victoire: v('victoire'), nul: v('nul'), defaite: v('defaite'), forfait: v('forfait'), bonus: v('bonus'), malus: v('malus') },
      nUp: v('nUp'), nDown: v('nDown'),
      roles: document.getElementById('set_roles').value.split(',').map((r) => r.trim()).filter(Boolean),
      truncateNames: document.getElementById('set_trunc').checked,
    };
    await saveTeacher({ settings }); toast('Réglages enregistrés.');
  },
  async renameSport(el) {
    const sp = S.teacher.sports.find((x) => x.id === el.dataset.id); const n = await promptBox("Nom de l'activité", sp.name);
    if (n) { await saveTeacher({ sports: S.teacher.sports.map((x) => (x.id === sp.id ? { ...x, name: n } : x)) }); render(); }
  },
  async delSport(el) {
    const sp = S.teacher.sports.find((x) => x.id === el.dataset.id);
    if (!(await confirmBox(`Supprimer l'activité ${sp.name} ?`, 'Supprimer'))) return;
    await saveTeacher({ sports: S.teacher.sports.filter((x) => x.id !== sp.id) }); render();
  },
};

// Actions déclenchées au changement d'une valeur
const C = {
  async editStudent(el) {
    const c = getClass(S.p.id); const s = c.students.find((x) => x.id === el.dataset.sid);
    s[el.dataset.field] = el.value.trim(); await saveClass(c); toast('Enregistré.');
  },
  pickSport(el) {
    const sp = S.teacher.sports.find((x) => x.id === el.value);
    S.wiz.sportId = el.value;
    if (sp) { S.wiz.format = sp.format; if (sp.format === 'equipe') S.wiz.teamSize = sp.teamSize || 4; }
    S.wiz.preview = null; render();
  },
  setPoolSize(el) { const { nEntries } = wizCounts(); S.wiz.nPools = Math.max(1, Math.ceil(nEntries / Math.max(2, +el.value || 2))); S.wiz.preview = null; render(); },
  moveEntry(el) {
    const pools = S.wiz.preview.pools, eid = el.dataset.eid, to = +el.value;
    pools.forEach((p) => (p.entryIds = p.entryIds.filter((x) => x !== eid)));
    pools[to].entryIds.push(eid); render();
  },
  async tDur(el) {
    const min = Math.max(1, Math.min(60, +el.value || 10));
    await updateDoc(sesRef(), { timer: { duration: min * 60, endAt: null, remaining: min * 60000 } });
  },
  histFilter(el) { S.p.classId = el.value; render(); },
  suiviClass(el) { S.p.classId = el.value; render(); },
  async sportFormat(el) { await saveTeacher({ sports: S.teacher.sports.map((x) => (x.id === el.dataset.id ? { ...x, format: el.value, teamSize: el.value === 'equipe' ? x.teamSize > 2 ? x.teamSize : 4 : el.value === 'double' ? 2 : 1 } : x)) }); render(); },
  async sportTeam(el) { await saveTeacher({ sports: S.teacher.sports.map((x) => (x.id === el.dataset.id ? { ...x, teamSize: Math.max(2, +el.value || 4) } : x)) }); },
};

// ============================================================
//  Classement ATP (lecture seule dans la base de l'appli ATP)
// ============================================================
const atpUrl = (path) => `${atpConfig.databaseURL.replace(/\/$/, '')}/${path}.json`;
async function atpFetch(path, shallow = false) {
  let r;
  try { r = await fetch(atpUrl(path) + (shallow ? '?shallow=true' : '')); }
  catch { throw new Error("Base ATP injoignable : vérifie la connexion ou l'adresse dans js/atp-config.js."); }
  if (r.status === 401 || r.status === 403) throw new Error('La base ATP refuse la lecture : autorise la lecture dans ses règles (voir README).');
  if (!r.ok) throw new Error(`Base ATP inaccessible (erreur ${r.status}).`);
  return r.json();
}
async function loadAtpClasses() {
  const data = await atpFetch('tournaments', true);
  S.atpClasses = Object.keys(data || {}).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
}
async function saveAtpMap(c) {
  const w = S.wiz;
  c.atpClass = w.atp.cls;
  c.atpMap = { ...(c.atpMap || {}), [w.atp.cls]: Object.fromEntries(w.atp.list.filter((a) => a.sid).map((a) => [a.name, a.sid])) };
  await saveClass(c);
}
function atpPanel(c) {
  const w = S.wiz;
  if (!S.atpClasses) return `<div class="panel atp-panel"><p class="muted">Lecture des classes de l'appli ATP…</p><button class="btn small" data-a="atpReloadClasses">Réessayer</button></div>`;
  if (!S.atpClasses.length) return `<div class="panel atp-panel"><p>Aucune classe trouvée dans l'appli ATP.</p></div>`;
  const simple = (x) => String(x).toLowerCase().replace(/[\s°e]/g, '');
  const def = w.atpCls || c.atpClass || S.atpClasses.find((x) => simple(x) === simple(c.name)) || S.atpClasses[0];
  const head = `<div class="row" style="align-items:flex-end"><label class="f">Classe dans l'appli ATP<select id="atpCls">${S.atpClasses.map((x) => `<option ${x === def ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
    <button class="btn primary" data-a="atpLoad">${w.atp ? 'Recharger le classement' : 'Charger le classement'}</button></div>`;
  if (!w.atp) return `<div class="panel atp-panel"><h3>Classement ATP</h3>${head}<p class="small muted" style="margin-top:.6rem">Le classement est lu dans ton appli ATP, sans rien y modifier. Le 1er ATP va dans la poule 1, et ainsi de suite.</p></div>`;
  const used = new Set(w.atp.list.map((a) => a.sid).filter(Boolean));
  const sorted = [...c.students].sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'));
  const unlinked = c.students.filter((s) => !used.has(s.id));
  return `<div class="panel atp-panel"><h3>Classement ATP · ${esc(w.atp.cls)}</h3>${head}
    <p class="small muted" style="margin-top:.6rem">${used.size}/${w.atp.list.length} joueurs ATP reliés à un élève. Vérifie les correspondances : elles sont mémorisées pour les prochaines fois.</p>
    <div class="table-wrap"><table><thead><tr><th class="num">Rang</th><th>Nom dans l'ATP</th><th class="num">Points</th><th>Élève de la classe</th><th>Statut ATP</th></tr></thead><tbody>
    ${w.atp.list.map((a, i) => `<tr class="${a.sid ? '' : 'atp-miss'}"><td class="num"><b>${a.rank}</b></td><td>${esc(a.name)}${a.ambiguous ? ' <span class="tag">plusieurs possibles</span>' : ''}</td><td class="num">${a.points}</td>
      <td><select data-a-change="atpLink" data-i="${i}"><option value="">— non relié —</option>${sorted.map((s) => `<option value="${s.id}" ${s.id === a.sid ? 'selected' : ''}>${esc(fullName(s))}</option>`).join('')}</select></td>
      <td class="small">${a.dispense ? 'Dispensé' : a.absent ? 'Absent' : ''}</td></tr>`).join('')}
    </tbody></table></div>
    ${unlinked.length ? `<p class="small" style="margin-top:.6rem"><b>Sans classement ATP</b> (placés en fin, selon leurs étoiles) : ${unlinked.map((s) => esc(fullName(s))).join(', ')}</p>` : ''}
    <button class="btn small" data-a="atpStatuses" style="margin-top:.6rem">Reprendre les absents et dispensés de l'ATP</button></div>`;
}

// ============================================================
//  Défi solidaire
// ============================================================
const byNum = (a, b) => (Number(a.num) || 0) - (Number(b.num) || 0) || String(a.titre).localeCompare(String(b.titre), 'fr');
function timeOver() {
  if (!S.session?.timer) return false;
  const { t, left } = timerState();
  return t.endAt ? left <= 0 : t.remaining <= 0;
}
function newDefiWizard() {
  S.dw = { classId: S.classes[0]?.id, duration: 15, objectif: 0, ecartMax: 3, absent: {}, defiIds: S.teacher.defis.map((d) => d.id) };
}
const defiFiche = (d) => `<div class="fiche">${courtSvg(d.schema)}
  <p><b>But :</b> ${esc(d.but)}</p>${d.consignes ? `<p><b>Consignes :</b> ${esc(d.consignes)}</p>` : ''}
  ${d.criteres ? `<p><b>Critères de réalisation :</b> ${esc(d.criteres)}</p>` : ''}${d.materiel ? `<p><b>Matériel :</b> ${esc(d.materiel)}</p>` : ''}</div>`;

function vDefis() {
  if (!S.defiHistory) { loadDefiHistory().then(render).catch(fail); return shell('<div class="loading">Chargement…</div>'); }
  if (S.classes.length && (!S.dw || !getClass(S.dw.classId))) newDefiWizard();
  const defis = [...S.teacher.defis].sort(byNum);
  let html = `<div class="section-title"><h1>Défi solidaire</h1></div>
    <p class="muted">Chaque élève valide un maximum de défis dans le temps donné, mais l'écart entre le plus avancé et le plus fragile ne peut pas dépasser la limite : les plus avancés deviennent alors tuteurs. La classe gagne ensemble.</p>`;
  if (S.activeDefi.length) html += `<h2>En cours</h2>${S.activeDefi.map((s) => `<div class="panel row between"><div><h3>${esc(s.className)}</h3>
      <div class="muted small">Lancé le ${fmtDate(s.createdAt)} · code ${s.code}</div></div><button class="btn primary" data-a="openDefiLive" data-code="${s.code}">Reprendre</button></div>`).join('')}`;
  if (!S.classes.length) html += `<div class="panel"><p>Importe d'abord une classe dans l'onglet <b>Classes</b>.</p></div>`;
  else {
    const dw = S.dw, c = getClass(dw.classId);
    const present = c.students.filter((s) => !dw.absent[s.id]);
    const nDef = dw.defiIds.length;
    const sugg = Math.round(present.length * Math.min(4, nDef));
    html += `<div class="panel"><h2>Nouveau défi solidaire</h2><div class="row" style="align-items:flex-end">
      <label class="f">Classe<select data-a-change="dwClass">${S.classes.map((x) => `<option value="${x.id}" ${x.id === dw.classId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="f">Durée (minutes)<input type="number" min="1" max="120" value="${dw.duration}" data-a-change="dwSet" data-k="duration"></label>
      <label class="f">Objectif de la classe (défis au total)<input type="number" min="1" value="${dw.objectif || sugg}" data-a-change="dwSet" data-k="objectif"></label>
      <label class="f">Écart maximum autorisé<input type="number" min="1" max="10" value="${dw.ecartMax}" data-a-change="dwSet" data-k="ecartMax"></label></div>
      <p class="small muted" style="margin-top:.5rem">Suggestion d'objectif : ${sugg} (environ ${Math.min(4, nDef)} défis par élève présent). Avec un écart de ${dw.ecartMax}, un élève qui a ${dw.ecartMax} défis de plus que le plus fragile est bloqué et devient tuteur.</p>
      <h3 style="margin-top:1rem">Présents <span class="muted small">(${present.length}/${c.students.length}, touche un nom pour le marquer absent)</span></h3>
      <div class="chips">${[...c.students].sort((a, b) => a.prenom.localeCompare(b.prenom, 'fr')).map((s) => `<button class="chip ${dw.absent[s.id] ? 'off' : 'on'}" data-a="dwAbsent" data-sid="${s.id}">${esc(shortName(s))}</button>`).join('')}</div>
      <h3 style="margin-top:1rem">Défis proposés <span class="muted small">(${nDef}/${defis.length})</span></h3>
      <div class="chips">${defis.map((d) => `<button class="chip ${dw.defiIds.includes(d.id) ? 'on' : 'off'}" data-a="dwDefi" data-id="${d.id}">${d.num ? d.num + ' · ' : ''}${esc(d.titre)}</button>`).join('')}</div>
      <div class="row" style="margin-top:1.2rem"><button class="btn go big" data-a="launchDefi" ${present.length < 2 || !nDef ? 'disabled' : ''}>Lancer le défi</button></div></div>`;
  }
  html += `<div class="section-title"><h2>Fiches des défis</h2><div class="row"><button class="btn" data-a="defiEdit">Ajouter un défi</button><button class="btn ghost small" data-a="defiReset">Remettre les fiches d'origine</button></div></div>
    <div class="defi-grid">${defis.map((d) => `<div class="defi-card"><div class="row between"><span class="defi-num">Défi ${esc(d.num ?? '')}</span>
      <span><button class="icon-btn" data-a="defiEdit" data-id="${d.id}" title="Modifier">✎</button><button class="icon-btn" data-a="defiDel" data-id="${d.id}" title="Supprimer">✕</button></span></div>
      <h3>${esc(d.titre)}</h3>${defiFiche(d)}</div>`).join('')}</div>`;
  const hist = S.defiHistory;
  html += `<div class="section-title"><h2>Défis terminés</h2></div>${hist.length ? `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Classe</th><th class="num">Défis</th><th class="num">Écart final</th><th>Résultat</th><th></th></tr></thead><tbody>
    ${hist.map((h) => `<tr><td>${fmtDate(h.date)}</td><td>${esc(h.className)}</td><td class="num">${h.total}/${h.objectif}</td><td class="num">${h.ecart}</td>
      <td>${h.success ? '<span class="fp-pos">Réussi</span>' : '<span class="fp-neg">Non atteint</span>'}</td><td style="text-align:right"><button class="btn small" data-a="openDefiHisto" data-id="${h.id}">Voir</button></td></tr>`).join('')}
    </tbody></table></div></div>` : '<div class="empty">Aucun défi solidaire terminé.</div>'}`;
  return shell(html);
}

// Tableau de bord commun (PC et haut des tablettes)
function defiGauges(s, st) {
  const pct = Math.min(100, (100 * st.total) / Math.max(1, s.settings.objectif));
  const ecartPct = Math.min(100, (100 * st.ecart) / st.E);
  return `<div class="gauges">
    <div class="gauge-box"><div class="gauge-label">Défis de la classe</div><div class="gauge-num">${st.total}<small> / ${s.settings.objectif}</small></div>
      <div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="gauge-box ${st.ecart >= st.E ? 'warn' : ''}"><div class="gauge-label">Écart entre le plus avancé et le plus fragile</div><div class="gauge-num">${st.ecart}<small> / ${st.E} max</small></div>
      <div class="bar ecart"><i style="width:${ecartPct}%"></i></div></div>
  </div>`;
}
function vDefiLive() {
  const s = S.session;
  if (!s) return shell('<div class="loading">Connexion au défi…</div>');
  const nm = (p) => shortName(s.people[p]);
  const st = defiState(s, nm);
  const over = timeOver();
  const success = st.total >= s.settings.objectif && st.ecart <= st.E;
  const counts = Object.fromEntries(s.defis.map((d) => [d.id, 0]));
  Object.values(st.done).forEach((set) => set.forEach((id) => (counts[id] = (counts[id] || 0) + 1)));
  const students = [...s.present].sort((a, b) => nm(a).localeCompare(nm(b), 'fr'));
  return shell(`<div class="live-bar">
      <div><h1 style="margin:0">Défi solidaire · ${esc(s.className)}</h1><div class="muted">${s.present.length} élèves · ${s.defis.length} défis</div></div>
      <div class="code-box"><span class="small">Code tablette</span><b>${s.code}</b></div>${syncBadge()}${timerHtml(true)}
      <div class="row"><button class="btn go" data-a="endDefi">Terminer et archiver</button><button class="btn danger small" data-a="abortDefi">Supprimer</button></div></div>
    ${over ? `<div class="banner ${success ? 'ok' : 'ko'}">${success ? 'Défi réussi ! La classe a atteint son objectif ensemble.' : `Temps écoulé : ${st.total} défis sur ${s.settings.objectif}.`}</div>` : ''}
    ${defiGauges(s, st)}
    ${st.blocked.size ? `<div class="panel tutors"><h3>Tuteurs en mission</h3><div class="chips">${[...st.blocked].map((p) => `<span class="chip on">${esc(nm(p))} aide <b>${esc(nm(st.tutors[p]))}</b></span>`).join('')}</div></div>` : ''}
    <div class="stu-grid">${students.map((p) => {
      const cls = st.blocked.has(p) ? 'tuteur' : st.n[p] === st.min && st.max > st.min ? 'fragile' : '';
      return `<button class="stu ${cls}" data-a="defiStudent" data-pid="${p}"><span class="stu-name">${esc(nm(p))}</span><span class="stu-n">${st.n[p]}</span>
        <span class="dots">${s.defis.map((d) => `<i class="${st.done[p].has(d.id) ? 'on' : ''}" title="${esc(d.titre)}"></i>`).join('')}</span>
        <span class="stu-tag">${cls === 'tuteur' ? `Tuteur → ${esc(nm(st.tutors[p]))}` : cls === 'fragile' ? `À aider${st.helpers[p] ? ' · ' + st.helpers[p].map(nm).map(esc).join(', ') : ''}` : '&nbsp;'}</span></button>`;
    }).join('')}</div>
    <h2 style="margin-top:1.6rem">Réussites par défi</h2>
    <div class="panel"><div class="table-wrap"><table><tbody>${s.defis.map((d) => `<tr><td class="num" style="width:3rem"><b>${esc(d.num ?? '')}</b></td><td>${esc(d.titre)}</td>
      <td style="width:45%"><div class="bar"><i style="width:${(100 * counts[d.id]) / Math.max(1, s.present.length)}%"></i></div></td><td class="num">${counts[d.id]}</td></tr>`).join('')}</tbody></table></div></div>`);
}

function vTabletDefi() {
  const s = S.session;
  if (!s) return '<div class="loading">Connexion au défi…</div>';
  const nm = (p) => shortName(s.people[p]);
  const st = defiState(s, nm);
  const over = timeOver();
  const pid = S.p.pid && s.present.includes(S.p.pid) ? S.p.pid : null;
  const header = `<header class="topbar"><div class="brand">Défi solidaire<small>${esc(s.className)}</small></div><div class="nav"></div>
    ${syncBadge()}${timerHtml(false)}${pid ? '<button class="btn small ghost" style="color:inherit" data-a="tdBack">Changer d\'élève</button>' : ''}</header>`;
  let body = defiGauges(s, st);
  if (over) body += `<div class="banner ko">Temps écoulé : plus de validation possible.</div>`;
  if (!pid) {
    body += `<h1>Qui es-tu ?</h1><div class="name-grid">${[...s.present].sort((a, b) => nm(a).localeCompare(nm(b), 'fr')).map((p) =>
      `<button class="name-btn ${st.blocked.has(p) ? 'tuteur' : ''}" data-a="tdPick" data-pid="${p}">${esc(nm(p))}<span>${st.n[p]} défi${st.n[p] > 1 ? 's' : ''}${st.blocked.has(p) ? ' · tuteur' : ''}</span></button>`).join('')}</div>
      <p style="margin-top:2rem"><button class="btn ghost small" data-a="tabletLeave">Quitter ce défi</button></p>`;
  } else {
    const blocked = st.blocked.has(pid);
    body += `<h1>${esc(nm(pid))} · ${st.n[pid]} défi${st.n[pid] > 1 ? 's' : ''} validé${st.n[pid] > 1 ? 's' : ''}</h1>`;
    if (blocked) body += `<div class="banner tuteur">Bravo, tu as ${st.n[pid] - st.min} défis d'avance ! Tu deviens tuteur : aide <b>${esc(nm(st.tutors[pid]))}</b> à réussir un défi. Tu pourras continuer dès que les plus fragiles auront progressé.</div>`;
    else if (st.helpers[pid]) body += `<div class="banner aide">${st.helpers[pid].map(nm).map(esc).join(' et ')} ${st.helpers[pid].length > 1 ? 'viennent' : 'vient'} t'aider. Choisissez un défi ensemble !</div>`;
    body += `<div class="defi-grid">${s.defis.map((d) => {
      const done = st.done[pid].has(d.id);
      return `<button class="defi-card pick ${done ? 'done' : ''}" data-a="tdDefi" data-id="${d.id}"><span class="defi-num">Défi ${esc(d.num ?? '')}${done ? ' · ✓ validé' : ''}</span>
        <h3>${esc(d.titre)}</h3>${courtSvg(d.schema)}<p class="small">${esc(d.but)}</p></button>`;
    }).join('')}</div>`;
  }
  return `${header}<main class="main">${body}</main>${footer()}`;
}

// Fiche d'un défi sur tablette : lire, valider avec un témoin, ou annuler
function renderTabletDefiModal() {
  const s = S.session, m = S.modal;
  const d = s.defis.find((x) => x.id === m.defiId);
  const nm = (p) => shortName(s.people[p]);
  const st = defiState(s, nm);
  const done = st.done[m.pid]?.has(d.id);
  let actions;
  if (m.step === 'witness') {
    return openModal(`<h2>Qui a vu ${esc(nm(m.pid))} réussir ?</h2><p class="muted">Le témoin touche son prénom pour confirmer le défi « ${esc(d.titre)} ».</p>
      <div class="name-grid">${s.present.filter((p) => p !== m.pid).sort((a, b) => nm(a).localeCompare(nm(b), 'fr')).map((p) => `<button class="name-btn" data-a="tdWitness" data-pid="${p}">${esc(nm(p))}</button>`).join('')}</div>
      <div class="modal-actions"><button class="btn" data-a="tdStep" data-v="fiche">Retour</button></div>`);
  }
  if (done) actions = `<button class="btn danger" data-a="tdCancel">Annuler ma validation</button>`;
  else if (timeOver()) actions = `<span class="muted">Temps écoulé.</span>`;
  else if (st.blocked.has(m.pid)) actions = `<span class="muted">Tu es tuteur : aide d'abord ${esc(nm(st.tutors[m.pid]))}.</span>`;
  else actions = `<button class="btn go big" data-a="tdStep" data-v="witness">J'ai réussi ce défi</button>`;
  openModal(`<h2>Défi ${esc(d.num ?? '')} · ${esc(d.titre)}</h2>${defiFiche(d)}
    <div class="modal-actions"><button class="btn" data-a="closeModal">Fermer</button>${actions}</div>`);
}

// Fiche élève côté professeur : valider ou annuler n'importe quel défi
function renderTeacherDefiModal() {
  const s = S.session, pid = S.modal.pid;
  const nm = (p) => p === 'prof' ? 'le professeur' : shortName(s.people[p]);
  const vals = Object.values(s.validations || {}).filter((v) => v.pid === pid);
  openModal(`<h2>${esc(nm(pid))}</h2><p class="muted small">Le professeur peut valider ou annuler un défi à tout moment, même si l'élève est tuteur.</p>
    <div class="stack">${s.defis.map((d) => {
      const v = vals.find((x) => x.defiId === d.id);
      return `<div class="row between"><span><b>${esc(d.num ?? '')}</b> ${esc(d.titre)}${v ? ` <span class="small muted">· témoin : ${esc(nm(v.witness))}</span>` : ''}</span>
        ${v ? `<button class="btn small danger" data-a="tdTeacherToggle" data-id="${d.id}">Annuler</button>` : `<button class="btn small go" data-a="tdTeacherToggle" data-id="${d.id}">Valider</button>`}</div>`;
    }).join('')}</div><div class="modal-actions"><span></span><button class="btn primary" data-a="closeModal">Fermer</button></div>`, 'narrow');
}
async function addValidation(pid, defiId, witness) {
  await updateDoc(sesRef(), { [`validations.${uid()}`]: { pid, defiId, witness, at: Date.now() }, updatedAt: Date.now() });
}
async function removeValidation(pid, defiId) {
  const upd = { updatedAt: Date.now() };
  Object.entries(S.session.validations || {}).filter(([, v]) => v.pid === pid && v.defiId === defiId).forEach(([k]) => (upd[`validations.${k}`] = deleteField()));
  await updateDoc(sesRef(), upd);
}

function vDefiHisto() {
  const h = (S.defiHistory || []).find((x) => x.id === S.p.id);
  if (!h) return shell('<div class="empty">Défi introuvable.</div>');
  const s = h.session;
  const nm = (p) => p === 'prof' ? 'professeur' : shortName(s.people[p]);
  const st = defiState(s, nm);
  return shell(`<div class="section-title"><div class="row"><button class="btn ghost" data-a="nav" data-v="defis">‹ Défi solidaire</button>
    <h1 style="margin:0">${esc(h.className)}</h1></div><span class="muted">${fmtDate(h.date)}</span></div>
    <div class="row" style="margin-bottom:1rem"><button class="btn" data-a="exportDefi" data-id="${h.id}">Exporter en Excel</button><button class="btn danger" data-a="deleteDefiHisto" data-id="${h.id}">Supprimer</button></div>
    <div class="banner ${h.success ? 'ok' : 'ko'}">${h.success ? 'Défi réussi' : 'Objectif non atteint'} : ${h.total} défis sur ${h.objectif}, écart final de ${h.ecart} (maximum ${st.E}), en ${s.settings.duration} minutes.</div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>Élève</th><th class="num">Défis</th><th>Défis validés</th></tr></thead><tbody>
    ${[...s.present].sort((a, b) => st.n[b] - st.n[a] || nm(a).localeCompare(nm(b), 'fr')).map((p) => `<tr><td>${esc(fullName(s.people[p]))}</td><td class="num"><b>${st.n[p]}</b></td>
      <td class="small">${s.defis.filter((d) => st.done[p].has(d.id)).map((d) => esc(d.num ?? d.titre)).join(', ')}</td></tr>`).join('')}</tbody></table></div></div>`);
}

Object.assign(A, {
  // ATP
  async atpReloadClasses() { await loadAtpClasses(); render(); },
  async atpLoad() {
    const w = S.wiz, c = getClass(w.classId), cls = document.getElementById('atpCls').value;
    const raw = await atpFetch(`tournaments/${encodeURIComponent(cls)}/students`);
    const list = matchAtp(parseAtpStudents(raw), c.students, c.atpMap?.[cls] || {});
    if (!list.length) return toast('Aucun élève dans cette classe ATP.', true);
    w.atp = { cls, list }; w.atpCls = cls; w.preview = null;
    await saveAtpMap(c);
    toast(`Classement ATP chargé : ${list.length} joueurs.`); render();
  },
  atpStatuses() {
    const w = S.wiz; let k = 0;
    w.atp.list.forEach((a) => { if (a.sid) { w.status[a.sid] = a.dispense ? 'dispense' : a.absent ? 'absent' : 'present'; k++; } });
    w.preview = null; toast(`Statuts repris de l'ATP pour ${k} élèves : vérifie-les.`); render();
  },
  // Défi : préparation
  dwAbsent: (el) => { S.dw.absent[el.dataset.sid] = !S.dw.absent[el.dataset.sid]; render(); },
  dwDefi: (el) => { const ids = S.dw.defiIds, id = el.dataset.id; S.dw.defiIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]; render(); },
  async launchDefi() {
    const dw = S.dw, c = getClass(dw.classId);
    const present = c.students.filter((s) => !dw.absent[s.id]).map((s) => s.id);
    const defis = S.teacher.defis.filter((d) => dw.defiIds.includes(d.id)).sort(byNum);
    const objectif = dw.objectif || Math.round(present.length * Math.min(4, defis.length));
    const code = await freeCode();
    const session = {
      code, type: 'defi', ownerUid: S.user.uid, ownerName: S.user.displayName || '', active: true, createdAt: Date.now(), updatedAt: Date.now(),
      classId: c.id, className: c.name,
      people: Object.fromEntries(c.students.map((s) => [s.id, { nom: s.nom, prenom: s.prenom, sexe: s.sexe || '', niveau: s.niveau }])),
      present, defis, settings: { duration: dw.duration, objectif, ecartMax: dw.ecartMax },
      timer: { duration: dw.duration * 60, endAt: null, remaining: dw.duration * 60000 }, validations: {},
    };
    await setDoc(doc(db, 'defiSessions', code), session);
    S.activeDefi.unshift(session); newDefiWizard();
    listenSession(code, 'defi-live', {}, 'defiSessions');
  },
  openDefiLive: (el) => listenSession(el.dataset.code, 'defi-live', {}, 'defiSessions'),
  // Défi : professeur
  defiStudent: (el) => { S.modal = { type: 'defiT', pid: el.dataset.pid }; renderTeacherDefiModal(); },
  async tdTeacherToggle(el) {
    const pid = S.modal.pid, id = el.dataset.id;
    const has = Object.values(S.session.validations || {}).some((v) => v.pid === pid && v.defiId === id);
    if (has) await removeValidation(pid, id); else await addValidation(pid, id, 'prof');
    if (S.modal?.type === 'defiT') renderTeacherDefiModal();
  },
  async endDefi() {
    const s = S.session;
    if (!(await confirmBox('Terminer le défi et l\'archiver ?', 'Terminer et archiver', false))) return;
    const st = defiState(s, (p) => shortName(s.people[p]));
    const { timer, ...data } = s;
    const rec = {
      date: s.createdAt, endedAt: Date.now(), classId: s.classId, className: s.className, session: { ...data, active: false },
      total: st.total, objectif: s.settings.objectif, ecart: st.ecart, success: st.total >= s.settings.objectif && st.ecart <= st.E, counts: st.n,
    };
    const id = (await addDoc(defiHistCol(), rec)).id;
    const code = s.code; stopLive();
    await deleteDoc(doc(db, 'defiSessions', code));
    S.activeDefi = S.activeDefi.filter((x) => x.code !== code);
    await loadDefiHistory(true); toast('Défi archivé.'); go('defi-histo', { id });
  },
  async abortDefi() {
    if (!(await confirmBox('Supprimer ce défi sans l\'archiver ?', 'Supprimer'))) return;
    const code = S.session.code; stopLive();
    await deleteDoc(doc(db, 'defiSessions', code)); S.activeDefi = S.activeDefi.filter((x) => x.code !== code); go('defis');
  },
  // Défi : tablette
  tdPick: (el) => { S.p.pid = el.dataset.pid; render(); window.scrollTo(0, 0); },
  tdBack: () => { S.p.pid = null; render(); },
  tdDefi: (el) => { S.modal = { type: 'defi', pid: S.p.pid, defiId: el.dataset.id, step: 'fiche' }; renderTabletDefiModal(); },
  tdStep: (el) => { S.modal.step = el.dataset.v; renderTabletDefiModal(); },
  async tdWitness(el) {
    const { pid, defiId } = S.modal;
    const st = defiState(S.session, (p) => shortName(S.session.people[p]));
    closeModal();
    if (st.done[pid].has(defiId)) return toast('Ce défi est déjà validé.');
    if (timeOver()) return toast('Temps écoulé.', true);
    if (st.blocked.has(pid)) return toast('Tu es tuteur : aide d\'abord tes camarades.', true);
    await addValidation(pid, defiId, el.dataset.pid);
    toast(`Bravo ${shortName(S.session.people[pid])} ! Défi validé.`);
    S.p.pid = null; render();
  },
  async tdCancel() {
    const { pid, defiId } = S.modal;
    if (!(await confirmBox('Annuler la validation de ce défi ?', 'Annuler la validation'))) return;
    await removeValidation(pid, defiId); toast('Validation annulée.'); render();
  },
  // Défi : fiches
  defiEdit(el) {
    const id = el.dataset.id;
    const max = Math.max(0, ...S.teacher.defis.map((d) => Number(d.num) || 0));
    const d = id ? S.teacher.defis.find((x) => x.id === id) : { num: max + 1, titre: '', but: '', consignes: '', criteres: '', materiel: '', schema: 'joueurs' };
    S.modal = { type: 'defiEdit', id };
    openModal(`<h2>${id ? 'Modifier le défi' : 'Nouveau défi'}</h2><div class="stack">
      <div class="row"><label class="f">Numéro<input type="number" id="de_num" value="${esc(d.num ?? '')}"></label><label class="f" style="flex:1">Titre<input id="de_titre" value="${esc(d.titre)}"></label></div>
      <label class="f">But<textarea id="de_but" rows="2">${esc(d.but)}</textarea></label>
      <label class="f">Consignes<textarea id="de_consignes" rows="3">${esc(d.consignes)}</textarea></label>
      <label class="f">Critères de réalisation<textarea id="de_criteres" rows="2">${esc(d.criteres)}</textarea></label>
      <label class="f">Matériel<input id="de_materiel" value="${esc(d.materiel)}"></label>
      <label class="f">Schéma<select id="de_schema" data-a-change="dePreview">${Object.entries(SCHEMAS).map(([k, l]) => `<option value="${k}" ${k === d.schema ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div id="de_prev" class="fiche">${courtSvg(d.schema)}</div></div>
      <div class="modal-actions"><button class="btn" data-a="closeModal">Annuler</button><button class="btn primary" data-a="defiSaveEdit">Enregistrer</button></div>`);
  },
  async defiSaveEdit() {
    const v = (k) => document.getElementById('de_' + k).value.trim();
    if (!v('titre')) return toast('Indique un titre.', true);
    const data = { num: v('num') === '' ? null : Number(v('num')), titre: v('titre'), but: v('but'), consignes: v('consignes'), criteres: v('criteres'), materiel: v('materiel'), schema: v('schema') };
    const id = S.modal.id;
    const defis = id ? S.teacher.defis.map((d) => (d.id === id ? { ...d, ...data } : d)) : [...S.teacher.defis, { id: uid(), ...data }];
    closeModal(); await saveTeacher({ defis });
    if (!id && S.dw) S.dw.defiIds.push(defis.at(-1).id);
    toast('Défi enregistré.'); render();
  },
  async defiDel(el) {
    const d = S.teacher.defis.find((x) => x.id === el.dataset.id);
    if (!(await confirmBox(`Supprimer le défi « ${d.titre} » ?`, 'Supprimer'))) return;
    await saveTeacher({ defis: S.teacher.defis.filter((x) => x.id !== d.id) });
    if (S.dw) S.dw.defiIds = S.dw.defiIds.filter((x) => x !== d.id);
    render();
  },
  async defiReset() {
    if (!(await confirmBox("Remettre les fiches d'origine ? Tes modifications et défis ajoutés seront perdus.", 'Remettre'))) return;
    const defis = DEFAULT_DEFIS.map((d) => ({ id: uid(), ...d }));
    await saveTeacher({ defis }); newDefiWizard(); render();
  },
  // Défi : historique
  openDefiHisto: (el) => go('defi-histo', { id: el.dataset.id }),
  async deleteDefiHisto(el) {
    if (!(await confirmBox('Supprimer définitivement ce défi de l\'historique ?', 'Supprimer'))) return;
    await deleteDoc(doc(defiHistCol(), el.dataset.id)); S.defiHistory = S.defiHistory.filter((h) => h.id !== el.dataset.id); go('defis');
  },
  exportDefi(el) {
    const h = S.defiHistory.find((x) => x.id === el.dataset.id), s = h.session;
    const nm = (p) => p === 'prof' ? 'Professeur' : fullName(s.people[p]);
    const st = defiState(s, nm);
    const eleves = s.present.map((p) => ({ Nom: s.people[p].nom, Prénom: s.people[p].prenom, 'Défis validés': st.n[p], Liste: s.defis.filter((d) => st.done[p].has(d.id)).map((d) => `${d.num ?? ''} ${d.titre}`.trim()).join(', ') }));
    const vals = Object.values(s.validations || {}).sort((a, b) => a.at - b.at).map((v) => {
      const d = s.defis.find((x) => x.id === v.defiId);
      return { Heure: new Date(v.at).toLocaleTimeString('fr-FR'), Élève: nm(v.pid), Défi: d ? `${d.num ?? ''} ${d.titre}`.trim() : '?', Témoin: nm(v.witness) };
    });
    exportXlsx([['Élèves', eleves], ['Validations', vals]], `Defi_${h.className}_${new Date(h.date).toISOString().slice(0, 10)}.xlsx`);
  },
});
Object.assign(C, {
  async atpLink(el) {
    const w = S.wiz, i = +el.dataset.i, sid = el.value;
    w.atp.list.forEach((a, j) => { if (j !== i && sid && a.sid === sid) a.sid = ''; });
    w.atp.list[i].sid = sid; w.atp.list[i].ambiguous = false; w.preview = null;
    await saveAtpMap(getClass(w.classId)); render();
  },
  dwClass(el) { S.dw.classId = el.value; S.dw.absent = {}; S.dw.objectif = 0; render(); },
  dwSet(el) { S.dw[el.dataset.k] = Math.max(el.dataset.k === 'objectif' ? 0 : 1, +el.value || 0); render(); },
  dePreview(el) { document.getElementById('de_prev').innerHTML = courtSvg(el.value); },
});

// ---------- Délégation des événements ----------
function setPath(obj, path, value) {
  const keys = path.split('.'); let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
}
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.a];
  if (!fn) return;
  e.preventDefault();
  try { await fn(el, e); } catch (err) { fail(err); }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.aChange && C[el.dataset.aChange]) { try { await C[el.dataset.aChange](el); } catch (err) { fail(err); } return; }
  if (el.dataset.bind && S.wiz) {
    setPath(S.wiz, el.dataset.bind, el.type === 'number' ? +el.value : el.value);
    if (!el.dataset.bind.startsWith('preview') && !['roles', 'courts'].includes(el.dataset.bind)) S.wiz.preview = null;
    if (el.dataset.bind === 'classId') S.wiz.atp = null;
    if ('rerender' in el.dataset) render();
  }
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.aInput === 'scIn' && S.modal?.m) { S.modal.m['score' + el.dataset.k] = Math.max(0, +el.value || 0); S.modal.m.forfait = null; }
  else if (el.dataset.bind && S.wiz && el.type !== 'number' && el.tagName === 'INPUT') setPath(S.wiz, el.dataset.bind, el.value);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$modal.hidden) closeModal(); if (e.key === 'Enter' && e.target.id === 'codeIn') A.joinCode().catch(fail); });

// ---------- Démarrage ----------
if (!configured) render();
else onAuthStateChanged(auth, async (user) => {
  S.user = user;
  try {
    if (!user) { stopLive(); go('login'); return; }
    if (user.isAnonymous) {
      const code = localStorage.getItem('tournoiCode');
      const coll = localStorage.getItem('tournoiColl') || 'sessions';
      if (code) {
        const snap = await getDoc(doc(db, coll, code));
        if (snap.exists() && snap.data().active) {
          listenSession(code, coll === 'sessions' ? 'tablet-pool' : 'tablet-defi', { pool: localStorage.getItem('tournoiPool') }, coll); return;
        }
        localStorage.removeItem('tournoiCode');
      }
      go('tablet-join'); return;
    }
    S.view = 'loading'; render();
    await loadTeacher();
    await Promise.all([loadClasses(), loadActive()]);
    go('seance');
  } catch (e) { fail(e); }
});
