import type { CategoryId } from '@tilbudsradar/shared';
import { basicClean } from './text';

/**
 * Nøgleordsbaseret kategorisering af danske produkttekster.
 *
 * Danske sammensatte ord ("kyllingebrystfilet") gør at de fleste nøgleord
 * matches som delstreng. Korte/tvetydige ord ("is", "øl", "ost") kræver
 * ordgrænser. Reglerne tjekkes i rækkefølge – den første der rammer vinder,
 * så specifikke kategorier (dyr, baby, elektronik) står før brede (kød, kolonial).
 */
interface Rule {
  category: CategoryId;
  contains: string[];
  words?: string[];
  /** Ekstra mønster for ordfamilier der ikke kan skrives som delstrenge. */
  pattern?: RegExp;
}

/** Specifikke udtryk der ellers ville blive fanget af en forkert regel. */
const OVERRIDES: [string, CategoryId][] = [
  ['kaffefløde', 'mejeri'],
  ['piskefløde', 'mejeri'],
  ['madlavningsfløde', 'mejeri'],
  ['chokolademælk', 'mejeri'],
  ['kakaomælk', 'mejeri'],
  ['flødeboller', 'snacks'],
  ['kartoffelchips', 'snacks'],
  ['rugbrødschips', 'snacks'],
  ['grillpølse', 'kod-fisk'],
  ['kyllingepålæg', 'kod-fisk'],
  ['leverpostej', 'kod-fisk'],
  ['icebergsalat', 'frugt-gront'],
  ['isbjergsalat', 'frugt-gront'],
  ['pommes frites', 'frost'],
  ['fiskepinde', 'frost'],
  ['hakkede tomater', 'kolonial'],
  ['flåede tomater', 'kolonial'],
  ['opvasketab', 'husholdning'],
  ['kaffemaskine', 'elektronik'],
  ['elektrisk tandbørste', 'elektronik'],
  ['k-salat', 'kolonial'],
  ['frosties', 'kolonial'],
  ['kokosmælk', 'kolonial'],
  ['jordnøddesmør', 'kolonial'],
  ['tomatpuré', 'kolonial'],
  ['tomatsauce', 'kolonial'],
  ['tomatketchup', 'kolonial'],
  ['pølsehornsdej', 'kolonial'],
  ['pølsehorn', 'brod'],
  ['pølsebrød', 'brod'],
  ['hotdogbrød', 'brod'],
  ['burgerboller', 'brod'],
  ['saftevand', 'drikkevarer'],
  ['vaseline', 'pleje'],
  ['slikskål', 'bolig-have'],
  ['vinglas', 'bolig-have'],
  ['grydeklar', 'kod-fisk'],
  ['smørrebrød', 'brod'],
  ['sodavandsmaskine', 'elektronik'],
  ['danskvandsmaskine', 'elektronik'],
  // "skål" (bolig) må ikke fange kål-sorterne
  ['blomkål', 'frugt-gront'],
  ['rødkål', 'frugt-gront'],
  ['hvidkål', 'frugt-gront'],
  ['spidskål', 'frugt-gront'],
  ['grønkål', 'frugt-gront'],
  ['rosenkål', 'frugt-gront'],
  ['kinakål', 'frugt-gront'],
  ['savoykål', 'frugt-gront'],
  ['palmekål', 'frugt-gront'],
  ['kålrabi', 'frugt-gront'],
];

const RULES: Rule[] = [
  {
    category: 'dyr',
    contains: ['hundefoder', 'kattefoder', 'kattemad', 'hundemad', 'kattegrus', 'kattesand', 'hundesnack', 'kattesnack',
      'dyrefoder', 'fuglefoder', 'whiskas', 'pedigree', 'royal canin', 'gnaverfoder', 'hundeben', 'tyggeben'],
    words: ['felix', 'hund', 'kat', 'katte'],
  },
  {
    category: 'baby',
    contains: ['bleer', 'babymos', 'modermælk', 'babygrød', 'vådservietter', 'børnemad', 'tilskudsblanding', 'libero',
      'pampers', 'babyshampoo', 'sutteflaske', 'småbørn', 'svømmeble'],
    words: ['ble', 'sut', 'sutter'],
  },
  {
    category: 'elektronik',
    contains: ['fjernsyn', 'smart-tv', 'bærbar', 'computer', 'laptop', 'iphone', 'samsung galaxy', 'smartphone',
      'mobiltelefon', 'høretelefoner', 'headset', 'hovedtelefoner', 'højttaler', 'soundbar', 'playstation', 'xbox',
      'nintendo', 'spillekonsol', 'printer', 'router', 'powerbank', 'oplader', 'hdmi', 'kamera', 'smartwatch',
      'støvsuger', 'airfryer', 'blender', 'vaskemaskine', 'tørretumbler', 'opvaskemaskine', 'køleskab', 'fryseskab',
      'kummefryser', 'mikroovn', 'elkedel', 'brødrister', 'foodprocessor', 'hårtørrer', 'glattejern', 'krøllejern',
      'barbermaskine', 'batterier', 'skærm', 'gaming', 'airpods', 'ipad', 'macbook', 'tv-', 'qled', 'oled',
      'sandwichtoaster', 'vaffeljern', 'kontaktgrill', 'røremaskine', 'stavblender', 'espressomaskine',
      'køkkenmaskine', 'kogeplade', 'induktion', 'emhætte', 'komfur', 'vandkoger', 'toaster', 'håndmikser',
      'hårklipper', 'sodastream', 'vandsmaskine', 'robotplæneklipper'],
    words: ['tv', 'pc', 'usb', 'tablet', 'led', 'watt', 'bluetooth', 'ovn', 'ovne'],
  },
  {
    category: 'bolig-have',
    contains: ['boremaskine', 'skruemaskine', 'slibemaskine', 'plæneklipper', 'hækkeklipper', 'græsslåmaskine',
      'græstrimmer', 'højtryksrenser', 'maling', 'pensel', 'værktøj', 'skruetrækker', 'havemøbler', 'havestol',
      'parasol', 'gasgrill', 'kuglegrill', 'elgrill', 'grillkul', 'briketter', 'blomsterjord', 'spagnum', 'gødning',
      'potteplante', 'planter', 'blomster', 'buket', 'roser', 'tulipaner', 'blomsterløg', 'hynder', 'lampe',
      'gardin', 'reol', 'kommode', 'madras', 'sofa', 'opbevaringsboks', 'lyskæde', 'vase', 'krukke', 'træpiller',
      'fuglebræt', 'vinterdæk', 'sommerdæk', 'bilpleje', 'sprinkler', 'haveslange', 'skovl', 'arbejdshandsker',
      'fliser', 'skruer', 'silikone', 'fugemasse', 'tapet', 'cykel', 'legetøj', 'brætspil', 'puslespil',
      'brændeovn', 'terrasse', 'hegn', 'drivhus', 'trappe', 'stige', 'dyne', 'hovedpude', 'sengetøj', 'sengesæt',
      'håndklæde', 'tæppe', 'måtte', 'skammel', 'spisebord', 'sofabord', 'kontorstol', 'spisestuestol', 'grydesæt',
      'stegepande', 'pande ', 'knivsæt', 'service', 'termokande', 'bestik', 'juletræ', 'pynt', 'kostume',
      'udsmykning', 'dekoration', 'kontorartikler', 'papir a4', 'pap ', 'skål', 'trolley', 'kuffert', 'rygsæk',
      'kalanchoe', 'orkidé', 'urtepotte', 'skjuler', 'opbevaring'],
    words: ['hammer', 'sav', 'bord', 'stol', 'seng', 'skab', 'spejl', 'søm', 'lego', 'brænde', 'skovle', 'træ', 'gryde', 'gryder'],
  },
  {
    category: 'tekstil',
    contains: ['bukser', 't-shirt', 'sokker', 'strømper', 'jakke', 'kjole', 'trusser', 'boxershorts', 'undertøj',
      'pyjamas', 'sweatshirt', 'hættetrøje', 'støvler', 'sneakers', 'leggings', 'tights', 'nederdel', 'skjorte',
      'bluse', 'cardigan', 'regnsæt', 'flyverdragt', 'hue', 'vanter', 'halstørklæde', 'badetøj', 'bikini',
      'træningstøj', 'sportstøj', 'jeans', 'shorts', 'sandaler', 'hjemmesko', 'gummistøvler', 'tøj'],
    words: ['sko', 'bh', 'strik', 'trøje', 'top'],
  },
  {
    category: 'pleje',
    contains: ['tandpasta', 'tandbørste', 'shampoo', 'balsam', 'deodorant', 'bodylotion', 'ansigtscreme', 'håndcreme',
      'dagcreme', 'natcreme', 'fugtighedscreme', 'bodycreme', 'barber', 'håndsæbe', 'showergel', 'shower gel',
      'hårfarve', 'makeup', 'mascara', 'solcreme', 'tampon', 'vatrondeller', 'vatpinde', 'plaster', 'hårspray',
      'hårvoks', 'mundskyl', 'tandtråd', 'intimserviet', 'hygiejnebind', 'trusseindlæg', 'parfume', 'læbepomade',
      'neglelak', 'rensecreme', 'serum', 'nivea', 'dove', 'gillette', 'colgate', 'zendium', 'l\'oréal', 'loreal',
      'vitaminer', 'kosttilskud', 'panodil', 'ipren', 'pinex'],
    words: ['deo', 'bind', 'sæbe', 'creme'],
  },
  {
    category: 'husholdning',
    contains: ['vaskemiddel', 'opvask', 'skyllemiddel', 'rengøring', 'toiletpapir', 'køkkenrulle', 'køkkenruller',
      'affaldsposer', 'fryseposer', 'sølvpapir', 'bagepapir', 'husholdningsfilm', 'wc-rens', 'toiletrens', 'klude',
      'opvaskesvamp', 'stearinlys', 'fyrfadslys', 'kalkfjerner', 'blegemiddel', 'vaskekapsler', 'vaskepulver',
      'maskinopvask', 'lambi', 'lotus', 'vanish', 'fairy', 'servietter', 'lightere', 'tændstikker', 'engangs',
      'kaffefiltre', 'batteri'],
    words: ['lys', 'yes', 'omo', 'ariel', 'neutral', 'persil', 'finish'],
  },
  {
    category: 'frost',
    contains: ['flødeis', 'ispinde', 'isvaffel', 'sorbet', 'frysepizza', 'frost', 'frosne', 'magnum', 'hjem-is',
      'premier is', 'ben & jerry', 'ben og jerry', 'kaffeis', 'isbåde', 'sandwichis', 'pinde-is', 'mini-is', 'frysedisk'],
    words: ['is'],
  },
  {
    category: 'drikkevarer',
    contains: ['sodavand', 'juice', 'pilsner', 'rødvin', 'hvidvin', 'rosévin', 'rosevin', 'mousserende', 'cava',
      'prosecco', 'champagne', 'cider', 'kildevand', 'danskvand', 'kaffe', 'energidrik', 'cola', 'faxe kondi',
      'smoothie', 'likør', 'vodka', 'whisky', 'snaps', 'akvavit', 'kombucha', 'ice tea', 'iced tea', 'lemonade',
      'limonade', 'tuborg', 'carlsberg', 'harboe', 'jolly', 'pepsi', 'red bull', 'monster energy', 'nescafé',
      'nescafe', 'espresso', 'kaffekapsler', 'kaffebønner', 'instant kaffe', 'tebreve', 'classic øl', 'fadøl',
      'shots', 'booster', 'sportsdrik', 'mineralvand', 'vinbox', 'bag-in-box', 'æblemost'],
    words: ['øl', 'vin', 'vand', 'te', 'rom', 'gin', 'drik', 'drikke', 'ego', 'saft', 'ale', 'ipa', 'most'],
  },
  {
    category: 'snacks',
    contains: ['chips', 'snacks', 'slik', 'chokolade', 'vingummi', 'lakrids', 'marcipan', 'nødde', 'peanuts', 'popcorn',
      'kiks', 'småkager', 'cookies', 'bolcher', 'pastiller', 'tyggegummi', 'haribo', 'marabou', 'toms ', 'matador mix',
      'müslibar', 'proteinbar', 'vafler', 'saltstænger', 'mandler', 'cashew', 'pistacie', 'karamel', 'skumfiduser',
      'anthon berg', 'ritter sport', 'pringles', 'kims', 'estrella', 'lays', 'frugtstænger', 'rosiner', 'svesker',
      'dadler', 'tørret frugt', 'guldkarameller', 'påskeæg', 'julekonfekt', 'konfekt'],
    words: ['dip', 'snack'],
  },
  {
    category: 'mejeri',
    contains: ['mælk', 'yoghurt', 'skyr', 'ymer', 'fløde', 'creme fraiche', 'cremefraiche', 'smør', 'lurpak', 'kefir',
      'skæreost', 'flødeost', 'hytteost', 'rygeost', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'brie',
      'camembert', 'danbo', 'havarti', 'mascarpone', 'ricotta', 'æggehvide', 'hønseæg', 'slotsæg', 'skrabeæg',
      'frilandsæg', 'buræg', 'havredrik', 'sojadrik', 'mandeldrik', 'plantedrik', 'oat barista', 'margarine',
      'bregott', 'kvark', 'koldskål', 'cultura', 'budding', 'riberhus', 'castello', 'arla', 'thise', 'ostehaps',
      'revet ost', 'smøreost', 'pålægsost', 'gouda', 'emmentaler', 'halloumi', 'labneh', 'græsk yoghurt'],
    words: ['ost', 'oste', 'æg', 'a38', 'skyr'],
    pattern: /[a-zæøå]{3,}[aeslødkt]ost(?![a-zæøå])/,
  },
  {
    category: 'kod-fisk',
    contains: ['kød', 'kylling', 'kalkun', 'andebryst', 'andesteg', 'bøf', 'steak', 'ribeye', 'entrecote', 'mørbrad',
      'flæsk', 'ribbenssteg', 'nakkefilet', 'nakkekotelet', 'kotelet', 'schnitzel', 'medister', 'pølse', 'bacon',
      'skinke', 'salami', 'pålæg', 'frikadelle', 'karbonade', 'hamburgerryg', 'laks', 'torsk', 'rødspætte', 'fisk',
      'rejer', 'makrel', 'sild', 'muslinger', 'hummer', 'krabbe', 'spareribs', 'pulled pork', 'pulled chicken',
      'frilandsgris', 'grisekød', 'kalvekød', 'lammekød', 'lammekølle', 'culotte', 'filet', 'tatar', 'hakket',
      'rullepølse', 'hamburger', 'wienerpølser', 'hotdogpølser', 'bøffer', 'bryst', 'overlår', 'lår', 'vinger',
      'kebab', 'gyros', 'chorizo', 'prosciutto', 'serrano', 'pepperoni', 'postej', 'tulip', 'friland', 'hanegal',
      'rokkedahl', 'gris', 'okse', 'kalv', 'fjerkræ', 'fiskefilet', 'tunfisk', 'ørred', 'kuller', 'hellefisk',
      'lamme', 'roast'],
    words: ['lam', 'tun', 'sej', 'ål'],
  },
  {
    category: 'brod',
    contains: ['brød', 'boller', 'baguette', 'flutes', 'rundstykke', 'croissant', 'kanelsnegl', 'snegle', 'tebirkes',
      'wienerbrød', 'kage', 'muffins', 'donut', 'tortilla', 'wraps', 'pitabrød', 'knækbrød', 'toast', 'bagel',
      'ciabatta', 'focaccia', 'scones', 'kringle', 'schulstad', 'kohberg', 'hatting', 'fastelavnsbolle', 'kagemand',
      'pandekage', 'vandbakkelse', 'æbleskiver', 'rugbrød', 'franskbrød', 'pølsehorn', 'bavinchi'],
    words: ['bolle'],
  },
  {
    category: 'frugt-gront',
    contains: ['æble', 'pærer', 'banan', 'appelsin', 'clementin', 'mandarin', 'citron', 'druer', 'jordbær', 'hindbær',
      'blåbær', 'brombær', 'kirsebær', 'blommer', 'fersken', 'nektarin', 'melon', 'ananas', 'mango', 'avocado',
      'kiwi', 'granatæble', 'kartof', 'gulerød', 'rødløg', 'hvidløg', 'forårsløg', 'porre', 'tomat', 'agurk',
      'peberfrugt', 'salat', 'spinat', 'broccoli', 'blomkål', 'rødkål', 'hvidkål', 'spidskål', 'kinakål', 'savoykål',
      'kålrabi', 'kålhoved', 'squash', 'aubergine', 'champignon', 'svampe',
      'majs', 'ærter', 'asparges', 'radiser', 'selleri', 'rødbede', 'pastinak', 'persille', 'basilikum',
      'krydderurter', 'ingefær', 'frugt', 'grøntsag', 'bær', 'græskar', 'sød kartoffel', 'pastinakker', 'grape',
      'rucola', 'babyspinat', 'bladselleri', 'fennikel', 'rosenkål', 'grønkål'],
    words: ['løg', 'lime', 'chili', 'pære', 'figner', 'kål'],
  },
  {
    category: 'kolonial',
    contains: ['pasta', 'spaghetti', 'penne', 'lasagne', 'basmati', 'jasminris', 'nudler', 'hvedemel', 'sukker',
      'krydderi', 'olie', 'eddike', 'ketchup', 'sennep', 'mayonnaise', 'remoulade', 'dressing', 'pesto', 'sauce',
      'bouillon', 'tomatpuré', 'passata', 'dåse', 'konserves', 'bønner', 'kikærter', 'linser', 'havregryn',
      'müsli', 'mysli', 'cornflakes', 'morgenmad', 'cereal', 'honning', 'marmelade', 'syltetøj', 'nutella',
      'pålægschokolade', 'peanutbutter', 'jordnøddesmør', 'suppe', 'taco', 'wok', 'kokosmælk', 'bagepulver',
      'kakao', 'kagemix', 'grød', 'pizzadej', 'tærtedej', 'færdigret', 'lasagneplader',
      'couscous', 'bulgur', 'quinoa', 'gnocchi', 'tortellini', 'ravioli', 'risotto', 'soja', 'knorr', 'santa maria',
      'oliven', 'kapers', 'pickles', 'asier', 'fond', 'glace', 'gelé'],
    words: ['ris', 'mel', 'salt', 'peber', 'gær', 'dej'],
  },
];

const LETTER = String.raw`\p{L}\p{N}`;

function compile(rule: Rule): (text: string) => boolean {
  const wordRe = rule.words?.length
    ? new RegExp(`(?:^|[^${LETTER}])(?:${rule.words.map(escape).join('|')})(?=$|[^${LETTER}])`, 'u')
    : null;
  return (text) =>
    rule.contains.some((w) => text.includes(w)) || (wordRe?.test(text) ?? false) || (rule.pattern?.test(text) ?? false);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPILED = RULES.map((r) => ({ category: r.category, test: compile(r) }));

function classifyClean(t: string): CategoryId | null {
  for (const [needle, category] of OVERRIDES) {
    if (t.includes(needle)) return category;
  }
  for (const rule of COMPILED) {
    if (rule.test(t)) return rule.category;
  }
  return null;
}

function classify(text: string): CategoryId | null {
  const t = ` ${basicClean(text)} `;
  // "Lammeroast med hvidløgssmør": hovedordet før "med" afgør kategorien.
  const head = t.split(' med ')[0]!;
  return (head !== t ? classifyClean(`${head} `) : null) ?? classifyClean(t);
}

export interface CategorizeOptions {
  /** Sekundær tekst (beskrivelse) der kun bruges hvis titlen ikke giver et match. */
  secondary?: string | null;
  /** Fast kategori fra kilden (fx en webshop-afdeling) – vinder altid. */
  forced?: CategoryId | null;
  fallback?: CategoryId;
}

export function categorize(title: string, opts: CategorizeOptions = {}): CategoryId {
  if (opts.forced) return opts.forced;
  return classify(title) ?? (opts.secondary ? classify(opts.secondary) : null) ?? opts.fallback ?? 'andet';
}
