// Mode DÉMO : fonctionne sans Firebase, données gardées dans ce navigateur uniquement.
// Sert à essayer l'application avant la mise en place. Rien n'est envoyé au bureau.
const CLE = 'fermes-demo-v1';
let etat = charger();
const abonnes = new Set();

function charger() {
  try { const s = localStorage.getItem(CLE); if (s) return JSON.parse(s, reviver); } catch {}
  return { fermes: [], parcelles: [], produits: [], cibles: [], utilisateurs: [], operations: [], historique: {}, photos: {}, init: false };
}
function reviver(k, v) { return typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/.test(v) ? new Date(v) : v; }
function sauver() { try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch {} abonnes.forEach(f => f()); }
const uid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const copie = o => JSON.parse(JSON.stringify(o), reviver);

const COMPTES = [
  { uid: 'demo-terrain', nom: 'Ouvrier (démo)', identifiant: 'ouvrier', role: 'terrain', actif: true },
  { uid: 'demo-bureau', nom: 'Bureau (démo)', identifiant: 'bureau', role: 'bureau', actif: true },
  { uid: 'demo-admin', nom: 'Administrateur (démo)', identifiant: 'admin', role: 'admin', actif: true },
];
const PRODUITS_DEMO = [
  ['Nitrate de potassium (démo)', 'Engrais', 'kg'], ['Acide humique (démo)', 'Biostimulant', 'L'],
  ['Sulfate de magnésium (démo)', 'Engrais', 'kg'], ['Chélate de fer (démo)', 'Correcteur', 'g'],
  ['Insecticide A (démo)', 'Insecticide', 'L'], ['Fongicide B (démo)', 'Fongicide', 'kg'],
  ['Acaricide C (démo)', 'Acaricide', 'L'], ['Mouillant (démo)', 'Adjuvant', 'L'],
];

let utilisateurCourant = null;
let cbAuth = null;

export function creerBackend() {
  if (!etat.utilisateurs.length) {
    etat.utilisateurs = COMPTES.map(c => ({ id: c.uid, ...c }));
    etat.produits = PRODUITS_DEMO.map(([nom, categorie, uniteBase]) => ({ id: uid(), nom, categorie, uniteBase, actif: true }));
    etat.init = true;
    sauver();
  }
  try { utilisateurCourant = JSON.parse(sessionStorage.getItem(CLE + '-session')); } catch {}
  return {
    mode: 'demo',
    onAuth(cb) { cbAuth = cb; setTimeout(() => cb(utilisateurCourant), 0); return () => {}; },
    async login(identifiant) {
      const u = etat.utilisateurs.find(x => x.identifiant === String(identifiant).trim().toLowerCase());
      if (!u) throw new Error('auth/invalid-credential');
      utilisateurCourant = { uid: u.id, identifiant: u.identifiant };
      sessionStorage.setItem(CLE + '-session', JSON.stringify(utilisateurCourant));
      cbAuth && cbAuth(utilisateurCourant);
    },
    async logout() { utilisateurCourant = null; sessionStorage.removeItem(CLE + '-session'); cbAuth && cbAuth(null); },
    async changerMotDePasse() {},
    async profil(id) { const u = etat.utilisateurs.find(x => x.id === id); return u ? copie(u) : null; },
    async estInitialise() { return true; },
    async devenirAdmin() {},
    async creerUtilisateur({ nom, identifiant, role }) {
      etat.utilisateurs.push({ id: uid(), nom, identifiant: identifiant.trim().toLowerCase(), role, actif: true }); sauver();
    },
    nouvelId() { return uid(); },
    surveillerListe(nom, cb) {
      const f = () => cb(copie(etat[nom])); abonnes.add(f); setTimeout(f, 0); return () => abonnes.delete(f);
    },
    enregistrerElement(nom, el) {
      const id = el.id || uid(); const i = etat[nom].findIndex(x => x.id === id);
      const clean = Object.fromEntries(Object.entries(el).filter(([k]) => !k.startsWith('_')));
      if (i >= 0) etat[nom][i] = { ...etat[nom][i], ...clean, id }; else etat[nom].push({ ...clean, id });
      sauver(); return id;
    },
    async initialiser(d) {
      for (const [n, l] of Object.entries(d)) for (const el of l) etat[n].push({ ...el, id: el.id || uid() });
      sauver();
    },
    surveillerMesOps(u, cb) {
      const f = () => cb(copie(etat.operations.filter(o => o.auteurUid === u)), { attente: 0, cache: false });
      abonnes.add(f); setTimeout(f, 0); return () => abonnes.delete(f);
    },
    surveillerOpsDepuis(depuis, cb) {
      const f = () => cb(copie(etat.operations.filter(o => o.date >= depuis)), { nouvelles: [] });
      abonnes.add(f); setTimeout(f, 0); return () => abonnes.delete(f);
    },
    async lireOp(id) { const o = etat.operations.find(x => x.id === id); return o ? copie(o) : null; },
    enregistrerOp(op, { nouveau, avant, utilisateur }) {
      const clean = Object.fromEntries(Object.entries(op).filter(([k]) => !k.startsWith('_')));
      if (nouveau) etat.operations.push({ ...clean, creeServeur: new Date(), annule: false });
      else {
        const i = etat.operations.findIndex(x => x.id === op.id);
        const anc = etat.operations[i];
        etat.operations[i] = { ...anc, ...clean, auteurUid: anc.auteurUid, auteurNom: anc.auteurNom, saisiLe: anc.saisiLe,
          creeServeur: anc.creeServeur, modifieLe: new Date(), modifiePar: utilisateur.nom, nbModifs: (anc.nbModifs || 0) + 1 };
        (etat.historique[op.id] ||= []).push({ id: uid(), le: new Date(), parUid: utilisateur.uid, parNom: utilisateur.nom,
          avant: Object.fromEntries(Object.entries(avant).filter(([k]) => !k.startsWith('_'))), motif: op._motif || '' });
      }
      sauver();
    },
    enregistrerPhoto(opId, dataUrl) { etat.photos[opId] = dataUrl; sauver(); },
    async lirePhoto(opId) { return etat.photos[opId] || null; },
    async lireHistorique(opId) { return copie((etat.historique[opId] || []).slice().reverse()); },
    reinitialiserDemo() { localStorage.removeItem(CLE); sessionStorage.removeItem(CLE + '-session'); location.reload(); },
  };
}
