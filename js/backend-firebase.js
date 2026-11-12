// Connexion à Firebase (Authentification + base Firestore avec cache hors connexion).
const V = '13.2.0';
const { initializeApp, deleteApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
const A = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
const F = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);

const DOMAINE = '@ferme.local'; // l'identifiant « ali » devient ali@ferme.local (aucun e-mail n'est envoyé)
const versEmail = id => String(id).trim().toLowerCase() + DOMAINE;

export function creerBackend(config) {
  const app = initializeApp(config);
  const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
  const db = F.initializeFirestore(app, {
    localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
  });
  const C = n => F.collection(db, n);
  const D = (n, id) => F.doc(db, n, id);

  const DATES = ['date', 'saisiLe', 'creeServeur', 'modifieLe', 'creeLe', 'le'];
  function lire(snap) {
    const d = { id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) };
    for (const k of DATES) if (d[k] && typeof d[k].toDate === 'function') d[k] = d[k].toDate();
    if (d.avant) for (const k of DATES) if (d.avant[k] && typeof d.avant[k].toDate === 'function') d.avant[k] = d.avant[k].toDate();
    d._attente = !!(snap.metadata && snap.metadata.hasPendingWrites);
    return d;
  }
  function ecrire(o) { // retire les champs internes, convertit les dates
    const r = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === 'id' || k.startsWith('_') || v === undefined) continue;
      r[k] = v instanceof Date ? F.Timestamp.fromDate(v) : v;
    }
    return r;
  }
  const erreur = (e) => { console.error(e); window.dispatchEvent(new CustomEvent('erreur-envoi', { detail: e })); };

  return {
    mode: 'firebase',
    onAuth(cb) {
      return A.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, identifiant: (u.email || '').replace(DOMAINE, '') } : null));
    },
    async login(identifiant, mdp) { await A.signInWithEmailAndPassword(auth, versEmail(identifiant), mdp); },
    async logout() { await A.signOut(auth); },
    async changerMotDePasse(ancien, nouveau) {
      const u = auth.currentUser;
      await A.reauthenticateWithCredential(u, A.EmailAuthProvider.credential(u.email, ancien));
      await A.updatePassword(u, nouveau);
    },
    async profil(uid) {
      const s = await F.getDoc(D('utilisateurs', uid));
      return s.exists() ? lire(s) : null;
    },
    async estInitialise() { return (await F.getDoc(D('config', 'init'))).exists(); },
    async devenirAdmin(uid, nom, identifiant) {
      const b = F.writeBatch(db);
      b.set(D('utilisateurs', uid), { nom, identifiant, role: 'admin', actif: true, creeLe: F.serverTimestamp() });
      b.set(D('config', 'init'), { par: uid, le: F.serverTimestamp() });
      await b.commit();
    },
    async creerUtilisateur({ nom, identifiant, motdepasse, role }) {
      const app2 = initializeApp(config, 'creation-' + Date.now());
      try {
        const auth2 = A.initializeAuth(app2, { persistence: A.inMemoryPersistence });
        const cred = await A.createUserWithEmailAndPassword(auth2, versEmail(identifiant), motdepasse);
        await F.setDoc(D('utilisateurs', cred.user.uid), { nom, identifiant: identifiant.trim().toLowerCase(), role, actif: true, creeLe: F.serverTimestamp() });
        await A.signOut(auth2);
      } finally { await deleteApp(app2); }
    },
    nouvelId(n = 'operations') { return F.doc(C(n)).id; },
    surveillerListe(nom, cb) {
      return F.onSnapshot(C(nom), s => cb(s.docs.map(lire)), erreur);
    },
    enregistrerElement(nom, el) {
      const id = el.id || F.doc(C(nom)).id;
      F.setDoc(D(nom, id), ecrire(el), { merge: true }).catch(erreur);
      return id;
    },
    initialiser(donnees) { // {fermes:[], parcelles:[], cibles:[]}
      const b = F.writeBatch(db);
      for (const [n, liste] of Object.entries(donnees))
        for (const el of liste) b.set(el.id ? D(n, el.id) : F.doc(C(n)), ecrire(el));
      return b.commit();
    },
    surveillerMesOps(uid, cb) {
      return F.onSnapshot(F.query(C('operations'), F.where('auteurUid', '==', uid)), { includeMetadataChanges: true },
        s => cb(s.docs.map(lire), { attente: s.docs.filter(d => d.metadata.hasPendingWrites).length, cache: s.metadata.fromCache }), erreur);
    },
    surveillerOpsDepuis(depuis, cb) {
      let premier = true;
      return F.onSnapshot(F.query(C('operations'), F.where('date', '>=', F.Timestamp.fromDate(depuis))), { includeMetadataChanges: true },
        s => {
          const nouvelles = premier ? [] : s.docChanges().filter(c => c.type === 'added' && !c.doc.metadata.hasPendingWrites).map(c => lire(c.doc));
          if (!s.metadata.fromCache) premier = false;
          cb(s.docs.map(lire), { nouvelles });
        }, erreur);
    },
    async lireOp(id) { const s = await F.getDoc(D('operations', id)); return s.exists() ? lire(s) : null; },
    // Enregistre sans attendre le réseau : la saisie part dès que la connexion revient.
    enregistrerOp(op, { nouveau, avant, utilisateur }) {
      const ref = D('operations', op.id);
      const b = F.writeBatch(db);
      if (nouveau) {
        b.set(ref, { ...ecrire(op), creeServeur: F.serverTimestamp(), annule: false });
      } else {
        const donnees = ecrire(op);
        delete donnees.creeServeur; delete donnees.auteurUid; delete donnees.auteurNom; delete donnees.saisiLe;
        b.update(ref, { ...donnees, modifieLe: F.serverTimestamp(), modifiePar: utilisateur.nom, nbModifs: F.increment(1) });
        b.set(F.doc(F.collection(db, 'operations', op.id, 'historique')), {
          le: F.serverTimestamp(), parUid: utilisateur.uid, parNom: utilisateur.nom, avant: ecrire(avant), motif: op._motif || '',
        });
      }
      b.commit().catch(erreur);
    },
    enregistrerPhoto(opId, dataUrl, auteurUid) {
      F.setDoc(D('photos', opId), { data: dataUrl, auteurUid }).catch(erreur);
    },
    async lirePhoto(opId) {
      try { const s = await F.getDoc(D('photos', opId)); return s.exists() ? s.data().data : null; } catch { return null; }
    },
    async lireHistorique(opId) {
      const s = await F.getDocs(F.collection(db, 'operations', opId, 'historique'));
      return s.docs.map(lire).sort((a, b) => (b.le || 0) - (a.le || 0));
    },
  };
}
