import * as K from './calc.js';
import { creerXlsx } from './xlsx.js';
import { DONNEES_DEPART } from './donnees-depart.js';

export const VERSION = '1.0.0';
const DELAI_CORRECTION_H = 24;
const CONFIG = window.FIREBASE_CONFIG || {};

let B = null; // accès aux données (Firebase ou démo)
const S = {
  user: null, profil: null,
  fermes: [], parcelles: [], produits: [], cibles: [], utilisateurs: [],
  mesOps: [], attente: 0, opsBureau: [], depuisBureau: null,
  filtre: null, vueProduits: 'quantite', ongletListes: 'parcelles', ongletHisto: 'miennes',
};
const desabos = [];
let F = null; // état du formulaire en cours

// ───────────────────────── Outils d'affichage ─────────────────────────
function h(tag, attrs, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of enfants.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const $ = s => document.querySelector(s);
const num = s => { const x = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : NaN; };
const fmt = K.arrondi;
const pad = n => String(n).padStart(2, '0');
const dateLocale = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const jourIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = d => d ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtJour = d => d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const estBureau = () => S.profil && (S.profil.role === 'bureau' || S.profil.role === 'admin');
const estAdmin = () => S.profil && S.profil.role === 'admin';
const actifs = l => l.filter(x => x.actif !== false);
const tri = (a, b) => (a.ordre ?? 999) - (b.ordre ?? 999) || String(a.nom).localeCompare(String(b.nom), 'fr');
const ferme = id => S.fermes.find(f => f.id === id);
const parcelle = id => S.parcelles.find(p => p.id === id);
const codeFerme = id => { const f = ferme(id); return f ? (f.code || f.nom) : '?'; };
const triOps = (a, b) => (b.date - a.date) || ((b.saisiLe || 0) - (a.saisiLe || 0));
const libParcelle = p => `${codeFerme(p.fermeId)} · ${p.nom}`;

function toast(msg, type = '') {
  const t = h('div', { class: 'toast ' + type }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('visible'), 10);
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 400); }, type === 'erreur' ? 8000 : 4000);
}

function modal(titre, contenu, boutons) {
  return new Promise(resolve => {
    const fond = h('div', { class: 'modal-fond' });
    const fermer = v => { fond.remove(); resolve(v); };
    const boite = h('div', { class: 'modal' },
      h('div', { class: 'modal-titre' }, h('span', {}, titre), h('button', { class: 'btn-icone', onclick: () => fermer(null), 'aria-label': 'Fermer' }, '✕')),
      h('div', { class: 'modal-corps' }, contenu),
      boutons ? h('div', { class: 'modal-pied' }, boutons.map(b => h('button', { class: 'btn ' + (b.classe || ''), onclick: () => { const v = b.valeur ? b.valeur() : true; if (v !== undefined) fermer(v); } }, b.label))) : null);
    fond.append(boite);
    fond.addEventListener('click', e => { if (e.target === fond) fermer(null); });
    document.body.append(fond);
    const premier = boite.querySelector('input[type=search], input:not([type=checkbox])');
    if (premier && premier.type === 'search') setTimeout(() => premier.focus(), 50);
  });
}

/** Liste de choix à gros boutons, avec recherche. elements : [{id, label, sous, groupe}] */
function choisir(titre, elements, recherche = true) {
  const liste = h('div', { class: 'choix-liste' });
  let resoudre;
  const p = new Promise(r => resoudre = r);
  const dessiner = filtreTxt => {
    liste.innerHTML = '';
    const f = (filtreTxt || '').toLowerCase();
    let groupe = null;
    const vus = elements.filter(e => !f || (e.label + ' ' + (e.sous || '') + ' ' + (e.groupe || '')).toLowerCase().includes(f));
    if (!vus.length) liste.append(h('p', { class: 'vide' }, 'Aucun résultat.'));
    for (const e of vus) {
      if (e.groupe && e.groupe !== groupe) { groupe = e.groupe; liste.append(h('div', { class: 'choix-groupe' }, groupe)); }
      liste.append(h('button', { class: 'choix', onclick: () => resoudre(e.id) }, h('b', {}, e.label), e.sous ? h('small', {}, e.sous) : null));
    }
  };
  dessiner('');
  const contenu = [recherche && elements.length > 8 ? h('input', { type: 'search', class: 'champ', placeholder: '🔍 Rechercher…', oninput: e => dessiner(e.target.value) }) : null, liste];
  modal(titre, contenu).then(v => resoudre(v));
  return p.then(v => { document.querySelectorAll('.modal-fond').forEach(m => m.remove()); return v; });
}

/** Petit formulaire en fenêtre. champs : [{cle, label, type, options, aide, requis, min}] */
function formulaire(titre, champs, valeurs = {}) {
  const els = {};
  const erreurs = h('div', { class: 'erreurs' });
  const corps = [erreurs, champs.map(c => {
    let input;
    const v = valeurs[c.cle];
    if (c.type === 'select') input = h('select', { class: 'champ' }, c.options.map(o => h('option', { value: o.v, selected: String(o.v) === String(v ?? '') }, o.l)));
    else if (c.type === 'case') input = h('input', { type: 'checkbox', checked: v !== false });
    else input = h('input', { class: 'champ', type: c.type === 'nombre' ? 'text' : (c.type || 'text'), inputmode: c.type === 'nombre' ? 'decimal' : null, value: v ?? '', autocomplete: 'off', autocapitalize: c.type === 'password' ? 'off' : null });
    els[c.cle] = input;
    return c.type === 'case' ? h('label', { class: 'case' }, input, ' ', c.label)
      : h('label', { class: 'bloc' }, h('span', { class: 'etiquette' }, c.label), input, c.aide ? h('small', { class: 'aide' }, c.aide) : null);
  })];
  return modal(titre, corps, [
    { label: 'Annuler', valeur: () => null },
    { label: 'Enregistrer', classe: 'principal', valeur: () => {
      const r = {}; const e = [];
      for (const c of champs) {
        const el = els[c.cle];
        if (c.type === 'case') r[c.cle] = el.checked;
        else if (c.type === 'nombre') {
          r[c.cle] = el.value.trim() === '' ? null : num(el.value);
          if (c.requis && r[c.cle] == null) e.push(`${c.label} : obligatoire.`);
          else if (r[c.cle] != null && (isNaN(r[c.cle]) || r[c.cle] < (c.min ?? 0))) e.push(`${c.label} : nombre invalide.`);
        } else {
          r[c.cle] = el.value.trim();
          if (c.requis && !r[c.cle]) e.push(`${c.label} : obligatoire.`);
          if (c.min && r[c.cle].length < c.min) e.push(`${c.label} : au moins ${c.min} caractères.`);
        }
      }
      if (e.length) { erreurs.innerHTML = ''; erreurs.append(...e.map(x => h('div', {}, '⚠ ' + x))); return undefined; }
      return r;
    } },
  ]);
}

function bip() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(); const g = c.createGain();
    o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); setTimeout(() => { o.stop(); c.close(); }, 250);
  } catch {}
}

// ───────────────────────── Démarrage ─────────────────────────
async function demarrer() {
  if (CONFIG.apiKey) {
    try { const m = await import('./backend-firebase.js'); B = m.creerBackend(CONFIG); }
    catch (e) {
      console.error(e);
      $('#app').innerHTML = '';
      $('#app').append(h('div', { class: 'ecran-centre' }, h('h2', {}, 'Impossible de démarrer'),
        h('p', {}, 'La première ouverture de l\'application doit se faire avec une connexion Internet. Vérifiez le réseau puis réessayez.'),
        h('button', { class: 'btn principal', onclick: () => location.reload() }, 'Réessayer')));
      return;
    }
  } else {
    const m = await import('./backend-demo.js'); B = m.creerBackend();
  }
  window.addEventListener('online', majStatut);
  window.addEventListener('offline', majStatut);
  window.addEventListener('hashchange', afficher);
  window.addEventListener('erreur-envoi', e => {
    const code = (e.detail && e.detail.code) || '';
    toast(code.includes('permission') ? 'Une saisie a été refusée par le serveur (droits insuffisants ou délai de correction de 24 h dépassé).'
      : 'Erreur d\'envoi : ' + (e.detail && e.detail.message || e.detail), 'erreur');
  });
  B.onAuth(async u => {
    desabos.splice(0).forEach(f => { try { f(); } catch {} });
    S.user = u; S.profil = null;
    if (!u) return ecranConnexion();
    let profil;
    try { profil = await B.profil(u.uid); }
    catch (e) { return ecranMessage('Connexion à Internet nécessaire', 'Pour la toute première connexion sur ce téléphone, il faut du réseau. Réessayez quand la connexion est disponible.', true); }
    if (!profil) {
      let init = true;
      try { init = await B.estInitialise(); } catch {}
      if (!init) return ecranPremierAdmin();
      return ecranMessage('Compte non autorisé', 'Ce compte n\'est pas encore enregistré dans l\'application. Demandez à l\'administrateur de le créer.', true);
    }
    if (profil.actif === false) return ecranMessage('Compte désactivé', 'Ce compte a été désactivé par l\'administrateur.', true);
    S.profil = profil;
    lancerAbonnements();
    afficher();
  });
}

function lancerAbonnements() {
  for (const n of ['fermes', 'parcelles', 'produits', 'cibles'])
    desabos.push(B.surveillerListe(n, l => { S[n] = l.sort(tri); rafraichirSiPasFormulaire(); }));
  if (estBureau()) desabos.push(B.surveillerListe('utilisateurs', l => { S.utilisateurs = l.sort(tri); rafraichirSiPasFormulaire(); }));
  desabos.push(B.surveillerMesOps(S.user.uid, (l, meta) => {
    S.mesOps = l.sort(triOps); S.attente = meta.attente; majStatut(); rafraichirSiPasFormulaire();
  }));
  if (estBureau()) {
    const d = new Date(); S.filtre = { du: jourIso(new Date(d.getFullYear(), 0, 1)), au: jourIso(d), fermeId: '', parcelleId: '' };
    surveillerBureau(new Date(d.getFullYear(), 0, 1));
  }
}

function surveillerBureau(depuis) {
  if (S._desaboBureau) S._desaboBureau();
  S.depuisBureau = depuis;
  S._desaboBureau = B.surveillerOpsDepuis(depuis, (l, meta) => {
    S.opsBureau = l.sort(triOps);
    for (const op of meta.nouvelles || []) {
      if (op.auteurUid === S.user.uid) continue;
      const msg = `Nouvelle saisie : ${op.type === 'irrigation' ? 'irrigation' : 'traitement'} — ${(op.parcelles || []).map(p => p.nom).join(', ')} (${op.auteurNom})`;
      toast('🔔 ' + msg); bip();
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) try { new Notification('Suivi des fermes', { body: msg, icon: 'icons/icon-192.png' }); } catch {}
    }
    rafraichirSiPasFormulaire();
  });
  desabos.push(() => S._desaboBureau && S._desaboBureau());
}

function rafraichirSiPasFormulaire() {
  const r = route()[0];
  if (r === 'irrigation' || r === 'traitement') return; // ne pas effacer une saisie en cours
  if ($('.modal-fond')) return;
  afficher();
}

function majStatut() {
  const el = $('#statut'); if (!el) return;
  const enLigne = navigator.onLine;
  el.className = 'statut ' + (!enLigne ? 'hors' : S.attente ? 'attente' : 'ok');
  el.textContent = !enLigne ? (S.attente ? `📴 Hors connexion · ${S.attente} en attente` : '📴 Hors connexion')
    : S.attente ? `⏳ Envoi de ${S.attente} saisie(s)…` : '✅ À jour';
}

// ───────────────────────── Écrans simples ─────────────────────────
function ecranConnexion() {
  const app = $('#app'); app.innerHTML = '';
  const id = h('input', { class: 'champ grand', placeholder: 'Identifiant', autocapitalize: 'off', autocomplete: 'username' });
  const mdp = h('input', { class: 'champ grand', type: 'password', placeholder: 'Mot de passe', autocomplete: 'current-password' });
  const msg = h('div', { class: 'erreurs' });
  const go = async () => {
    msg.textContent = '';
    if (!id.value.trim() || (B.mode !== 'demo' && !mdp.value)) { msg.textContent = 'Saisissez votre identifiant et votre mot de passe.'; return; }
    try { await B.login(id.value, mdp.value); }
    catch (e) {
      const c = String(e.code || e.message);
      msg.textContent = c.includes('network') ? 'Pas de réseau : la première connexion demande Internet.'
        : c.includes('too-many') ? 'Trop d\'essais. Patientez quelques minutes.' : 'Identifiant ou mot de passe incorrect.';
    }
  };
  mdp.addEventListener('keydown', e => e.key === 'Enter' && go());
  app.append(h('div', { class: 'ecran-centre connexion' },
    h('img', { src: 'icons/icon-192.png', alt: '', class: 'logo' }),
    h('h1', {}, 'Suivi des fermes'),
    B.mode === 'demo' ? h('div', { class: 'carte info' }, h('b', {}, 'Mode démonstration'), h('p', {}, 'Firebase n\'est pas encore configuré. Les données restent sur cet appareil. Choisissez un profil pour essayer :'),
      h('div', { class: 'grille-boutons' }, [['ouvrier', '👷 Ouvrier (terrain)'], ['bureau', '🏢 Bureau'], ['admin', '🔑 Administrateur']]
        .map(([i, l]) => h('button', { class: 'btn', onclick: () => B.login(i) }, l)))) : null,
    B.mode !== 'demo' ? [id, mdp, msg, h('button', { class: 'btn principal grand', onclick: go }, 'Se connecter')] : null,
    h('small', { class: 'version' }, 'Version ' + VERSION)));
}

function ecranMessage(titre, texte, deconnexion) {
  const app = $('#app'); app.innerHTML = '';
  app.append(h('div', { class: 'ecran-centre' }, h('h2', {}, titre), h('p', {}, texte),
    deconnexion ? h('button', { class: 'btn', onclick: () => B.logout() }, 'Se déconnecter') : null));
}

function ecranPremierAdmin() {
  const app = $('#app'); app.innerHTML = '';
  const nom = h('input', { class: 'champ grand', placeholder: 'Votre nom (ex. : Sofiane)' });
  const msg = h('div', { class: 'erreurs' });
  app.append(h('div', { class: 'ecran-centre' },
    h('h2', {}, 'Première installation'),
    h('p', {}, 'Aucun administrateur n\'existe encore. Ce compte va devenir l\'administrateur de l\'application.'),
    nom, msg,
    h('button', { class: 'btn principal grand', onclick: async () => {
      if (!nom.value.trim()) { msg.textContent = 'Indiquez votre nom.'; return; }
      try { await B.devenirAdmin(S.user.uid, nom.value.trim(), S.user.identifiant); location.reload(); }
      catch (e) { msg.textContent = 'Échec : ' + (e.message || e) + '. Vérifiez la connexion et les règles de sécurité.'; }
    } }, 'Devenir administrateur'),
    h('button', { class: 'btn', onclick: () => B.logout() }, 'Annuler')));
}

// ───────────────────────── Navigation ─────────────────────────
function route() { return (location.hash.replace(/^#\/?/, '') || 'accueil').split('/'); }
function aller(r) { if (location.hash === '#/' + r) afficher(); else location.hash = '#/' + r; }

function cadre(titre, contenu, { retour } = {}) {
  const app = $('#app'); app.innerHTML = '';
  const onglets = [['accueil', '🏠', 'Accueil'], ['historique', '📋', estBureau() ? 'Historique' : 'Mes saisies']];
  if (estBureau()) onglets.push(['tableau', '📊', 'Tableau'], ['listes', '⚙️', 'Listes']);
  onglets.push(['compte', '👤', 'Compte']);
  const r = route()[0];
  app.append(
    h('header', { class: 'barre' },
      retour ? h('button', { class: 'btn-icone', onclick: () => history.length > 1 ? history.back() : aller(retour), 'aria-label': 'Retour' }, '←') : h('img', { src: 'icons/icon-192.png', class: 'mini-logo', alt: '' }),
      h('div', { class: 'barre-titre' }, titre),
      h('div', { id: 'statut', class: 'statut' })),
    B.mode === 'demo' ? h('div', { class: 'bandeau-demo' }, 'MODE DÉMO — données locales, non envoyées') : null,
    h('main', { class: 'contenu' + (estBureau() && ['tableau', 'historique', 'listes', 'fiche'].includes(r) ? ' large' : '') }, contenu),
    h('nav', { class: 'onglets' }, onglets.map(([k, i, l]) => h('a', { href: '#/' + k, class: r === k ? 'actif' : '' }, h('span', { class: 'ico' }, i), h('span', {}, l)))));
  majStatut();
  window.scrollTo(0, 0);
}

function afficher() {
  if (!S.profil) return;
  const [r, a] = route();
  if (r !== 'irrigation' && r !== 'traitement') F = null;
  switch (r) {
    case 'irrigation': return ecranIrrigation(a);
    case 'traitement': return ecranTraitement(a);
    case 'historique': return ecranHistorique();
    case 'op': return ecranOperation(a);
    case 'tableau': return estBureau() ? ecranTableau() : aller('accueil');
    case 'fiche': return estBureau() ? ecranFiche(a) : aller('accueil');
    case 'listes': return estBureau() ? ecranListes() : aller('accueil');
    case 'compte': return ecranCompte();
    default: return ecranAccueil();
  }
}

// ───────────────────────── Accueil ─────────────────────────
function ecranAccueil() {
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const nbAuj = S.mesOps.filter(o => o.saisiLe >= auj && !o.annule).length;
  const dernier = S._derniere && Date.now() - S._derniere.le < 20000;
  cadre('Suivi des fermes', [
    h('p', { class: 'bonjour' }, `Bonjour ${S.profil.nom}`),
    dernier ? h('div', { class: 'carte succes' }, h('b', {}, '✓ Saisie enregistrée'),
      h('p', {}, navigator.onLine ? 'Elle est envoyée au bureau.' : 'Pas de réseau : elle est gardée sur le téléphone et partira toute seule quand le réseau reviendra. Ouvrez l\'application une fois en zone couverte.')) : null,
    !S.parcelles.length ? h('div', { class: 'carte info' }, estBureau()
      ? [h('b', {}, 'Aucune parcelle'), h('p', {}, 'Commencez par charger la liste de départ dans « Listes ».'), h('a', { class: 'btn', href: '#/listes' }, 'Ouvrir les listes')]
      : h('p', {}, 'Les listes ne sont pas encore chargées. Connectez-vous au réseau une première fois.')) : null,
    S.parcelles.length && !S.produits.length && estBureau() ? h('div', { class: 'carte info' }, h('p', {}, 'Aucun produit dans la liste : ajoutez vos produits dans « Listes > Produits » avant la première fertigation ou le premier traitement.'), h('a', { class: 'btn', href: '#/listes/produits' }, 'Ajouter des produits')) : null,
    h('div', { class: 'gros-boutons' },
      h('a', { class: 'gros eau', href: '#/irrigation' }, h('span', { class: 'ico' }, '💧'), h('span', {}, 'Irrigation', h('br'), h('small', {}, 'eau claire ou fertigation'))),
      h('a', { class: 'gros traitement', href: '#/traitement' }, h('span', { class: 'ico' }, '🌿'), h('span', {}, 'Traitement', h('br'), h('small', {}, 'atomiseur (cuve)'))),
      h('a', { class: 'gros neutre', href: '#/historique' }, h('span', { class: 'ico' }, '📋'), h('span', {}, estBureau() ? 'Historique' : 'Mes saisies', h('br'), h('small', {}, `${nbAuj} aujourd'hui`)))),
    S.attente ? h('div', { class: 'carte attente' }, h('b', {}, `⏳ ${S.attente} saisie(s) en attente d'envoi`), h('p', {}, 'Elles sont en sécurité sur ce téléphone. Elles partiront automatiquement dès que le réseau revient (gardez l\'application ouverte quelques secondes).')) : null,
  ]);
}

// ───────────────────────── Formulaires communs ─────────────────────────
function nouveauFormulaire(type, op) {
  if (op) {
    return {
      type, nouveau: false, id: op.id, avant: op,
      fermeId: op.fermeId, parcelleIds: (op.parcelles || []).map(p => p.id),
      dateStr: dateLocale(op.date), mode: op.mode || ((op.produits || []).length ? 'fertigation' : 'eau'),
      dureeAvant: op.dureeAvant ?? 0, dureeInjection: op.dureeInjection ?? 0, dureeApres: op.dureeApres ?? 0,
      cibleId: op.cibleId || '', volumeMode: op.repartition === 'prorata' ? 'prorata' : 'parcelle',
      volumes: Object.fromEntries((op.parcelles || []).map(p => [p.id, p.volumeL ?? ''])), volumeTotal: op.volumeTotalL ?? '',
      produits: (op.produits || []).map(p => ({ id: p.id, quantite: String(p.quantite).replace('.', ','), unite: p.unite, _snap: p })),
      observation: op.observation || '', photo: null, photoModifiee: false, gps: !!op.gps, motif: '',
    };
  }
  const fermesA = actifs(S.fermes);
  return {
    type, nouveau: true, id: B.nouvelId(), fermeId: fermesA.length === 1 ? fermesA[0].id : '', parcelleIds: [],
    dateStr: dateLocale(new Date()), mode: 'fertigation', dureeAvant: 10, dureeInjection: 30, dureeApres: 10,
    cibleId: '', volumeMode: 'parcelle', volumes: {}, volumeTotal: '', produits: [], observation: '',
    photo: null, photoModifiee: false, gps: true,
  };
}

function trouverOp(id) { return S.mesOps.find(o => o.id === id) || S.opsBureau.find(o => o.id === id); }

function peutCorriger(op) {
  if (!op) return false;
  if (estBureau()) return !op.annule;
  if (op.annule || op.auteurUid !== S.user.uid) return false;
  const depart = op.creeServeur || op.saisiLe;
  return !depart || (Date.now() - depart.getTime()) < DELAI_CORRECTION_H * 3600000;
}

async function preparerEdition(type, id) {
  let op = trouverOp(id);
  if (!op) try { op = await B.lireOp(id); } catch {}
  if (!op) { toast('Saisie introuvable.', 'erreur'); aller('historique'); return null; }
  if (!peutCorriger(op)) { toast(`Correction impossible : le délai de ${DELAI_CORRECTION_H} h est dépassé. Demandez au bureau.`, 'erreur'); aller('op/' + id); return null; }
  return op;
}

function blocFerme(rerender) {
  const fermesA = actifs(S.fermes);
  return h('section', { class: 'bloc' }, h('h3', {}, '1. Ferme'),
    h('div', { class: 'boutons-choix' }, fermesA.map(f => h('button', {
      class: 'choix-btn' + (F.fermeId === f.id ? ' choisi' : ''),
      onclick: () => { if (F.fermeId !== f.id) { F.fermeId = f.id; F.parcelleIds = []; } rerender(); },
    }, f.nom))));
}

function blocParcelles(multi, rerender) {
  const ps = actifs(S.parcelles).filter(p => p.fermeId === F.fermeId);
  return h('section', { class: 'bloc' }, h('h3', {}, multi ? '2. Parcelles traitées (cochez-les)' : '2. Parcelle'),
    !F.fermeId ? h('p', { class: 'aide' }, 'Choisissez d\'abord la ferme.') :
      !ps.length ? h('p', { class: 'aide' }, 'Aucune parcelle dans cette ferme.') :
        h('div', { class: 'boutons-choix' }, ps.map(p => {
          const choisi = F.parcelleIds.includes(p.id);
          return h('button', {
            class: 'choix-btn' + (choisi ? ' choisi' : ''),
            onclick: () => {
              if (multi) F.parcelleIds = choisi ? F.parcelleIds.filter(x => x !== p.id) : [...F.parcelleIds, p.id];
              else F.parcelleIds = [p.id];
              rerender();
            },
          }, multi ? (choisi ? '☑ ' : '☐ ') : '', p.nom, h('small', {}, `${p.nbPlants?.toLocaleString('fr-FR') ?? '?'} plants`));
        })));
}

function blocDate(n) {
  return h('section', { class: 'bloc' }, h('h3', {}, `${n}. Date et heure`),
    h('input', { class: 'champ', type: 'datetime-local', value: F.dateStr, oninput: e => { F.dateStr = e.target.value; } }),
    h('small', { class: 'aide' }, 'Remplies automatiquement. Modifiez seulement si l\'opération a été faite à un autre moment.'));
}

function stepper(valeur, onChange, pas = 5) {
  const input = h('input', { class: 'champ nombre', inputmode: 'numeric', value: valeur, onfocus: e => e.target.select(),
    oninput: e => onChange(e.target.value) });
  const ajuster = d => { const v = Math.max(0, (num(input.value) || 0) + d); input.value = v; onChange(String(v)); };
  return h('div', { class: 'stepper' }, h('button', { class: 'btn-pas', onclick: () => ajuster(-pas) }, '−' + pas), input, h('button', { class: 'btn-pas', onclick: () => ajuster(pas) }, '+' + pas));
}

function libelleProduit(id) { const p = S.produits.find(x => x.id === id); return p ? p.nom : null; }

function choisirProduit() {
  const recents = [];
  for (const o of S.mesOps) for (const p of o.produits || []) if (!recents.includes(p.id)) recents.push(p.id);
  const dispo = actifs(S.produits);
  const elements = [
    ...recents.slice(0, 6).map(id => dispo.find(p => p.id === id)).filter(Boolean).map(p => ({ id: p.id, label: p.nom, sous: `${p.categorie || ''} · ${p.uniteBase}`, groupe: '⭐ Utilisés récemment' })),
    ...dispo.slice().sort((a, b) => (a.categorie || '').localeCompare(b.categorie || '', 'fr') || a.nom.localeCompare(b.nom, 'fr'))
      .map(p => ({ id: p.id, label: p.nom, sous: p.uniteBase, groupe: p.categorie || 'Sans catégorie' })),
  ];
  if (!dispo.length) { toast('La liste des produits est vide : le bureau doit les ajouter.', 'erreur'); return Promise.resolve(null); }
  return choisir('Choisir un produit', elements);
}

function blocProduits(n, rerender, majCalc) {
  const type = F.type;
  const lignes = F.produits.map((lp, i) => {
    const prod = S.produits.find(p => p.id === lp.id) || lp._snap;
    const unites = prod ? K.unitesCompatibles(prod.uniteBase, type) : [];
    return h('div', { class: 'ligne-produit' },
      h('div', { class: 'ligne-produit-tete' },
        h('span', { class: 'numero' }, i + 1),
        h('button', { class: 'choix-btn large' + (prod ? ' choisi' : ''), onclick: async () => {
          const id = await choisirProduit(); if (!id) return;
          const p = S.produits.find(x => x.id === id);
          lp.id = id; lp._snap = null;
          if (!K.unitesCompatibles(p.uniteBase, type).includes(lp.unite)) lp.unite = p.uniteBase;
          rerender();
        } }, prod ? prod.nom : 'Choisir le produit…'),
        h('button', { class: 'btn-icone rouge', 'aria-label': 'Retirer', onclick: () => { F.produits.splice(i, 1); rerender(); } }, '✕')),
      prod ? h('div', { class: 'ligne-produit-saisie' },
        h('label', { class: 'bloc-qte' }, h('span', { class: 'etiquette' }, type === 'traitement' ? 'Dose pour 1 000 L' : 'Quantité'),
          h('input', { class: 'champ nombre', inputmode: 'decimal', value: lp.quantite ?? '', placeholder: '0', oninput: e => { lp.quantite = e.target.value; majCalc(); } })),
        h('div', { class: 'unites' }, unites.map(u => h('button', { class: 'unite' + (lp.unite === u ? ' choisi' : ''), onclick: () => { lp.unite = u; rerender(); } }, u)))) : null,
      h('div', { class: 'calc', 'data-calc': i }));
  });
  return h('section', { class: 'bloc' }, h('h3', {}, `${n}. Produits ${type === 'traitement' ? 'mélangés dans la cuve (1 à 5)' : 'injectés (1 à 5)'}`),
    lignes,
    F.produits.length < 5 ? h('button', { class: 'btn ajout', onclick: async () => {
      const id = await choisirProduit(); if (!id) return;
      const p = S.produits.find(x => x.id === id);
      F.produits.push({ id, quantite: '', unite: p.uniteBase });
      rerender();
      setTimeout(() => { const l = document.querySelectorAll('.ligne-produit input'); l[l.length - 1]?.focus(); }, 50);
    } }, '+ Ajouter un produit') : h('p', { class: 'aide' }, '5 produits au maximum.'));
}

function blocFin(n, enregistrer) {
  const photoEl = h('div', { class: 'photo-apercu' });
  const montrerPhoto = src => { photoEl.innerHTML = ''; if (src) photoEl.append(h('img', { src, alt: 'photo' })); };
  if (F.photo) montrerPhoto(F.photo);
  else if (!F.nouveau && F.avant?.aPhoto) B.lirePhoto(F.id).then(s => { if (s && !F.photoModifiee) montrerPhoto(s); });
  const inputPhoto = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try { F.photo = await compresserPhoto(f); F.photoModifiee = true; montrerPhoto(F.photo); } catch { toast('Photo illisible.', 'erreur'); }
  } });
  return [
    h('section', { class: 'bloc' }, h('h3', {}, `${n}. Compléments (facultatif)`),
      h('div', { class: 'ligne-boutons' },
        h('button', { class: 'btn', onclick: () => inputPhoto.click() }, '📷 Photo'),
        F.nouveau ? h('label', { class: 'case' }, h('input', { type: 'checkbox', checked: F.gps, onchange: e => F.gps = e.target.checked }), ' 📍 Position GPS') : null),
      inputPhoto, photoEl,
      h('textarea', { class: 'champ', rows: 2, placeholder: 'Observation (facultatif)', oninput: e => F.observation = e.target.value }, F.observation),
      !F.nouveau ? h('input', { class: 'champ', placeholder: 'Motif de la correction (facultatif)', oninput: e => F.motif = e.target.value }) : null),
    h('div', { id: 'erreurs-form', class: 'erreurs' }),
    h('button', { class: 'btn principal tres-grand', onclick: enregistrer }, F.nouveau ? '✓ Enregistrer' : '✓ Enregistrer la correction'),
  ];
}

function compresserPhoto(fichier) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      let taille = 1024, q = 0.6, data;
      for (let essai = 0; essai < 3; essai++) {
        const r = Math.min(1, taille / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        data = c.toDataURL('image/jpeg', q);
        if (data.length < 300000) break;
        taille *= 0.75; q -= 0.1;
      }
      URL.revokeObjectURL(img.src); res(data);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(fichier);
  });
}

function position() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6, precision: Math.round(p.coords.accuracy) }),
      () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 });
  });
}

function snapParcelle(id) {
  const p = parcelle(id) || (F.avant?.parcelles || []).find(x => x.id === id) || { id, nom: '?' };
  return { id: p.id, nom: p.nom, fermeId: p.fermeId || F.fermeId, nbPlants: Number(p.nbPlants) || 0, superficieHa: Number(p.superficieHa) || 0, debitM3h: Number(p.debitM3h) || 0 };
}
function snapProduits() {
  return F.produits.map(lp => {
    const p = S.produits.find(x => x.id === lp.id) || lp._snap || {};
    return { id: lp.id, nom: p.nom, categorie: p.categorie || '', uniteBase: p.uniteBase, quantite: num(lp.quantite), unite: lp.unite };
  });
}

async function finaliser(op) {
  const erreurs = K.valider(op);
  const zone = $('#erreurs-form');
  if (erreurs.length) {
    zone.innerHTML = ''; zone.append(h('b', {}, 'À corriger :'), ...erreurs.map(e => h('div', {}, '⚠ ' + e)));
    zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const bouton = document.querySelector('.tres-grand'); if (bouton) { bouton.disabled = true; bouton.textContent = 'Enregistrement…'; }
  op.observation = (F.observation || '').trim();
  op.aPhoto = F.photo ? true : !!(F.avant && F.avant.aPhoto);
  if (F.nouveau) {
    op.auteurUid = S.user.uid; op.auteurNom = S.profil.nom; op.saisiLe = new Date();
    op.gps = F.gps ? await position() : null;
  } else {
    op.gps = F.avant.gps || null; op._motif = F.motif || '';
  }
  B.enregistrerOp(op, { nouveau: F.nouveau, avant: F.avant, utilisateur: { uid: S.user.uid, nom: S.profil.nom } });
  if (F.photo && F.photoModifiee) B.enregistrerPhoto(op.id, F.photo, F.nouveau ? S.user.uid : F.avant.auteurUid);
  const nouveau = F.nouveau; F = null;
  if (nouveau) { S._derniere = { id: op.id, le: Date.now() }; aller('accueil'); }
  else { toast('Correction enregistrée ✓'); aller('op/' + op.id); }
}

// ───────────────────────── Irrigation / fertigation ─────────────────────────
async function ecranIrrigation(id) {
  if (!F || F.type !== 'irrigation' || (id && F.id !== id) || (!id && !F.nouveau)) {
    let op = null;
    if (id) { op = await preparerEdition('irrigation', id); if (!op) return; }
    F = nouveauFormulaire('irrigation', op);
  }
  const rerender = () => { const y = window.scrollY; ecranIrrigation(id); window.scrollTo(0, y); };
  const total = () => F.mode === 'eau' ? (num(F.dureeAvant) || 0) : (num(F.dureeAvant) || 0) + (num(F.dureeInjection) || 0) + (num(F.dureeApres) || 0);
  const majCalc = () => {
    const t = $('#total-duree'); if (t) t.textContent = `${total()} min (${fmt(total() / 60, 2)} h)`;
    const p = F.parcelleIds[0] && snapParcelle(F.parcelleIds[0]);
    F.produits.forEach((lp, i) => {
      const el = document.querySelector(`[data-calc="${i}"]`); if (!el) return;
      const prod = S.produits.find(x => x.id === lp.id) || lp._snap; const q = num(lp.quantite);
      if (!prod || !(q > 0) || !p) { el.textContent = ''; return; }
      const b = K.versBase(q, lp.unite, prod.uniteBase, p.nbPlants);
      el.textContent = b == null ? '' : `= ${fmt(b, 3)} ${prod.uniteBase} au total` + (lp.unite === 'g/plant' ? ` (${q} g × ${p.nbPlants.toLocaleString('fr-FR')} plants)` : '');
    });
  };
  const enregistrer = () => {
    const pid = F.parcelleIds[0];
    const f = ferme(F.fermeId);
    const op = {
      id: F.id, type: 'irrigation', date: new Date(F.dateStr), fermeId: F.fermeId, fermeNom: f?.nom || '',
      parcelles: pid ? [snapParcelle(pid)] : [], parcelleIds: pid ? [pid] : [], mode: F.mode,
      dureeAvant: num(F.dureeAvant), dureeInjection: F.mode === 'eau' ? 0 : num(F.dureeInjection), dureeApres: F.mode === 'eau' ? 0 : num(F.dureeApres),
      produits: F.mode === 'eau' ? [] : snapProduits(),
    };
    op.dureeTotale = K.dureeTotale(op);
    finaliser(op);
  };
  cadre(F.nouveau ? 'Nouvelle irrigation' : 'Corriger l\'irrigation', [
    blocFerme(rerender), blocParcelles(false, rerender), blocDate(3),
    h('section', { class: 'bloc' }, h('h3', {}, '4. Type d\'irrigation'),
      h('div', { class: 'boutons-choix deux' },
        h('button', { class: 'choix-btn' + (F.mode === 'eau' ? ' choisi' : ''), onclick: () => { F.mode = 'eau'; rerender(); } }, '💧 Eau claire', h('small', {}, 'sans produit')),
        h('button', { class: 'choix-btn' + (F.mode === 'fertigation' ? ' choisi' : ''), onclick: () => { F.mode = 'fertigation'; if (!(num(F.dureeInjection) > 0)) F.dureeInjection = 30; rerender(); } }, '🧪 Fertigation', h('small', {}, 'avec engrais')))),
    h('section', { class: 'bloc' }, h('h3', {}, '5. Durées (minutes)'),
      F.mode === 'eau'
        ? h('label', { class: 'bloc' }, h('span', { class: 'etiquette' }, 'Durée d\'irrigation'), stepper(F.dureeAvant, v => { F.dureeAvant = v; majCalc(); }, 15))
        : [h('label', { class: 'bloc' }, h('span', { class: 'etiquette' }, 'Eau claire avant'), stepper(F.dureeAvant, v => { F.dureeAvant = v; majCalc(); })),
          h('label', { class: 'bloc' }, h('span', { class: 'etiquette' }, 'Injection'), stepper(F.dureeInjection, v => { F.dureeInjection = v; majCalc(); })),
          h('label', { class: 'bloc' }, h('span', { class: 'etiquette' }, 'Eau claire après'), stepper(F.dureeApres, v => { F.dureeApres = v; majCalc(); }))],
      h('div', { class: 'total' }, 'Durée totale : ', h('b', { id: 'total-duree' }))),
    F.mode === 'fertigation' ? blocProduits(6, rerender, majCalc) : null,
    blocFin(F.mode === 'fertigation' ? 7 : 6, enregistrer),
  ], { retour: 'accueil' });
  majCalc();
}

// ───────────────────────── Traitement foliaire ─────────────────────────
async function ecranTraitement(id) {
  if (!F || F.type !== 'traitement' || (id && F.id !== id) || (!id && !F.nouveau)) {
    let op = null;
    if (id) { op = await preparerEdition('traitement', id); if (!op) return; }
    F = nouveauFormulaire('traitement', op);
  }
  const rerender = () => { const y = window.scrollY; ecranTraitement(id); window.scrollTo(0, y); };
  const parcellesSel = () => F.parcelleIds.map(snapParcelle);
  const volumesActuels = () => {
    const ps = parcellesSel();
    if (ps.length > 1 && F.volumeMode === 'prorata') {
      const t = num(F.volumeTotal);
      return t > 0 ? K.repartirProrata(t, ps) : ps.map(() => NaN);
    }
    return ps.map(p => num(F.volumes[p.id]));
  };
  const majCalc = () => {
    const ps = parcellesSel(); const vols = volumesActuels();
    if (ps.length > 1 && F.volumeMode === 'prorata') ps.forEach((p, i) => { const el = document.querySelector(`[data-part="${p.id}"]`); if (el) el.textContent = isFinite(vols[i]) ? `${fmt(vols[i], 1)} L` : '—'; });
    const tot = $('#vol-total'); if (tot) tot.textContent = fmt(vols.reduce((s, v) => s + (isFinite(v) ? v : 0), 0), 1) + ' L';
    const zone = $('#recap'); if (!zone) return;
    zone.innerHTML = '';
    const prods = snapProduits().filter(p => p.uniteBase && p.quantite > 0);
    if (!prods.length || !ps.length) return;
    const op = { type: 'traitement', parcelles: ps.map((p, i) => ({ ...p, volumeL: vols[i] })), produits: prods };
    const lignes = K.consommations(op);
    zone.append(h('h4', {}, 'Quantités consommées (calcul automatique)'),
      h('table', { class: 'tableau' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Produit'), ps.map(p => h('th', {}, p.nom)), ps.length > 1 ? h('th', {}, 'Total') : null)),
        h('tbody', {}, prods.map(pr => {
          const vals = ps.map(p => lignes.find(l => l.produitId === pr.id && l.parcelleId === p.id)?.quantite);
          const t = vals.reduce((s, v) => s + (isFinite(v) ? v : 0), 0);
          return h('tr', {}, h('td', {}, pr.nom, h('br'), h('small', {}, `${String(pr.quantite).replace('.', ',')} ${pr.unite}/1 000 L`)),
            vals.map(v => h('td', { class: 'n' }, isFinite(v) ? `${fmt(v, 3)} ${pr.uniteBase}` : '—')),
            ps.length > 1 ? h('td', { class: 'n' }, h('b', {}, `${fmt(t, 3)} ${pr.uniteBase}`)) : null);
        }))),
      h('small', { class: 'aide' }, 'Calcul : dose × volume pulvérisé ÷ 1 000.'));
  };
  const enregistrer = () => {
    const ps = parcellesSel(); const vols = volumesActuels();
    const cible = S.cibles.find(c => c.id === F.cibleId);
    const op = {
      id: F.id, type: 'traitement', date: new Date(F.dateStr), fermeId: F.fermeId, fermeNom: ferme(F.fermeId)?.nom || '',
      parcelles: ps.map((p, i) => ({ ...p, volumeL: vols[i] })), parcelleIds: ps.map(p => p.id),
      cibleId: F.cibleId, cibleNom: cible?.nom || F.avant?.cibleNom || '',
      volumeTotalL: Math.round(vols.reduce((s, v) => s + (isFinite(v) ? v : 0), 0) * 10) / 10,
      repartition: ps.length > 1 && F.volumeMode === 'prorata' ? 'prorata' : 'saisie',
      produits: snapProduits(),
    };
    finaliser(op);
  };
  const ps = parcellesSel();
  const cible = S.cibles.find(c => c.id === F.cibleId);
  cadre(F.nouveau ? 'Nouveau traitement' : 'Corriger le traitement', [
    blocFerme(rerender), blocParcelles(true, rerender), blocDate(3),
    h('section', { class: 'bloc' }, h('h3', {}, '4. Cible / objectif'),
      h('button', { class: 'choix-btn large' + (F.cibleId ? ' choisi' : ''), onclick: async () => {
        const id = await choisir('Cible / objectif', actifs(S.cibles).map(c => ({ id: c.id, label: c.nom })));
        if (id) { F.cibleId = id; rerender(); }
      } }, cible ? cible.nom : (F.avant?.cibleNom || 'Choisir la cible…'))),
    h('section', { class: 'bloc' }, h('h3', {}, '5. Volume de bouillie pulvérisé (litres)'),
      !ps.length ? h('p', { class: 'aide' }, 'Cochez d\'abord les parcelles.') : [
        ps.length > 1 ? h('div', { class: 'boutons-choix deux' },
          h('button', { class: 'choix-btn' + (F.volumeMode === 'parcelle' ? ' choisi' : ''), onclick: () => { F.volumeMode = 'parcelle'; rerender(); } }, 'Volume par parcelle'),
          h('button', { class: 'choix-btn' + (F.volumeMode === 'prorata' ? ' choisi' : ''), onclick: () => { F.volumeMode = 'prorata'; rerender(); } }, 'Volume total', h('small', {}, 'réparti au prorata des plants'))) : null,
        ps.length > 1 && F.volumeMode === 'prorata'
          ? [h('label', { class: 'bloc' }, h('span', { class: 'etiquette' }, 'Volume total pulvérisé (L)'),
            h('input', { class: 'champ nombre', inputmode: 'decimal', value: F.volumeTotal, oninput: e => { F.volumeTotal = e.target.value; majCalc(); } })),
            h('div', { class: 'carte attention' }, '⚠ Répartition automatique au prorata du nombre de plants (signalée dans la saisie) :',
              h('ul', {}, ps.map(p => h('li', {}, `${p.nom} (${p.nbPlants.toLocaleString('fr-FR')} plants) : `, h('b', { 'data-part': p.id })))))]
          : ps.map(p => h('label', { class: 'bloc' }, h('span', { class: 'etiquette' }, ps.length > 1 ? p.nom : 'Volume pulvérisé (L)'),
            h('div', { class: 'ligne-vol' },
              h('input', { class: 'champ nombre', inputmode: 'decimal', value: F.volumes[p.id] ?? '', 'data-vol': p.id, oninput: e => { F.volumes[p.id] = e.target.value; majCalc(); } }),
              [1000, 2000, 3000].map(v => h('button', { class: 'unite', onclick: () => { F.volumes[p.id] = String(v); document.querySelector(`[data-vol="${p.id}"]`).value = v; majCalc(); } }, v.toLocaleString('fr-FR')))))),
        h('div', { class: 'total' }, 'Volume total : ', h('b', { id: 'vol-total' }))]),
    blocProduits(6, rerender, majCalc),
    h('div', { id: 'recap', class: 'recap' }),
    blocFin(7, enregistrer),
  ], { retour: 'accueil' });
  majCalc();
}

// ───────────────────────── Historique et détail ─────────────────────────
function resumeOp(op) {
  if (op.type === 'irrigation') {
    return op.mode === 'eau' || !(op.produits || []).length ? `Eau claire · ${op.dureeTotale} min`
      : `Fertigation · ${op.dureeAvant} + ${op.dureeInjection} + ${op.dureeApres} = ${op.dureeTotale} min`;
  }
  return `${op.cibleNom || 'Traitement'} · ${fmt(op.volumeTotalL, 0)} L de bouillie` + (op.repartition === 'prorata' ? ' (réparti au prorata)' : '');
}

function carteOp(op) {
  const lignes = K.consommations(op);
  return h('a', { class: 'carte-op ' + op.type + (op.annule ? ' annule' : ''), href: '#/op/' + op.id },
    h('div', { class: 'carte-op-tete' },
      h('span', { class: 'ico' }, op.type === 'irrigation' ? '💧' : '🌿'),
      h('div', {}, h('b', {}, (op.parcelles || []).map(p => `${codeFerme(p.fermeId || op.fermeId)} · ${p.nom}`).join(' + ')),
        h('div', { class: 'petit' }, fmtDate(op.date), ' · ', op.auteurNom || '')),
      h('div', { class: 'badges' },
        op._attente ? h('span', { class: 'badge attente' }, '⏳ à envoyer') : null,
        op.nbModifs ? h('span', { class: 'badge' }, 'corrigée') : null,
        op.annule ? h('span', { class: 'badge rouge' }, 'annulée') : null,
        op.aPhoto ? h('span', { class: 'badge' }, '📷') : null)),
    h('div', { class: 'petit' }, resumeOp(op)),
    (op.produits || []).length ? h('ul', { class: 'melange' }, op.produits.map(p => {
      const tot = lignes.filter(l => l.produitId === p.id).reduce((s, l) => s + (l.quantite || 0), 0);
      return h('li', {}, h('b', {}, p.nom), ` — ${String(p.quantite).replace('.', ',')} ${p.unite}${op.type === 'traitement' ? '/1 000 L' : ''}`, h('span', { class: 'conso' }, ` → ${fmt(tot, 3)} ${p.uniteBase}`));
    })) : null);
}

function ecranHistorique() {
  let liste, entete = null;
  if (estBureau()) {
    const ong = S.ongletHisto;
    entete = [h('div', { class: 'onglets-int' },
      h('button', { class: ong === 'miennes' ? 'actif' : '', onclick: () => { S.ongletHisto = 'miennes'; afficher(); } }, 'Mes saisies'),
      h('button', { class: ong === 'toutes' ? 'actif' : '', onclick: () => { S.ongletHisto = 'toutes'; afficher(); } }, 'Toutes les saisies')),
    ong === 'toutes' ? filtresBureau() : null];
    liste = ong === 'toutes' ? opsFiltrees() : S.mesOps;
  } else liste = S.mesOps;
  const groupes = {};
  for (const op of liste) (groupes[fmtJour(op.date)] ||= []).push(op);
  cadre(estBureau() ? 'Historique' : 'Mes saisies', [
    entete,
    !liste.length ? h('p', { class: 'vide' }, 'Aucune saisie.') : null,
    Object.entries(groupes).map(([j, ops]) => [h('h3', { class: 'jour' }, j), ops.map(carteOp)]),
    !estBureau() ? h('p', { class: 'aide' }, `Vous pouvez corriger une saisie pendant ${DELAI_CORRECTION_H} h. Ensuite, seul le bureau peut la modifier.`) : null,
  ]);
}

async function ecranOperation(id) {
  let op = trouverOp(id);
  if (!op) { try { op = await B.lireOp(id); } catch {} }
  if (!op) return cadre('Saisie', h('p', { class: 'vide' }, 'Saisie introuvable (ou pas encore reçue).'), { retour: 'historique' });
  const lignes = K.consommations(op);
  const photoEl = h('div', { class: 'photo-apercu' });
  const histoEl = h('div', {});
  const peut = peutCorriger(op);
  cadre(op.type === 'irrigation' ? 'Irrigation' : 'Traitement', [
    carteOp(op),
    h('section', { class: 'bloc' },
      h('dl', { class: 'details' },
        h('dt', {}, 'Date de l\'opération'), h('dd', {}, fmtDate(op.date)),
        h('dt', {}, 'Ferme'), h('dd', {}, op.fermeNom || codeFerme(op.fermeId)),
        op.type === 'irrigation' ? [h('dt', {}, 'Durées'), h('dd', {}, resumeOp(op))] :
          [h('dt', {}, 'Cible'), h('dd', {}, op.cibleNom || '—'),
            h('dt', {}, 'Volume pulvérisé'), h('dd', {}, (op.parcelles || []).map(p => `${p.nom} : ${fmt(p.volumeL, 1)} L`).join(' · '), op.repartition === 'prorata' ? h('div', { class: 'petit attention-txt' }, '⚠ réparti automatiquement au prorata des plants') : null)],
        h('dt', {}, 'Saisi par'), h('dd', {}, `${op.auteurNom || '?'} le ${fmtDate(op.saisiLe)}`),
        op.creeServeur ? [h('dt', {}, 'Reçu au bureau'), h('dd', {}, op._attente ? 'pas encore' : fmtDate(op.creeServeur))] : null,
        op.modifieLe ? [h('dt', {}, 'Dernière correction'), h('dd', {}, `${op.modifiePar || ''} le ${fmtDate(op.modifieLe)}`)] : null,
        op.gps ? [h('dt', {}, 'Position GPS'), h('dd', {}, h('a', { href: `https://maps.google.com/?q=${op.gps.lat},${op.gps.lng}`, target: '_blank', rel: 'noopener' }, `${op.gps.lat}, ${op.gps.lng}`), ` (± ${op.gps.precision} m)`)] : null,
        op.observation ? [h('dt', {}, 'Observation'), h('dd', {}, op.observation)] : null)),
    (op.produits || []).length ? h('section', { class: 'bloc' }, h('h3', {}, 'Quantités consommées'),
      h('table', { class: 'tableau' }, h('thead', {}, h('tr', {}, h('th', {}, 'Produit'), h('th', {}, op.type === 'traitement' ? 'Dose /1 000 L' : 'Saisie'), (op.parcelles || []).map(p => h('th', {}, p.nom)))),
        h('tbody', {}, op.produits.map(pr => h('tr', {}, h('td', {}, pr.nom), h('td', {}, `${String(pr.quantite).replace('.', ',')} ${pr.unite}`),
          (op.parcelles || []).map(p => { const l = lignes.find(x => x.produitId === pr.id && x.parcelleId === p.id); return h('td', { class: 'n' }, l && l.quantite != null ? `${fmt(l.quantite, 3)} ${pr.uniteBase}` : '—'); })))))) : null,
    op.aPhoto ? h('section', { class: 'bloc' }, h('h3', {}, 'Photo'), photoEl) : null,
    h('div', { class: 'ligne-boutons' },
      peut ? h('a', { class: 'btn principal', href: `#/${op.type}/${op.id}` }, '✏️ Corriger') : h('p', { class: 'aide' }, op.annule ? 'Saisie annulée.' : `Délai de correction de ${DELAI_CORRECTION_H} h dépassé : seul le bureau peut la modifier.`),
      estBureau() && !op.annule ? h('button', { class: 'btn rouge', onclick: async () => {
        const r = await formulaire('Annuler cette saisie', [{ cle: 'motif', label: 'Motif de l\'annulation', requis: true }]);
        if (!r) return;
        B.enregistrerOp({ ...op, annule: true, _motif: 'Annulation : ' + r.motif }, { nouveau: false, avant: op, utilisateur: { uid: S.user.uid, nom: S.profil.nom } });
        toast('Saisie annulée.'); setTimeout(afficher, 300);
      } }, 'Annuler la saisie') : null),
    h('section', { class: 'bloc' }, h('h3', {}, 'Historique des modifications'), histoEl),
  ], { retour: 'historique' });
  if (op.aPhoto) B.lirePhoto(op.id).then(s => { photoEl.append(s ? h('img', { src: s, alt: 'photo' }) : h('p', { class: 'aide' }, 'Photo pas encore disponible (en attente d\'envoi ou hors connexion).')); });
  if (op.nbModifs) {
    B.lireHistorique(op.id).then(hs => {
      histoEl.append(...hs.map(x => h('div', { class: 'histo' }, h('b', {}, `${fmtDate(x.le)} — ${x.parNom}`), x.motif ? h('div', {}, 'Motif : ' + x.motif) : null,
        h('div', { class: 'petit' }, 'Avant : ', resumeOp(x.avant), ' — ', (x.avant.parcelles || []).map(p => p.nom).join(', '), ' — ',
          (x.avant.produits || []).map(p => `${p.nom} ${String(p.quantite).replace('.', ',')} ${p.unite}`).join(' ; ') || 'aucun produit'))));
      if (!hs.length) histoEl.append(h('p', { class: 'aide' }, 'Non disponible hors connexion.'));
    }).catch(() => histoEl.append(h('p', { class: 'aide' }, 'Non disponible hors connexion.')));
  } else histoEl.append(h('p', { class: 'aide' }, 'Aucune modification.'));
}

// ───────────────────────── Tableau de bord (bureau) ─────────────────────────
function opsFiltrees() {
  const f = S.filtre; const du = new Date(f.du + 'T00:00'); const au = new Date(f.au + 'T23:59:59');
  if (du < S.depuisBureau) { surveillerBureau(du); }
  return S.opsBureau.filter(o => o.date >= du && o.date <= au && (!f.fermeId || o.fermeId === f.fermeId)
    && (!f.parcelleId || (o.parcelleIds || []).includes(f.parcelleId)));
}

function filtresBureau() {
  const f = S.filtre;
  const maj = () => afficher();
  const raccourci = (l, du, au) => h('button', { class: 'unite', onclick: () => { f.du = jourIso(du); f.au = jourIso(au); maj(); } }, l);
  const d = new Date();
  return h('div', { class: 'filtres' },
    h('label', {}, 'Du ', h('input', { type: 'date', class: 'champ', value: f.du, onchange: e => { f.du = e.target.value; maj(); } })),
    h('label', {}, 'au ', h('input', { type: 'date', class: 'champ', value: f.au, onchange: e => { f.au = e.target.value; maj(); } })),
    h('select', { class: 'champ', onchange: e => { f.fermeId = e.target.value; f.parcelleId = ''; maj(); } },
      h('option', { value: '' }, 'Toutes les fermes'), S.fermes.map(x => h('option', { value: x.id, selected: f.fermeId === x.id }, x.nom))),
    h('select', { class: 'champ', onchange: e => { f.parcelleId = e.target.value; maj(); } },
      h('option', { value: '' }, 'Toutes les parcelles'), S.parcelles.filter(p => !f.fermeId || p.fermeId === f.fermeId).map(p => h('option', { value: p.id, selected: f.parcelleId === p.id }, libParcelle(p)))),
    h('div', { class: 'raccourcis' },
      raccourci('Ce mois', new Date(d.getFullYear(), d.getMonth(), 1), d),
      raccourci('Mois dernier', new Date(d.getFullYear(), d.getMonth() - 1, 1), new Date(d.getFullYear(), d.getMonth(), 0)),
      raccourci('Cette année', new Date(d.getFullYear(), 0, 1), d),
      raccourci('12 mois', new Date(d.getFullYear() - 1, d.getMonth(), d.getDate() + 1), d)));
}

function ecranTableau() {
  const f = S.filtre;
  const ops = opsFiltrees();
  const ag = K.agreger(ops, f, S.parcelles);
  const k = ag.kpi;
  const tuile = (v, l, ico) => h('div', { class: 'tuile' }, h('div', { class: 'tuile-v' }, v), h('div', { class: 'tuile-l' }, ico + ' ' + l));
  const vue = S.vueProduits;
  const parcellesCols = ag.perimetre;
  const valeurVue = (q, pr, p) => {
    if (q == null) return '';
    if (vue === 'plant') { const v = K.parPlant(q, pr.uniteBase, p.nbPlants); return v == null ? '—' : fmt(v, 3); }
    if (vue === 'ha') return p.superficieHa ? fmt(q / p.superficieHa, 2) : '—';
    return fmt(q, 2);
  };
  const uniteVue = pr => vue === 'plant' ? `${K.unitePlant(pr.uniteBase)}/plant` : vue === 'ha' ? `${pr.uniteBase}/ha` : pr.uniteBase;
  cadre('Tableau de bord', [
    filtresBureau(),
    h('div', { class: 'ligne-boutons' },
      h('button', { class: 'btn principal', onclick: () => exporterExcel(ops, ag) }, '⬇ Export Excel'),
      h('button', { class: 'btn', onclick: async () => {
        let pid = f.parcelleId;
        if (!pid) pid = await choisir('Fiche de traçabilité : quelle parcelle ?', S.parcelles.filter(p => !f.fermeId || p.fermeId === f.fermeId).map(p => ({ id: p.id, label: libParcelle(p) })), false);
        if (pid) aller('fiche/' + pid);
      } }, '📄 Fiche de traçabilité (PDF)'),
      'Notification' in window && Notification.permission === 'default' ? h('button', { class: 'btn', onclick: () => Notification.requestPermission().then(() => afficher()) }, '🔔 Activer les alertes') : null),
    h('div', { class: 'tuiles' },
      tuile(k.irrigations, 'irrigations', '💧'), tuile(k.fertigations, 'dont fertigations', '🧪'),
      tuile(fmt(k.minutes / 60, 1), 'heures d\'irrigation', '⏱'), tuile(fmt(k.eauM3, 0), 'm³ d\'eau', '🚰'),
      tuile(k.traitements, 'traitements (cuves)', '🌿'), tuile(fmt(k.bouillieL / 1000, 2), 'm³ de bouillie', '🛢')),
    h('section', { class: 'bloc' }, h('h3', {}, 'Par parcelle'),
      h('div', { class: 'defile' }, h('table', { class: 'tableau' },
        h('thead', {}, h('tr', {}, ['Parcelle', 'Plants', 'ha', 'Irrigations', 'dont fertig.', 'Heures', 'Eau (m³)', 'Traitements', 'Bouillie (m³)'].map(t => h('th', {}, t)))),
        h('tbody', {}, ag.perimetre.map(p => {
          const s = ag.parcelles.find(x => x.id === p.id) || {};
          return h('tr', {}, h('td', {}, libParcelle(p)), h('td', { class: 'n' }, fmt(p.nbPlants, 0)), h('td', { class: 'n' }, fmt(p.superficieHa, 2)),
            h('td', { class: 'n' }, s.irrigations || 0), h('td', { class: 'n' }, s.fertigations || 0), h('td', { class: 'n' }, fmt((s.minutes || 0) / 60, 1)),
            h('td', { class: 'n' }, fmt(s.eauM3 || 0, 0)), h('td', { class: 'n' }, s.traitements || 0), h('td', { class: 'n' }, fmt((s.bouillieL || 0) / 1000, 2)));
        }))))),
    h('section', { class: 'bloc' }, h('h3', {}, 'Quantités de produits consommées'),
      !ag.produits.length ? h('p', { class: 'vide' }, 'Aucun produit consommé sur la période.') : [
        h('div', { class: 'defile' }, h('table', { class: 'tableau' },
          h('thead', {}, h('tr', {}, ['Produit', 'Unité', 'Fertigation', 'Foliaire', 'Total', 'Par plant', 'Par ha'].map(t => h('th', {}, t)))),
          h('tbody', {}, ag.produits.map(pr => h('tr', {}, h('td', {}, pr.nom), h('td', {}, pr.uniteBase), h('td', { class: 'n' }, fmt(pr.fertig, 2)),
            h('td', { class: 'n' }, fmt(pr.foliaire, 2)), h('td', { class: 'n' }, h('b', {}, fmt(pr.total, 2))),
            h('td', { class: 'n' }, pr.parPlant == null ? '—' : `${fmt(pr.parPlant, 3)} ${K.unitePlant(pr.uniteBase)}`),
            h('td', { class: 'n' }, pr.parHa == null ? '—' : `${fmt(pr.parHa, 3)} ${pr.uniteBase}`)))))),
        h('small', { class: 'aide' }, `Par plant et par ha : rapportés aux ${fmt(ag.plants, 0)} plants et ${fmt(ag.ha, 2)} ha du périmètre choisi.`),
        h('h4', {}, 'Détail par parcelle'),
        h('div', { class: 'raccourcis' }, [['quantite', 'Quantité'], ['plant', 'Par plant'], ['ha', 'Par ha']].map(([v, l]) =>
          h('button', { class: 'unite' + (vue === v ? ' choisi' : ''), onclick: () => { S.vueProduits = v; afficher(); } }, l))),
        h('div', { class: 'defile' }, h('table', { class: 'tableau' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Produit'), h('th', {}, 'Unité'), parcellesCols.map(p => h('th', {}, libParcelle(p))))),
          h('tbody', {}, ag.produits.map(pr => h('tr', {}, h('td', {}, pr.nom), h('td', {}, uniteVue(pr)),
            parcellesCols.map(p => h('td', { class: 'n' }, valeurVue(pr.parParcelle[p.id], pr, p))))))))]),
    h('section', { class: 'bloc' }, h('h3', {}, `Journal des opérations (${ops.length})`),
      ops.length ? ops.map(carteOp) : h('p', { class: 'vide' }, 'Aucune opération sur la période.')),
  ]);
}

// ───────────────────────── Export Excel ─────────────────────────
function exporterExcel(ops, ag) {
  const f = S.filtre;
  const chrono = ops.filter(o => !o.annule).slice().sort((a, b) => a.date - b.date);
  const dansFiltre = p => (!f.parcelleId || p.id === f.parcelleId) && (!f.fermeId || (p.fermeId || '') === f.fermeId);
  const E = v => ({ v, s: 'entete' });
  const periode = `Période du ${fmtJour(new Date(f.du))} au ${fmtJour(new Date(f.au))}`;

  // Irrigation-Fertigation (même disposition que Suivi_fermes.xlsx)
  const irr = [[{ v: 'Irrigation et fertigation', s: 'titre' }], ['Une ligne = une irrigation sur une parcelle. Jusqu\'à 5 produits injectés sur la même ligne. Durées en minutes. ' + periode], [],
    [E('N°'), E('Date'), E('Parcelle'), E('Eau claire avant'), E('Injection'), E('Eau claire après'), E('Durée totale'), ...[1, 2, 3, 4, 5].flatMap(i => [E('Produit ' + i), E(''), E('')]), E('Observation'), E('Ferme'), E('Nb plants'), E('Opérateur'), E('Saisi le')],
    [E(''), E(''), E(''), E('(min)'), E('(min)'), E('(min)'), E('(min)'), ...[1, 2, 3, 4, 5].flatMap(() => [E('Produit'), E('Qté'), E('Unité')]), E(''), E(''), E(''), E(''), E('')]];
  let n = 0;
  for (const op of chrono.filter(o => o.type === 'irrigation')) {
    const ps = (op.parcelles || []).filter(p => dansFiltre({ ...p, fermeId: p.fermeId || op.fermeId }));
    if (!ps.length) continue; n++;
    for (const p of ps) irr.push([n, op.date, `${codeFerme(op.fermeId)} ${p.nom}`, op.dureeAvant, op.dureeInjection, op.dureeApres, op.dureeTotale,
      ...[0, 1, 2, 3, 4].flatMap(i => { const pr = (op.produits || [])[i]; return pr ? [pr.nom, pr.quantite, pr.unite] : [null, null, null]; }),
      op.observation || '', op.fermeNom || codeFerme(op.fermeId), p.nbPlants, op.auteurNom || '', op.saisiLe || null]);
  }
  // Traitements foliaires
  const trt = [[{ v: 'Traitements foliaires (atomiseur)', s: 'titre' }], ['Une ligne = une cuve pulvérisée sur une parcelle. Jusqu\'à 5 produits du mélange sur la même ligne. Dose pour 1 000 L. ' + periode],
    [E('N°'), E('Date'), E('Parcelle'), E('Volume bouillie (L)'), E('Cible / objectif'), ...[1, 2, 3, 4, 5].flatMap(i => [E('Produit ' + i), E(''), E('')]), E('Observation'), E('Ferme'), E('Nb plants'), E('Opérateur'), E('Répartition du volume'), E('Saisi le')],
    [E(''), E(''), E(''), E(''), E(''), ...[1, 2, 3, 4, 5].flatMap(() => [E('Produit'), E('Dose /1000 L'), E('Unité')]), E(''), E(''), E(''), E(''), E(''), E('')]];
  n = 0;
  for (const op of chrono.filter(o => o.type === 'traitement')) {
    const ps = (op.parcelles || []).filter(p => dansFiltre({ ...p, fermeId: p.fermeId || op.fermeId }));
    if (!ps.length) continue; n++;
    for (const p of ps) trt.push([n, op.date, `${codeFerme(op.fermeId)} ${p.nom}`, p.volumeL, op.cibleNom || '',
      ...[0, 1, 2, 3, 4].flatMap(i => { const pr = (op.produits || [])[i]; return pr ? [pr.nom, pr.quantite, pr.unite] : [null, null, null]; }),
      op.observation || '', op.fermeNom || codeFerme(op.fermeId), p.nbPlants, op.auteurNom || '',
      (op.parcelles.length > 1 ? `Cuve commune à ${op.parcelles.length} parcelles` : '') + (op.repartition === 'prorata' ? ' — volume réparti au prorata des plants' : ''), op.saisiLe || null]);
  }
  // Consommations
  const N = v => ({ v, s: 'nombre' });
  const cons = [[{ v: 'Quantités de produits consommées', s: 'titre' }], [periode + (f.fermeId ? ' — ' + (ferme(f.fermeId)?.nom || '') : '') + (f.parcelleId ? ' — ' + libParcelle(parcelle(f.parcelleId)) : '')], [],
    [E('Produit'), E('Catégorie'), E('Unité'), E('Fertigation'), E('Traitements foliaires'), E('Total consommé'), E('Par plant (g ou ml)'), E('Par ha'), ...ag.perimetre.map(p => E(libParcelle(p)))]];
  for (const pr of ag.produits) cons.push([pr.nom, pr.categorie || '', pr.uniteBase, N(pr.fertig), N(pr.foliaire), N(pr.total), N(pr.parPlant), N(pr.parHa), ...ag.perimetre.map(p => N(pr.parParcelle[p.id] ?? null))]);
  // Parcelles
  const parc = [[{ v: 'Indicateurs par parcelle', s: 'titre' }], [periode], [],
    [E('Parcelle'), E('Nb plants'), E('Superficie (ha)'), E('Débit (m³/h)'), E('Irrigations'), E('dont fertigations'), E('Heures d\'irrigation'), E('Eau d\'irrigation (m³)'), E('Traitements foliaires'), E('Bouillie (m³)')]];
  for (const p of ag.perimetre) {
    const s = ag.parcelles.find(x => x.id === p.id) || {};
    parc.push([libParcelle(p), p.nbPlants, p.superficieHa, p.debitM3h, s.irrigations || 0, s.fertigations || 0, N((s.minutes || 0) / 60), N(s.eauM3 || 0), s.traitements || 0, N((s.bouillieL || 0) / 1000)]);
  }
  const blob = creerXlsx([
    { nom: 'Irrigation-Fertigation', lignes: irr, colonnes: [6, 16, 26, 10, 10, 10, 10, ...Array(5).fill([18, 8, 8]).flat(), 30, 12, 10, 16, 16] },
    { nom: 'Traitements foliaires', lignes: trt, colonnes: [6, 16, 26, 12, 20, ...Array(5).fill([18, 10, 8]).flat(), 30, 12, 10, 16, 40, 16] },
    { nom: 'Consommations', lignes: cons, colonnes: [26, 14, 8, 12, 12, 12, 12, 12, ...ag.perimetre.map(() => 16)] },
    { nom: 'Parcelles', lignes: parc, colonnes: [26, 10, 12, 12, 11, 11, 12, 14, 12, 12] },
  ]);
  const a = h('a', { href: URL.createObjectURL(blob), download: `Suivi_fermes_${f.du}_au_${f.au}.xlsx` });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast('Fichier Excel téléchargé.');
}

// ───────────────────────── Fiche de traçabilité (PDF) ─────────────────────────
function ecranFiche(pid) {
  const p = parcelle(pid); if (!p) return aller('tableau');
  const f = S.filtre;
  const ops = opsFiltrees().filter(o => !o.annule && (o.parcelleIds || []).includes(pid)).sort((a, b) => a.date - b.date);
  const ag = K.agreger(ops, { parcelleId: pid }, S.parcelles);
  const fiche = h('div', { class: 'fiche' },
    h('h1', {}, 'Fiche de traçabilité parcellaire'),
    h('table', { class: 'tableau entete-fiche' }, h('tbody', {},
      h('tr', {}, h('th', {}, 'Ferme'), h('td', {}, ferme(p.fermeId)?.nom || ''), h('th', {}, 'Parcelle'), h('td', {}, p.nom)),
      h('tr', {}, h('th', {}, 'Espèce / variété'), h('td', {}, [p.espece, p.variete].filter(Boolean).join(' — ')), h('th', {}, 'Plants / superficie'), h('td', {}, `${fmt(p.nbPlants, 0)} plants · ${fmt(p.superficieHa, 2)} ha`)),
      h('tr', {}, h('th', {}, 'Période'), h('td', {}, `${fmtJour(new Date(f.du))} → ${fmtJour(new Date(f.au))}`), h('th', {}, 'Éditée le'), h('td', {}, fmtDate(new Date()))))),
    h('h2', {}, 'Opérations'),
    h('table', { class: 'tableau' },
      h('thead', {}, h('tr', {}, ['Date', 'Opération', 'Détail', 'Produits (saisie → quantité sur la parcelle)', 'Opérateur'].map(t => h('th', {}, t)))),
      h('tbody', {}, ops.map(op => {
        const pp = op.parcelles.find(x => x.id === pid);
        const l = K.consommations({ ...op, parcelles: [pp] });
        return h('tr', {}, h('td', {}, fmtDate(op.date)), h('td', {}, op.type === 'irrigation' ? (op.produits?.length ? 'Fertigation' : 'Irrigation') : 'Traitement foliaire'),
          h('td', {}, op.type === 'irrigation' ? `${op.dureeTotale} min` : `${op.cibleNom || ''} · ${fmt(pp.volumeL, 0)} L${op.repartition === 'prorata' ? ' (prorata)' : ''}`),
          h('td', {}, (op.produits || []).map(pr => h('div', {}, `${pr.nom} : ${String(pr.quantite).replace('.', ',')} ${pr.unite}${op.type === 'traitement' ? '/1000 L' : ''} → ${fmt(l.find(x => x.produitId === pr.id)?.quantite, 3)} ${pr.uniteBase}`))),
          h('td', {}, op.auteurNom || ''));
      }))),
    h('h2', {}, 'Totaux des produits'),
    h('table', { class: 'tableau' }, h('thead', {}, h('tr', {}, ['Produit', 'Catégorie', 'Total', 'Par plant', 'Par ha'].map(t => h('th', {}, t)))),
      h('tbody', {}, ag.produits.map(pr => h('tr', {}, h('td', {}, pr.nom), h('td', {}, pr.categorie), h('td', { class: 'n' }, `${fmt(pr.total, 3)} ${pr.uniteBase}`),
        h('td', { class: 'n' }, pr.parPlant == null ? '—' : `${fmt(pr.parPlant, 2)} ${K.unitePlant(pr.uniteBase)}`), h('td', { class: 'n' }, pr.parHa == null ? '—' : `${fmt(pr.parHa, 3)} ${pr.uniteBase}`))))),
    h('p', { class: 'petit' }, `Irrigations : ${ag.kpi.irrigations} (dont ${ag.kpi.fertigations} fertigations) · ${fmt(ag.kpi.minutes / 60, 1)} h · ${fmt(ag.kpi.eauM3, 0)} m³ d'eau · Traitements : ${ag.kpi.traitements} · ${fmt(ag.kpi.bouillieL / 1000, 2)} m³ de bouillie`),
    h('div', { class: 'signature' }, 'Visa du responsable :'));
  cadre('Fiche de traçabilité', [
    h('div', { class: 'ligne-boutons pas-imprime' },
      h('button', { class: 'btn principal', onclick: () => window.print() }, '🖨 Imprimer / Enregistrer en PDF'),
      h('small', { class: 'aide' }, 'Dans la fenêtre d\'impression, choisissez « Enregistrer au format PDF ».')),
    fiche], { retour: 'tableau' });
}

// ───────────────────────── Listes (référentiels) ─────────────────────────
function ecranListes() {
  const r = route();
  if (r[1]) { S.ongletListes = r[1]; history.replaceState(null, '', '#/listes'); }
  const ong = S.ongletListes;
  const onglets = [['fermes', 'Fermes'], ['parcelles', 'Parcelles'], ['produits', 'Produits'], ['cibles', 'Cibles']];
  if (estAdmin()) onglets.push(['utilisateurs', 'Utilisateurs']);
  const optFermes = S.fermes.map(f => ({ v: f.id, l: f.nom }));
  const defs = {
    fermes: { titre: 'Ferme', champs: [{ cle: 'nom', label: 'Nom (ex. : Ferme 03)', requis: true }, { cle: 'code', label: 'Code court (ex. : F3)', requis: true }, { cle: 'ordre', label: 'Ordre d\'affichage', type: 'nombre' }, { cle: 'actif', label: 'Active', type: 'case' }],
      ligne: f => [f.nom, f.code] },
    parcelles: { titre: 'Parcelle', champs: [{ cle: 'fermeId', label: 'Ferme', type: 'select', options: optFermes }, { cle: 'nom', label: 'Nom affiché (ex. : Pommier GALA STAR)', requis: true },
      { cle: 'espece', label: 'Espèce', requis: true }, { cle: 'variete', label: 'Variété' }, { cle: 'nbPlants', label: 'Nombre de plants', type: 'nombre', requis: true, min: 1 },
      { cle: 'superficieHa', label: 'Superficie (ha)', type: 'nombre', requis: true }, { cle: 'debitM3h', label: 'Débit d\'irrigation (m³/h)', type: 'nombre', requis: true },
      { cle: 'ordre', label: 'Ordre d\'affichage', type: 'nombre' }, { cle: 'actif', label: 'Active', type: 'case' }],
      ligne: p => [libParcelle(p), `${fmt(p.nbPlants, 0)} plants · ${fmt(p.superficieHa, 2)} ha · ${fmt(p.debitM3h, 1)} m³/h`] },
    produits: { titre: 'Produit', champs: [{ cle: 'nom', label: 'Nom', requis: true }, { cle: 'categorie', label: 'Catégorie', type: 'select', options: K.CATEGORIES.map(c => ({ v: c, l: c })) },
      { cle: 'uniteBase', label: 'Unité de base', type: 'select', options: [{ v: 'kg', l: 'kg' }, { v: 'g', l: 'g' }, { v: 'L', l: 'L' }], aide: 'Les quantités consommées seront totalisées dans cette unité.' }, { cle: 'actif', label: 'Actif (proposé à la saisie)', type: 'case' }],
      ligne: p => [p.nom, `${p.categorie || ''} · ${p.uniteBase}`] },
    cibles: { titre: 'Cible', champs: [{ cle: 'nom', label: 'Nom', requis: true }, { cle: 'ordre', label: 'Ordre d\'affichage', type: 'nombre' }, { cle: 'actif', label: 'Active', type: 'case' }], ligne: c => [c.nom, ''] },
    utilisateurs: { titre: 'Utilisateur', champs: [{ cle: 'nom', label: 'Nom affiché', requis: true }, { cle: 'role', label: 'Rôle', type: 'select', options: [{ v: 'terrain', l: 'Terrain (saisie)' }, { v: 'bureau', l: 'Bureau' }, { v: 'admin', l: 'Administrateur' }] }, { cle: 'actif', label: 'Compte actif', type: 'case' }],
      ligne: u => [`${u.nom} (${u.identifiant || ''})`, { terrain: 'Terrain', bureau: 'Bureau', admin: 'Administrateur' }[u.role] || u.role] },
  };
  const d = defs[ong];
  const liste = S[ong] || [];
  const verifierDoublon = (vals, id) => {
    if (ong === 'produits' || ong === 'cibles' || ong === 'fermes') return liste.some(x => x.id !== id && x.nom.trim().toLowerCase() === vals.nom.trim().toLowerCase());
    if (ong === 'parcelles') return liste.some(x => x.id !== id && x.fermeId === vals.fermeId && x.nom.trim().toLowerCase() === vals.nom.trim().toLowerCase());
    return false;
  };
  const editer = async el => {
    const vals = await formulaire((el ? 'Modifier : ' : 'Nouveau : ') + d.titre, d.champs, el || { actif: true, uniteBase: 'kg', categorie: 'Engrais', fermeId: S.fermes[0]?.id });
    if (!vals) return;
    if (verifierDoublon(vals, el?.id)) { toast('Ce nom existe déjà.', 'erreur'); return; }
    if (ong === 'utilisateurs' && el?.id === S.user.uid && (vals.role !== 'admin' || !vals.actif)) { toast('Vous ne pouvez pas retirer vos propres droits d\'administrateur.', 'erreur'); return; }
    B.enregistrerElement(ong, { ...(el || {}), ...vals, id: el?.id });
    toast('Enregistré ✓');
  };
  const nouvelUtilisateur = async () => {
    if (!navigator.onLine) return toast('La création d\'un compte demande une connexion Internet.', 'erreur');
    const vals = await formulaire('Nouvel utilisateur', [
      { cle: 'nom', label: 'Nom affiché (ex. : Ali)', requis: true },
      { cle: 'identifiant', label: 'Identifiant de connexion (sans espace, ex. : ali)', requis: true },
      { cle: 'motdepasse', label: 'Mot de passe (6 caractères minimum)', requis: true, min: 6 },
      { cle: 'role', label: 'Rôle', type: 'select', options: [{ v: 'terrain', l: 'Terrain (saisie)' }, { v: 'bureau', l: 'Bureau' }, { v: 'admin', l: 'Administrateur' }] }]);
    if (!vals) return;
    if (!/^[a-z0-9._-]+$/i.test(vals.identifiant)) return toast('Identifiant : lettres, chiffres, point, tiret uniquement (sans espace ni accent).', 'erreur');
    try { await B.creerUtilisateur(vals); toast(`Compte « ${vals.identifiant} » créé ✓`); }
    catch (e) { toast(String(e.code || e.message).includes('email-already') ? 'Cet identifiant existe déjà.' : 'Échec : ' + (e.message || e), 'erreur'); }
  };
  cadre('Listes', [
    h('div', { class: 'onglets-int' }, onglets.map(([k, l]) => h('button', { class: ong === k ? 'actif' : '', onclick: () => { S.ongletListes = k; afficher(); } }, l))),
    ong === 'fermes' || ong === 'parcelles' ? (!S.fermes.length ? h('div', { class: 'carte info' }, h('b', {}, 'Liste de départ'),
      h('p', {}, 'Charge les 2 fermes, les 9 parcelles (plants, superficie, débit) et une liste de cibles à adapter. Aucun produit ni aucune opération.'),
      h('button', { class: 'btn principal', onclick: async ev => {
        const btn = ev.currentTarget; btn.disabled = true;
        try { await B.initialiser(DONNEES_DEPART); toast('Liste de départ chargée ✓'); } catch (e) { toast('Échec : ' + (e.message || e), 'erreur'); btn.disabled = false; }
      } }, 'Charger la liste de départ')) : null) : null,
    h('div', { class: 'ligne-boutons' }, ong === 'utilisateurs' ? h('button', { class: 'btn principal', onclick: nouvelUtilisateur }, '+ Nouvel utilisateur')
      : h('button', { class: 'btn principal', onclick: () => editer(null) }, '+ Ajouter')),
    ong === 'utilisateurs' ? h('p', { class: 'aide' }, 'Mot de passe oublié : désactivez l\'ancien compte et créez-en un nouveau (ex. : ali2). Chacun peut changer son propre mot de passe dans « Compte ».') : null,
    !liste.length ? h('p', { class: 'vide' }, 'Liste vide.') : null,
    h('div', { class: 'liste-ref' }, liste.map(el => {
      const [a, b] = d.ligne(el);
      return h('button', { class: 'ligne-ref' + (el.actif === false ? ' inactif' : ''), onclick: () => editer(el) },
        h('div', {}, h('b', {}, a), h('div', { class: 'petit' }, b)), el.actif === false ? h('span', { class: 'badge' }, 'désactivé') : h('span', { class: 'chevron' }, '›'));
    })),
  ]);
}

// ───────────────────────── Compte ─────────────────────────
function ecranCompte() {
  const roles = { terrain: 'Terrain', bureau: 'Bureau', admin: 'Administrateur' };
  cadre('Compte', [
    h('section', { class: 'bloc' },
      h('dl', { class: 'details' }, h('dt', {}, 'Nom'), h('dd', {}, S.profil.nom), h('dt', {}, 'Identifiant'), h('dd', {}, S.user.identifiant),
        h('dt', {}, 'Rôle'), h('dd', {}, roles[S.profil.role] || S.profil.role), h('dt', {}, 'Saisies en attente'), h('dd', {}, String(S.attente)))),
    B.mode !== 'demo' ? h('button', { class: 'btn', onclick: async () => {
      if (!navigator.onLine) return toast('Connexion Internet nécessaire.', 'erreur');
      const v = await formulaire('Changer mon mot de passe', [{ cle: 'ancien', label: 'Mot de passe actuel', type: 'password', requis: true }, { cle: 'nouveau', label: 'Nouveau mot de passe (6 caractères min.)', type: 'password', requis: true, min: 6 }]);
      if (!v) return;
      try { await B.changerMotDePasse(v.ancien, v.nouveau); toast('Mot de passe changé ✓'); } catch { toast('Mot de passe actuel incorrect.', 'erreur'); }
    } }, '🔑 Changer mon mot de passe') : null,
    h('button', { class: 'btn', onclick: async () => {
      if (S.attente && !(await modal('Attention', h('p', {}, `${S.attente} saisie(s) ne sont pas encore envoyées. Si vous vous déconnectez maintenant, elles pourraient être perdues. Attendez d'avoir du réseau.`), [{ label: 'Rester connecté', valeur: () => false }, { label: 'Me déconnecter quand même', classe: 'rouge', valeur: () => true }]))) return;
      B.logout(); location.hash = '';
    } }, '🚪 Se déconnecter'),
    h('button', { class: 'btn', onclick: () => { navigator.serviceWorker?.getRegistration().then(r => r && r.update()); setTimeout(() => location.reload(), 800); } }, '🔄 Rechercher une mise à jour'),
    B.mode === 'demo' ? h('button', { class: 'btn rouge', onclick: () => B.reinitialiserDemo() }, 'Effacer les données de démonstration') : null,
    h('p', { class: 'aide' }, `Version ${VERSION} · ${B.mode === 'demo' ? 'mode démonstration' : 'connecté à Firebase'}`),
  ]);
}

// ───────────────────────── Service worker (hors connexion) ─────────────────────────
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller)
          toast(h('span', {}, 'Nouvelle version disponible. ', h('button', { class: 'btn petit-btn', onclick: () => location.reload() }, 'Mettre à jour')));
      });
    });
  }).catch(() => {});
}

demarrer();
