// Calculs métier — aucune dépendance (testable seul).
// Unités de base d'un produit : 'kg', 'g' ou 'L'.

export const UNITES_IRRIGATION = ['kg', 'g', 'L', 'ml', 'cl', 'g/plant'];
export const UNITES_TRAITEMENT = ['kg', 'g', 'L', 'ml', 'cl'];
export const CATEGORIES = ['Engrais', 'Biostimulant', 'Correcteur', 'Insecticide', 'Fongicide',
  'Acaricide', 'Herbicide', 'Adjuvant', 'Acide', 'Autre'];

// Facteurs vers l'unité élémentaire (g pour les masses, ml pour les volumes)
const MASSE = { kg: 1000, g: 1 };
const VOLUME = { L: 1000, ml: 1, cl: 10 };

export function estMasse(base) { return base === 'kg' || base === 'g'; }

/** Unités proposées pour un produit selon son unité de base. */
export function unitesCompatibles(base, type) {
  if (estMasse(base)) return type === 'irrigation' ? ['kg', 'g', 'g/plant'] : ['kg', 'g'];
  return ['L', 'ml', 'cl'];
}

/**
 * Convertit une quantité saisie vers l'unité de base du produit.
 * Retourne null si l'unité n'est pas compatible.
 */
export function versBase(quantite, unite, base, nbPlants) {
  const q = Number(quantite);
  if (!isFinite(q)) return null;
  let elem; // grammes ou millilitres
  if (estMasse(base)) {
    if (unite === 'g/plant') elem = q * (Number(nbPlants) || 0);
    else if (MASSE[unite] != null) elem = q * MASSE[unite];
    else return null;
    return base === 'kg' ? elem / 1000 : elem;
  }
  if (VOLUME[unite] == null) return null;
  elem = q * VOLUME[unite];
  return elem / 1000; // base L
}

/** Quantité par plant affichée en g (masses) ou ml (volumes). */
export function parPlant(qteBase, base, nbPlants) {
  if (!nbPlants) return null;
  const elem = base === 'kg' || base === 'L' ? qteBase * 1000 : qteBase;
  return elem / nbPlants;
}
export function unitePlant(base) { return estMasse(base) ? 'g' : 'ml'; }

/** Répartit un volume total entre parcelles au prorata du nombre de plants. */
export function repartirProrata(volumeTotal, parcelles) {
  const total = parcelles.reduce((s, p) => s + (Number(p.nbPlants) || 0), 0);
  if (!total) return parcelles.map(() => 0);
  const parts = parcelles.map(p => Math.round(volumeTotal * (Number(p.nbPlants) || 0) / total * 10) / 10);
  // Ajuste le dernier pour retomber exactement sur le total
  const diff = Math.round((volumeTotal - parts.reduce((a, b) => a + b, 0)) * 10) / 10;
  parts[parts.length - 1] = Math.round((parts[parts.length - 1] + diff) * 10) / 10;
  return parts;
}

/**
 * Consommations d'une opération, ligne par (parcelle, produit), en unité de base.
 * op.parcelles[i] = {id, nom, nbPlants, superficieHa, debitM3h, volumeL}
 * op.produits[j] = {id, nom, uniteBase, quantite, unite}  (traitement : quantite = dose pour 1000 L)
 */
export function consommations(op) {
  const lignes = [];
  for (const p of op.parcelles || []) {
    for (const pr of op.produits || []) {
      let qBase;
      if (op.type === 'traitement') {
        const conso = Number(pr.quantite) * (Number(p.volumeL) || 0) / 1000; // dans l'unité de la dose
        qBase = versBase(conso, pr.unite, pr.uniteBase, p.nbPlants);
      } else {
        qBase = versBase(pr.quantite, pr.unite, pr.uniteBase, p.nbPlants);
      }
      lignes.push({ parcelleId: p.id, parcelleNom: p.nom, produitId: pr.id, produitNom: pr.nom,
        uniteBase: pr.uniteBase, quantite: qBase });
    }
  }
  return lignes;
}

/** Durée totale d'irrigation (min). */
export function dureeTotale(op) {
  return (Number(op.dureeAvant) || 0) + (Number(op.dureeInjection) || 0) + (Number(op.dureeApres) || 0);
}

/**
 * Agrège des opérations pour le tableau de bord.
 * filtre : {fermeId?, parcelleId?}  parcellesRef : liste du référentiel (pour plants/ha/débit à jour)
 */
export function agreger(ops, filtre, parcellesRef) {
  const dansFiltre = p => (!filtre.parcelleId || p.id === filtre.parcelleId) &&
    (!filtre.fermeId || p.fermeId === filtre.fermeId);
  const parParcelle = {};
  const produits = {}; // id -> {nom, uniteBase, categorie, fertig, foliaire, parParcelle:{}}
  const k = { irrigations: 0, fertigations: 0, minutes: 0, eauM3: 0, traitements: 0, bouillieL: 0 };
  const stat = p => (parParcelle[p.id] ||= { id: p.id, nom: p.nom, fermeId: p.fermeId,
    irrigations: 0, fertigations: 0, minutes: 0, eauM3: 0, traitements: 0, bouillieL: 0 });

  for (const op of ops) {
    if (op.annule) continue;
    const concernees = (op.parcelles || []).filter(p => dansFiltre({ ...p, fermeId: p.fermeId || op.fermeId }));
    if (!concernees.length) continue;
    if (op.type === 'irrigation') {
      for (const p of concernees) {
        const s = stat({ ...p, fermeId: op.fermeId });
        const ref = parcellesRef.find(r => r.id === p.id) || p;
        const min = dureeTotale(op);
        const eau = min / 60 * (Number(ref.debitM3h) || 0);
        s.irrigations++; s.minutes += min; s.eauM3 += eau;
        k.irrigations++; k.minutes += min; k.eauM3 += eau;
        if ((op.produits || []).length) { s.fertigations++; k.fertigations++; }
      }
    } else {
      k.traitements++;
      for (const p of concernees) {
        const s = stat({ ...p, fermeId: op.fermeId });
        s.traitements++; s.bouillieL += Number(p.volumeL) || 0;
        k.bouillieL += Number(p.volumeL) || 0;
      }
    }
    const ids = new Set(concernees.map(p => p.id));
    for (const l of consommations(op)) {
      if (!ids.has(l.parcelleId) || l.quantite == null) continue;
      const pr = (op.produits || []).find(x => x.id === l.produitId) || {};
      const e = (produits[l.produitId] ||= { id: l.produitId, nom: l.produitNom, uniteBase: l.uniteBase,
        categorie: pr.categorie || '', fertig: 0, foliaire: 0, total: 0, parParcelle: {} });
      if (op.type === 'irrigation') e.fertig += l.quantite; else e.foliaire += l.quantite;
      e.total += l.quantite;
      e.parParcelle[l.parcelleId] = (e.parParcelle[l.parcelleId] || 0) + l.quantite;
    }
  }
  const perimetre = parcellesRef.filter(p => p.actif !== false && dansFiltre(p));
  const plants = perimetre.reduce((s, p) => s + (Number(p.nbPlants) || 0), 0);
  const ha = perimetre.reduce((s, p) => s + (Number(p.superficieHa) || 0), 0);
  const listeProduits = Object.values(produits).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
    .map(e => ({ ...e, parPlant: parPlant(e.total, e.uniteBase, plants), parHa: ha ? e.total / ha : null }));
  return { kpi: k, parcelles: Object.values(parParcelle), produits: listeProduits, plants, ha, perimetre };
}

/** Contrôles de saisie. Retourne une liste de messages d'erreur (vide = OK). */
export function valider(op, maintenant = new Date()) {
  const e = [];
  if (!op.fermeId) e.push('Choisissez la ferme.');
  if (!op.parcelles || !op.parcelles.length) e.push(op.type === 'traitement' ? 'Cochez au moins une parcelle.' : 'Choisissez la parcelle.');
  if (!(op.date instanceof Date) || isNaN(op.date)) e.push('La date est invalide.');
  else {
    if (op.date.getTime() > maintenant.getTime() + 10 * 60000) e.push('La date est dans le futur.');
    if (op.date.getTime() < maintenant.getTime() - 60 * 86400000) e.push('La date a plus de 60 jours : vérifiez-la.');
  }
  const prods = op.produits || [];
  const ids = prods.map(p => p.id);
  if (prods.some(p => !p.id)) e.push('Un produit n\'est pas choisi.');
  if (new Set(ids).size !== ids.length) e.push('Le même produit est saisi deux fois.');
  for (const p of prods) {
    if (!(Number(p.quantite) > 0)) e.push(`Quantité de « ${p.nom || '?'} » : elle doit être supérieure à 0.`);
    if (!p.unite) e.push(`Unité de « ${p.nom || '?'} » : choisissez-la.`);
  }
  if (prods.length > 5) e.push('5 produits au maximum.');
  if (op.type === 'irrigation') {
    for (const [k, l] of [['dureeAvant', 'eau claire avant'], ['dureeInjection', 'injection'], ['dureeApres', 'eau claire après']])
      if (Number(op[k]) < 0 || !isFinite(Number(op[k]))) e.push(`Durée ${l} invalide.`);
    if (!(dureeTotale(op) > 0)) e.push('La durée totale doit être supérieure à 0.');
    if (op.mode === 'fertigation') {
      if (!prods.length) e.push('Fertigation : ajoutez au moins un produit (sinon choisissez « Eau claire »).');
      if (!(Number(op.dureeInjection) > 0)) e.push('Fertigation : la durée d\'injection doit être supérieure à 0.');
    }
    if (dureeTotale(op) > 24 * 60) e.push('La durée totale dépasse 24 heures.');
  } else {
    if (!op.cibleId) e.push('Choisissez la cible / l\'objectif.');
    if (!prods.length) e.push('Ajoutez au moins un produit.');
    for (const p of op.parcelles || [])
      if (!(Number(p.volumeL) > 0)) e.push(`Volume pulvérisé sur « ${p.nom} » : il doit être supérieur à 0.`);
  }
  return e;
}

export function arrondi(x, n = 2) {
  if (x == null || !isFinite(x)) return '—';
  return Number(x).toLocaleString('fr-FR', { maximumFractionDigits: n });
}
