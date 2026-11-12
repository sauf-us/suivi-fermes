// Liste de départ : fermes et parcelles (reprises du fichier Suivi_fermes.xlsx, onglet « Tableau de bord »).
// Aucune opération ni aucun produit n'est importé. Tout reste modifiable dans « Listes ».
export const DONNEES_DEPART = {
  fermes: [
    { id: 'F01', nom: 'Ferme 01', code: 'F1', actif: true, ordre: 1 },
    { id: 'F02', nom: 'Ferme 02', code: 'F2', actif: true, ordre: 2 },
  ],
  parcelles: [
    { fermeId: 'F01', nom: 'Citronnier', espece: 'Citronnier', variete: '', nbPlants: 3400, superficieHa: 6.2, debitM3h: 108.8 },
    { fermeId: 'F01', nom: 'Nectarinier GALEN', espece: 'Nectarinier', variete: 'GALEN', nbPlants: 2100, superficieHa: 2.8, debitM3h: 33.6 },
    { fermeId: 'F01', nom: 'Nectarinier ZEPHYR', espece: 'Nectarinier', variete: 'ZEPHYR', nbPlants: 2100, superficieHa: 2.8, debitM3h: 33.6 },
    { fermeId: 'F01', nom: 'Pêcher M31', espece: 'Pêcher', variete: 'M31', nbPlants: 2100, superficieHa: 2.8, debitM3h: 33.6 },
    { fermeId: 'F02', nom: 'Poirier SANTA MARIA', espece: 'Poirier', variete: 'SANTA MARIA', nbPlants: 12000, superficieHa: 10, debitM3h: 144 },
    { fermeId: 'F02', nom: 'Pommier GALA STAR', espece: 'Pommier', variete: 'GALA STAR', nbPlants: 4000, superficieHa: 3.5, debitM3h: 46 },
    { fermeId: 'F02', nom: 'Pommier STORY', espece: 'Pommier', variete: 'STORY', nbPlants: 2000, superficieHa: 1.5, debitM3h: 20 },
    { fermeId: 'F02', nom: 'Figuier', espece: 'Figuier', variete: '', nbPlants: 900, superficieHa: 1.3, debitM3h: 19.5 },
    { fermeId: 'F02', nom: 'Olivier', espece: 'Olivier', variete: '', nbPlants: 460, superficieHa: 0.2, debitM3h: 6 },
  ].map((p, i) => ({ ...p, actif: true, ordre: i + 1 })),
  // Liste de départ des cibles, à adapter dans « Listes > Cibles ».
  cibles: ['Nutrition foliaire', 'Pucerons', 'Acariens', 'Carpocapse', 'Psylle', 'Mouche des fruits', 'Cochenilles',
    'Thrips', 'Tavelure', 'Oïdium', 'Moniliose', 'Cloque', 'Feu bactérien', 'Préventif général', 'Autre']
    .map((nom, i) => ({ nom, actif: true, ordre: i + 1 })),
};
