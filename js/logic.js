// ============================================================
//  Logique pure (aucune dépendance à Firebase ni au DOM)
//  Poules, planning des rencontres, rôles, classement, montées/descentes
// ============================================================

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

export const DEFAULT_SETTINGS = {
  pts: { victoire: 3, nul: 2, defaite: 1, forfait: 0, bonus: 1, malus: 1 },
  roles: ['Arbitre', 'Coach', 'Observateur'],
  nUp: 1,
  nDown: 1,
  truncateNames: false,
};

// ---------- Import Excel ----------
const norm = (s) =>
  String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function normalizeSexe(v) {
  const s = norm(v);
  if (!s) return '';
  if (s.startsWith('f')) return 'F';
  if (s.startsWith('g') || s.startsWith('m') || s.startsWith('h')) return 'G';
  return '';
}

export function parseStudentRows(rows, { truncate = false } = {}) {
  let start = 0, iNom = 0, iPre = 1, iSexe = 2;
  const hdr = (rows[0] || []).map(norm);
  const iP = hdr.findIndex((h) => h.includes('prenom'));
  const iS = hdr.findIndex((h) => h.includes('sexe') || h.includes('genre') || h === 'sex' || h === 'f/g');
  const iN = hdr.findIndex((h) => h.includes('nom') && !h.includes('prenom'));
  if (iP >= 0 || iS >= 0 || iN >= 0) {
    start = 1;
    if (iN >= 0) iNom = iN;
    if (iP >= 0) iPre = iP;
    if (iS >= 0) iSexe = iS;
  }
  const out = [];
  for (const r of rows.slice(start)) {
    if (!r) continue;
    let nom = String(r[iNom] ?? '').trim();
    const prenom = String(r[iPre] ?? '').trim();
    if (!nom && !prenom) continue;
    if (truncate && nom) nom = nom[0].toUpperCase() + '.';
    out.push({ id: uid(), nom, prenom, sexe: normalizeSexe(r[iSexe]), niveau: 3 });
  }
  return out;
}

export const fullName = (p) => (p ? `${p.prenom || ''} ${p.nom || ''}`.trim() : '?');
export const shortName = (p) =>
  p ? `${p.prenom || ''}${p.nom ? ' ' + p.nom[0].toUpperCase() + '.' : ''}`.trim() : '?';

// ---------- Ordres de force ----------
// players : [{id, sexe, niveau, rankKey}] — rankKey plus petit = plus fort
function byStrength(a, b) {
  return a.rankKey - b.rankKey;
}

// Interclasse filles et garçons selon leur rang relatif, pour mélanger les sexes
function percentileMerge(items, sexeOf) {
  const groups = {};
  for (const it of items) {
    const g = sexeOf(it) || 'X';
    (groups[g] = groups[g] || []).push(it);
  }
  const keyed = [];
  for (const g of Object.keys(groups)) {
    const list = groups[g].sort(byStrength);
    list.forEach((it, i) => keyed.push({ it, k: (i + 0.5) / list.length }));
  }
  return keyed.sort((a, b) => a.k - b.k || a.it.rankKey - b.it.rankKey).map((x) => x.it);
}

function splitSizes(n, k) {
  // n éléments en k groupes de tailles aussi proches que possible
  const base = Math.floor(n / k), extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

function chunkBySizes(list, sizes) {
  const out = [];
  let i = 0;
  for (const s of sizes) { out.push(list.slice(i, i + s)); i += s; }
  return out;
}

function snake(list, k) {
  const out = Array.from({ length: k }, () => []);
  list.forEach((it, i) => {
    const round = Math.floor(i / k), pos = i % k;
    out[round % 2 === 0 ? pos : k - 1 - pos].push(it);
  });
  return out;
}

// ---------- Équipes / doublettes ----------
// Retourne des "entrées" : {id, members:[pid], rankKey, sexe}
export function buildEntries(players, teamSize, { mode = 'homogene', mixite = 'indifferent' } = {}) {
  if (teamSize <= 1) {
    return players.map((p) => ({ id: p.id, members: [p.id], rankKey: p.rankKey, sexe: p.sexe || 'X' }));
  }
  const groups = mixite === 'separe'
    ? [players.filter((p) => p.sexe === 'F'), players.filter((p) => p.sexe !== 'F')]
    : [players];
  const entries = [];
  for (const grp of groups) {
    if (!grp.length) continue;
    const ordered = mixite === 'mixte' ? percentileMerge(grp, (p) => p.sexe) : [...grp].sort(byStrength);
    const nTeams = Math.max(1, Math.floor(grp.length / teamSize));
    const teams = mode === 'equilibre' ? snake(ordered, nTeams) : chunkBySizes(ordered, splitSizes(grp.length, nTeams));
    for (const t of teams) {
      if (!t.length) continue;
      const sexes = new Set(t.map((p) => p.sexe || 'X'));
      entries.push({
        id: uid(),
        members: t.map((p) => p.id),
        rankKey: t.reduce((s, p) => s + p.rankKey, 0) / t.length,
        sexe: sexes.size === 1 ? [...sexes][0] : 'M',
      });
    }
  }
  return entries;
}

// ---------- Poules ----------
// Retourne [{id, name, group, entryIds}] — ordre = de la plus forte à la plus faible (par groupe)
export function makePools(entries, nPools, { mode = 'homogene', mixite = 'indifferent' } = {}) {
  nPools = Math.max(1, Math.min(nPools, entries.length || 1));
  let groups;
  if (mixite === 'separe') {
    const F = entries.filter((e) => e.sexe === 'F');
    const G = entries.filter((e) => e.sexe !== 'F');
    if (!F.length || !G.length || nPools < 2) {
      groups = [{ key: F.length && !G.length ? 'F' : G.length && !F.length ? 'G' : 'all', list: entries, n: nPools }];
    } else {
      let nF = Math.round((nPools * F.length) / entries.length);
      nF = Math.min(Math.max(nF, 1), nPools - 1);
      groups = [
        { key: 'F', list: F, n: Math.min(nF, F.length) },
        { key: 'G', list: G, n: Math.min(nPools - nF, G.length) },
      ];
    }
  } else {
    groups = [{ key: 'all', list: entries, n: nPools }];
  }

  const pools = [];
  for (const g of groups) {
    const ordered = mixite === 'mixte' ? percentileMerge(g.list, (e) => e.sexe) : [...g.list].sort(byStrength);
    const parts = mode === 'equilibre' ? snake(ordered, g.n) : chunkBySizes(ordered, splitSizes(ordered.length, g.n));
    parts.forEach((p) => {
      pools.push({ id: uid(), name: '', group: g.key, entryIds: p.map((e) => e.id), officials: [] });
    });
  }
  const label = { F: 'Filles', G: 'Garçons', all: '' };
  const counters = {};
  pools.forEach((p) => {
    counters[p.group] = (counters[p.group] || 0) + 1;
    p.name = `Poule ${label[p.group] ? label[p.group] + ' ' : ''}${counters[p.group]}`;
  });
  return pools;
}

// ---------- Planning : tout le monde se rencontre ----------
export function roundRobin(ids) {
  const arr = [...ids];
  if (arr.length < 2) return [];
  if (arr.length % 2) arr.push(null);
  const n = arr.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a !== null && b !== null) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

// Construit les matchs d'une poule avec rotations et rôles
// entries : {eid:{members}} ; roles : ['Arbitre', ...] ; courts : terrains par poule
export function buildPoolMatches(pool, entries, roles, courts = 1) {
  const rounds = roundRobin(pool.entryIds);
  const slots = [];
  for (const pairs of rounds) {
    for (let i = 0; i < pairs.length; i += courts) slots.push(pairs.slice(i, i + courts));
  }
  const allPeople = [...pool.entryIds.flatMap((eid) => entries[eid]?.members || []), ...(pool.officials || [])];
  const roleCount = Object.fromEntries(allPeople.map((p) => [p, { total: 0 }]));
  const matches = [];
  slots.forEach((slot, si) => {
    const playing = new Set(slot.flatMap(([a, b]) => [...entries[a].members, ...entries[b].members]));
    let available = allPeople.filter((p) => !playing.has(p));
    slot.forEach(([a, b], ci) => {
      const assigned = {};
      for (const role of roles) {
        if (!available.length) break;
        available.sort((x, y) =>
          (roleCount[x][role] || 0) - (roleCount[y][role] || 0) || roleCount[x].total - roleCount[y].total);
        const who = available.shift();
        assigned[role] = who;
        roleCount[who][role] = (roleCount[who][role] || 0) + 1;
        roleCount[who].total++;
      }
      matches.push({
        id: uid(), pool: pool.id, slot: si + 1, court: ci + 1, a, b,
        scoreA: null, scoreB: null, fpA: 0, fpB: 0, forfait: null, done: false, roles: assigned,
      });
    });
  });
  return matches;
}

// ---------- Classement ----------
function outcome(m) {
  // Renvoie [résultatA, résultatB] parmi V N D F
  if (m.forfait === 'A') return ['F', 'V'];
  if (m.forfait === 'B') return ['V', 'F'];
  if (m.forfait === 'AB') return ['F', 'F'];
  const a = Number(m.scoreA) || 0, b = Number(m.scoreB) || 0;
  if (a > b) return ['V', 'D'];
  if (a < b) return ['D', 'V'];
  return ['N', 'N'];
}

const RES_PTS = (pts) => ({ V: pts.victoire, N: pts.nul, D: pts.defaite, F: pts.forfait });
export const fpPoints = (fp, pts) => (fp > 0 ? pts.bonus : fp < 0 ? -pts.malus : 0);

export function computeStandings(entryIds, matches, pts) {
  const R = RES_PTS(pts);
  const s = Object.fromEntries(entryIds.map((id) => [id, { id, j: 0, v: 0, n: 0, d: 0, f: 0, pm: 0, pc: 0, fp: 0, pts: 0 }]));
  const played = matches.filter((m) => m.done && s[m.a] && s[m.b]);
  for (const m of played) {
    const [ra, rb] = outcome(m);
    const sa = Number(m.scoreA) || 0, sb = Number(m.scoreB) || 0;
    for (const [id, r, pf, pa, fp] of [[m.a, ra, sa, sb, m.fpA || 0], [m.b, rb, sb, sa, m.fpB || 0]]) {
      const x = s[id];
      x.j++; x.pm += pf; x.pc += pa;
      x[{ V: 'v', N: 'n', D: 'd', F: 'f' }[r]]++;
      const fpp = fpPoints(fp, pts);
      x.fp += fpp;
      x.pts += R[r] + fpp;
    }
  }
  const list = Object.values(s);
  // Départage : points, confrontation directe, différence, fair-play, points marqués
  const h2h = (group) => {
    const ids = new Set(group.map((x) => x.id));
    const res = Object.fromEntries(group.map((x) => [x.id, 0]));
    for (const m of played) {
      if (!ids.has(m.a) || !ids.has(m.b)) continue;
      const [ra, rb] = outcome(m);
      res[m.a] += R[ra]; res[m.b] += R[rb];
    }
    return res;
  };
  list.sort((a, b) => b.pts - a.pts);
  const out = [];
  let i = 0;
  while (i < list.length) {
    let j = i;
    while (j < list.length && list[j].pts === list[i].pts) j++;
    const group = list.slice(i, j);
    if (group.length > 1) {
      const H = h2h(group);
      group.sort((a, b) => H[b.id] - H[a.id] || (b.pm - b.pc) - (a.pm - a.pc) || b.fp - a.fp || b.pm - a.pm);
    }
    out.push(...group);
    i = j;
  }
  out.forEach((x, k) => (x.rank = k + 1));
  return out;
}

// ---------- Montées / descentes ----------
// pools dans l'ordre (plus forte d'abord). Retourne {pid:{group, pos, rank, move}}
// move : -1 = monte, +1 = descend, 0 = reste
export function computeMoves(session) {
  const { pools, entries, matches, settings } = session;
  const all = Object.values(matches || {});
  const res = {};
  const byGroup = {};
  pools.forEach((p) => (byGroup[p.group] = byGroup[p.group] || []).push(p));
  for (const [group, list] of Object.entries(byGroup)) {
    list.forEach((pool, pos) => {
      const st = computeStandings(pool.entryIds, all.filter((m) => m.pool === pool.id), settings.pts);
      const n = st.length;
      st.forEach((row, k) => {
        let move = 0;
        if (pos > 0 && k < settings.nUp) move = -1;
        else if (pos < list.length - 1 && k >= n - settings.nDown && n > settings.nUp) move = 1;
        for (const pid of entries[row.id]?.members || []) res[pid] = { group, pos, rank: row.rank, move, poolName: pool.name };
      });
      for (const pid of pool.officials || []) if (!res[pid]) res[pid] = { group, pos, rank: null, move: 0, poolName: pool.name };
    });
  }
  return res;
}
