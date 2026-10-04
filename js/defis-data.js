// ============================================================
//  Défis de badminton (fiches du professeur) + schémas de terrain
// ============================================================

export const DEFAULT_DEFIS = [
  { num: 2, titre: 'Se déplacer', schema: 'plots',
    but: 'Réussir 10 échanges en touchant le plot entre chaque frappe.',
    consignes: 'A doit toucher le plot avec sa raquette entre chaque frappe et se replacer en zone centrale. B renvoie toujours au centre du terrain.',
    criteres: 'Donner de la hauteur au volant pour se donner du temps.',
    materiel: '1 volant pour 2 + 3 plots' },
  { num: 3, titre: 'Diagonale', schema: 'diagonale',
    but: 'Réussir 12 échanges en diagonale.',
    consignes: 'Sur grand terrain, jouer uniquement en diagonale. Privilégier les dégagés hauts.',
    criteres: 'Tourner les épaules pour croiser, prendre le volant le plus haut possible.',
    materiel: '1 volant pour 2, 1 grand terrain' },
  { num: 4, titre: 'Papillon', schema: 'papillon',
    but: 'Réussir 2 papillons.',
    consignes: 'Sur grand terrain, jouer en alternant les échanges croisés et décroisés (1-2-3-4) pour former un papillon.',
    criteres: 'Tourner les épaules pour croiser, prendre le volant le plus haut possible, se décaler dans la zone qui va être visée.',
    materiel: '1 volant pour 2, 1 grand terrain' },
  { num: 5, titre: '10 échanges en amorti', schema: 'riviere',
    but: 'Réussir 10 échanges dans la rivière (zone hachurée).',
    consignes: 'Faire 10 échanges uniquement dans la rivière, en gardant toujours au moins un pied dedans.',
    criteres: 'Face au filet, fente avant, tamis de la raquette parallèle au sol et au niveau du filet.',
    materiel: '1 volant pour 2' },
  { num: 6, titre: '10 services en diagonale', schema: 'croix',
    but: "Réussir 10 services d'affilée.",
    consignes: "Réaliser 10 services d'affilée en diagonale, en alternant côté droit et côté gauche. Le volant doit arriver derrière la rivière et avant la ligne de fond.",
    criteres: 'Face au filet, fente avant, tamis de la raquette parallèle au sol et au niveau du filet.',
    materiel: '1 volant pour 2' },
  { num: 7, titre: '10 échanges en 30 s', schema: 'joueurs',
    but: 'Réussir 10 échanges en 30 secondes.',
    consignes: 'Réaliser 10 échanges en 30 s sans que le volant tombe au sol ou soit faute. Le volant doit arriver derrière la rivière et avant la ligne de fond.',
    criteres: 'Accélérer son geste en fin de frappe pour donner de la vitesse au volant.',
    materiel: '1 volant pour 2 + 1 chronométreur' },
  { num: 8, titre: '10 échanges court-long', schema: 'courtlong',
    but: 'Alterner long-court-long.',
    consignes: 'Réaliser 8 échanges en alternant une frappe longue et une frappe courte.',
    criteres: 'Long : prendre le volant le plus haut possible, la raquette part de derrière, accélération du bras, finir vers le haut. Court : ralentir au moment de la frappe.',
    materiel: '1 volant pour 2' },
  { num: 9, titre: '12 échanges libres', schema: 'joueurs',
    but: 'Réussir 12 échanges libres.',
    consignes: "Réaliser 12 échanges d'affilée.",
    criteres: '',
    materiel: '1 volant pour 2' },
  { num: 10, titre: 'Retour de service', schema: 'joueurs',
    but: 'Renvoyer le volant après le service.',
    consignes: 'A sert. B doit renvoyer 10 fois le volant dans le terrain adverse.',
    criteres: 'Rester attentif, genoux légèrement pliés et sur la pointe des pieds.',
    materiel: '1 volant pour 2' },
  { num: 11, titre: 'Se donner du temps', schema: 'double',
    but: 'Réussir 6 échanges avec 1 raquette pour 2.',
    consignes: 'Une raquette pour 2 : entre chaque frappe, les joueurs doivent se passer la raquette.',
    criteres: 'Donner de la hauteur et de la longueur au volant pour se donner du temps. Se replacer en zone centrale.',
    materiel: '1 grand terrain, 1 volant pour 4, 1 raquette pour 2' },
  { num: 12, titre: 'Varier le jeu', schema: 'zones',
    but: 'Réussir 8 échanges.',
    consignes: 'Interdiction de jouer 2 fois de suite dans la même zone.',
    criteres: 'Varier le jeu court, le jeu long, à gauche, à droite…',
    materiel: '1 grand terrain, 1 volant pour 2' },
];

export const SCHEMAS = {
  aucun: 'Sans schéma', vide: 'Terrain seul', joueurs: 'Deux joueurs', plots: 'Plots', diagonale: 'Diagonale',
  papillon: 'Papillon', riviere: 'Rivière (amorti)', croix: 'Services croisés', courtlong: 'Court-long',
  double: 'Quatre joueurs', zones: 'Zones 1 à 4',
};

// Terrain de badminton vu de dessus (filet au centre)
export function courtSvg(type = 'vide') {
  if (type === 'aucun') return '';
  const L = 'stroke="currentColor" stroke-width="1.6" fill="none"';
  const face = (x, y) => `<g><circle cx="${x}" cy="${y}" r="7" fill="var(--paper)" stroke="currentColor" stroke-width="1.3"/><circle cx="${x - 2.3}" cy="${y - 1.5}" r=".9" fill="currentColor"/><circle cx="${x + 2.3}" cy="${y - 1.5}" r=".9" fill="currentColor"/><path d="M${x - 3} ${y + 2} q3 3 6 0" stroke="currentColor" stroke-width="1" fill="none"/></g>`;
  const arrow = (x1, y1, x2, y2, n = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--court)" stroke-width="1.8" marker-end="url(#ah)"/>${n ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 3}" font-size="8" font-weight="700" fill="var(--court)" text-anchor="middle">${n}</text>` : ''}`;
  const plot = (x, y) => `<path d="M${x} ${y - 7} l5 9 h-10 z" fill="var(--line)" stroke="currentColor" stroke-width="1"/>`;
  const extra = {
    vide: '',
    joueurs: face(60, 34) + face(182, 46),
    plots: plot(60, 12) + plot(13, 42) + plot(60, 102) + face(60, 36) + face(182, 50),
    diagonale: face(55, 34) + face(185, 76) + arrow(178, 72, 63, 37) + arrow(64, 38, 177, 73),
    papillon: arrow(58, 30, 182, 30, '4') + arrow(184, 32, 60, 78, '3') + arrow(62, 82, 182, 82, '2') + arrow(60, 32, 182, 80, '1'),
    riviere: `<defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(40)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--court)" stroke-width="1.4"/></pattern></defs><rect x="95" y="10" width="50" height="90" fill="url(#hatch)" opacity=".7"/>`,
    croix: arrow(182, 35, 62, 77) + arrow(182, 77, 62, 35),
    courtlong: face(55, 32) + face(195, 40) + arrow(65, 30, 200, 30) + arrow(200, 34, 105, 38) + arrow(105, 42, 186, 42),
    double: face(60, 32) + face(60, 78) + face(182, 32) + face(182, 78),
    zones: `<line x1="58" y1="17" x2="58" y2="93" ${L}/><line x1="182" y1="17" x2="182" y2="93" ${L}/>` +
      [[40, 38, 1], [77, 38, 2], [40, 78, 3], [77, 78, 4], [163, 38, 1], [200, 38, 2], [163, 78, 3], [200, 78, 4]]
        .map(([x, y, n]) => `<text x="${x}" y="${y}" font-size="11" font-weight="700" fill="var(--court)" text-anchor="middle">${n}</text>`).join(''),
  };
  return `<svg class="court" viewBox="0 0 240 110" role="img" aria-label="Schéma du terrain">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--court)"/></marker></defs>
    <rect x="10" y="10" width="220" height="90" ${L}/>
    <line x1="10" y1="17" x2="230" y2="17" ${L}/><line x1="10" y1="93" x2="230" y2="93" ${L}/>
    <line x1="22" y1="10" x2="22" y2="100" ${L}/><line x1="218" y1="10" x2="218" y2="100" ${L}/>
    <line x1="95" y1="10" x2="95" y2="100" ${L}/><line x1="145" y1="10" x2="145" y2="100" ${L}/>
    <line x1="120" y1="6" x2="120" y2="104" stroke="currentColor" stroke-width="2.6"/>
    <line x1="10" y1="55" x2="95" y2="55" ${L}/><line x1="145" y1="55" x2="230" y2="55" ${L}/>
    ${extra[type] ?? ''}</svg>`;
}
