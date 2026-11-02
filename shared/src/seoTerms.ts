import { CATEGORIES, PAUSED_CATEGORIES, type CategoryId } from './categories';
import { slugify } from './slug';

/**
 * Varerne der får en side på /tilbud/{vare}. En kurateret liste over de mest
 * søgte dagligvarer – ikke alt, hvad aviserne indeholder. Siden for en vare er
 * kun med i søgemaskinerne, når der er nok data (se backend/src/services/seo).
 *
 * Tilføj en vare: skriv label (som danskere søger), de søgeord der skal finde
 * den i aviserne, og hvilke kategorier tilbuddene må ligge i. `exclude` er ord
 * i titlen, der betyder, at det er en anden vare ("smørrebrød" er ikke smør).
 * Kør `npm run seo:candidates -w backend` for at se varetyper, der mangler.
 */
export interface SeoTerm {
  slug: string;
  /** Som det skrives i overskrifter: "Hakket oksekød". */
  label: string;
  /** Søgeord – hvert ord skal stå som et helt ord i titlen (eller ramme varetypen). */
  queries: string[];
  categories: CategoryId[];
  /** Titler med disse ord er en anden vare. */
  exclude?: string[];
  /** Med i "Populære varer" i footeren og på forsiden. */
  popular?: boolean;
  /** Sådan står varen midt i en sætning. Standard: label med små bogstaver. */
  phrase: string;
}

type TermInput = [
  label: string,
  queries: string[],
  categories: CategoryId[],
  options?: { exclude?: string[]; popular?: boolean; slug?: string; phrase?: string },
];

const RAW: TermInput[] = [
  // Mejeri & æg
  ['Smør', ['smør', 'lurpak', 'kærgården'], ['mejeri'], { exclude: ['smørrebrød', 'smørepålæg', 'smørbart pålæg'], popular: true }],
  ['Mælk', ['mælk', 'letmælk', 'sødmælk', 'minimælk', 'skummetmælk'], ['mejeri'], { exclude: ['kokosmælk', 'kakaomælk', 'chokolademælk', 'kærnemælk'], popular: true }],
  ['Kærnemælk', ['kærnemælk'], ['mejeri']],
  ['Æg', ['æg', 'skrabeæg', 'frilandsæg', 'buræg'], ['mejeri'], { exclude: ['påskeæg', 'chokoladeæg', 'æggesalat', 'æggekage'], popular: true }],
  ['Ost', ['ost', 'skæreost', 'skiveost'], ['mejeri'], { exclude: ['flødeost', 'smøreost', 'revet ost', 'hytteost'], popular: true }],
  ['Revet ost', ['revet ost', 'pizzaost'], ['mejeri']],
  ['Mozzarella', ['mozzarella'], ['mejeri']],
  ['Feta', ['feta', 'salatost'], ['mejeri']],
  ['Parmesan', ['parmesan', 'parmigiano', 'grana padano'], ['mejeri']],
  ['Flødeost', ['flødeost', 'philadelphia'], ['mejeri']],
  ['Hytteost', ['hytteost'], ['mejeri']],
  ['Yoghurt', ['yoghurt', 'græsk yoghurt'], ['mejeri'], { exclude: ['yoghurtrosiner'] }],
  ['Skyr', ['skyr'], ['mejeri']],
  ['Piskefløde', ['piskefløde', 'fløde', 'madlavningsfløde'], ['mejeri'], { exclude: ['kaffefløde'] }],
  ['Creme fraiche', ['creme fraiche', 'cremefraiche', 'crème fraîche'], ['mejeri']],
  ['Havredrik', ['havredrik', 'oatly', 'plantedrik', 'sojadrik', 'mandeldrik'], ['mejeri', 'drikkevarer']],

  // Kød & fisk
  ['Hakket oksekød', ['hakket oksekød', 'oksefars', 'hakket okse'], ['kod-fisk'], { popular: true }],
  ['Hakket svinekød', ['hakket svinekød', 'hakket grisekød', 'grisefars', 'svinefars'], ['kod-fisk']],
  ['Hakket kalv og flæsk', ['hakket kalv og flæsk', 'hakket kalve- og flæskekød', 'kalv og flæsk'], ['kod-fisk']],
  ['Kyllingebryst', ['kyllingebryst', 'kyllingebrystfilet', 'kyllingebrystfileter', 'kyllingefilet', 'kyllingeinderfilet', 'kyllingeinderfileter'], ['kod-fisk', 'frost'], {
    popular: true,
  }],
  ['Hakket kylling', ['hakket kyllingekød', 'hakket kylling', 'kyllingefars'], ['kod-fisk']],
  ['Hel kylling', ['hel kylling', 'helstegt kylling', 'grillkylling'], ['kod-fisk']],
  ['Kyllingelår', ['kyllingelår', 'kyllingeoverlår', 'kyllingeunderlår'], ['kod-fisk', 'frost']],
  ['Kalkun', ['kalkun', 'kalkunbryst', 'kalkunfilet'], ['kod-fisk', 'frost']],
  ['Bacon', ['bacon'], ['kod-fisk'], { exclude: ['postej'], popular: true }],
  ['Medister', ['medister', 'medisterpølse'], ['kod-fisk']],
  ['Pølser', ['pølser', 'wienerpølser', 'hotdogpølser', 'grillpølser', 'frankfurter'], ['kod-fisk'], { exclude: ['medister', 'spegepølse', 'rullepølse'] }],
  ['Flæskesteg', ['flæskesteg'], ['kod-fisk']],
  ['Flæsk', ['skiveskåret flæsk', 'stegeflæsk', 'brystflæsk'], ['kod-fisk']],
  ['Svinemørbrad', ['mørbrad', 'svinemørbrad', 'grisemørbrad'], ['kod-fisk']],
  ['Koteletter', ['koteletter', 'nakkekoteletter', 'svinekoteletter'], ['kod-fisk']],
  ['Svinekam', ['svinekam', 'kamsteg', 'svinenakke'], ['kod-fisk']],
  ['Oksebøf', ['bøffer', 'oksebøf', 'entrecote', 'ribeye', 'oksefilet', 'tyndstegsbøf'], ['kod-fisk']],
  ['Oksesteg', ['oksesteg', 'culotte', 'tykkam', 'oksetykstegsfilet'], ['kod-fisk']],
  ['Lammekød', ['lam', 'lammekølle', 'lammekoteletter', 'lammekød'], ['kod-fisk', 'frost']],
  ['And', ['hel and', 'andebryst', 'andesteg', 'andelår'], ['kod-fisk', 'frost']],
  ['Frikadeller', ['frikadeller'], ['kod-fisk', 'frost'], { exclude: ['fiskefrikadeller'] }],
  ['Leverpostej', ['leverpostej'], ['kod-fisk', 'mejeri', 'kolonial'], { popular: true }],
  ['Rullepølse', ['rullepølse'], ['kod-fisk']],
  ['Spegepølse', ['spegepølse', 'salami'], ['kod-fisk']],
  ['Skinke', ['skinke', 'hamburgerryg', 'kogt skinke'], ['kod-fisk'], { exclude: ['skinkesalat'] }],
  ['Pålæg', ['pålæg', 'pålægssalat'], ['kod-fisk'], { exclude: ['chokoladepålæg'] }],
  ['Laks', ['laks', 'laksefilet', 'laksefileter', 'røget laks', 'koldrøget laks'], ['kod-fisk', 'frost'], { popular: true }],
  ['Rejer', ['rejer', 'kæmperejer', 'tigerrejer'], ['kod-fisk', 'frost']],
  ['Torsk', ['torsk', 'torskefilet', 'torskerogn'], ['kod-fisk', 'frost']],
  ['Rødspætte', ['rødspætte', 'rødspættefilet', 'rødspættefileter', 'fiskefilet', 'panerede fiskefileter'], ['kod-fisk', 'frost']],
  ['Fiskefrikadeller', ['fiskefrikadeller'], ['kod-fisk', 'frost']],
  ['Tun', ['tun', 'tunfisk'], ['kolonial', 'kod-fisk']],
  ['Makrel', ['makrel'], ['kolonial', 'kod-fisk']],
  ['Sild', ['sild', 'marinerede sild', 'kryddersild'], ['kod-fisk', 'kolonial']],

  // Frugt & grønt
  ['Bananer', ['bananer', 'banan'], ['frugt-gront'], { popular: true }],
  ['Æbler', ['æbler', 'æble'], ['frugt-gront'], { exclude: ['æblemost', 'æblejuice', 'æblesaft'] }],
  ['Pærer', ['pærer', 'pære'], ['frugt-gront']],
  ['Appelsiner', ['appelsiner', 'appelsin'], ['frugt-gront'], { exclude: ['appelsinjuice'] }],
  ['Clementiner', ['clementiner', 'mandariner', 'klementiner'], ['frugt-gront']],
  ['Citroner', ['citroner', 'citron', 'lime'], ['frugt-gront']],
  ['Vindruer', ['vindruer', 'druer'], ['frugt-gront']],
  ['Jordbær', ['jordbær'], ['frugt-gront', 'frost'], { exclude: ['jordbærsyltetøj', 'jordbærmarmelade'] }],
  ['Blåbær', ['blåbær'], ['frugt-gront', 'frost']],
  ['Hindbær', ['hindbær'], ['frugt-gront', 'frost']],
  ['Melon', ['melon', 'vandmelon', 'honningmelon', 'cantaloupe'], ['frugt-gront']],
  ['Ananas', ['ananas'], ['frugt-gront']],
  ['Kiwi', ['kiwi'], ['frugt-gront']],
  ['Mango', ['mango'], ['frugt-gront', 'frost']],
  ['Avocado', ['avocado', 'avocadoer'], ['frugt-gront']],
  ['Kartofler', ['kartofler', 'nye kartofler', 'bagekartofler'], ['frugt-gront'], { exclude: ['kartoffelsalat', 'kartoffelmos'], popular: true }],
  ['Sødkartofler', ['sødkartofler'], ['frugt-gront', 'frost']],
  ['Gulerødder', ['gulerødder', 'gulerod'], ['frugt-gront']],
  ['Løg', ['løg', 'rødløg', 'skalotteløg'], ['frugt-gront']],
  ['Hvidløg', ['hvidløg'], ['frugt-gront']],
  ['Tomater', ['tomater', 'cherrytomater', 'snacktomater'], ['frugt-gront']],
  ['Agurk', ['agurk', 'agurker'], ['frugt-gront']],
  ['Peberfrugt', ['peberfrugt', 'peberfrugter', 'snackpeber'], ['frugt-gront']],
  ['Broccoli', ['broccoli'], ['frugt-gront', 'frost']],
  ['Blomkål', ['blomkål'], ['frugt-gront', 'frost']],
  ['Salat', ['salat', 'icebergsalat', 'hjertesalat', 'rucola', 'babyspinat'], ['frugt-gront'], { exclude: ['kartoffelsalat', 'pastasalat', 'hønsesalat', 'skinkesalat'] }],
  ['Spinat', ['spinat'], ['frugt-gront', 'frost']],
  ['Champignon', ['champignon', 'champignoner', 'svampe'], ['frugt-gront']],
  ['Squash', ['squash', 'courgette'], ['frugt-gront']],
  ['Porrer', ['porrer', 'porre'], ['frugt-gront']],
  ['Ingefær', ['ingefær'], ['frugt-gront']],
  ['Græskar', ['græskar', 'hokkaido'], ['frugt-gront']],

  // Brød & bageri
  ['Rugbrød', ['rugbrød', 'rugbrødsboller'], ['brod'], { popular: true }],
  ['Brød', ['brød', 'grovbrød', 'kernebrød', 'surdejsbrød'], ['brod'], { exclude: ['rugbrød', 'franskbrød', 'toastbrød', 'knækbrød', 'smørrebrød'] }],
  ['Toastbrød', ['toastbrød', 'toast'], ['brod']],
  ['Franskbrød', ['franskbrød', 'hvedebrød', 'sandwichbrød'], ['brod']],
  ['Boller', ['boller', 'rundstykker', 'morgenboller', 'burgerboller'], ['brod'], { exclude: ['flødeboller', 'kødboller', 'fiskeboller'] }],
  ['Croissanter', ['croissanter', 'croissant'], ['brod', 'frost']],
  ['Tortillas', ['tortilla', 'tortillas', 'wraps'], ['brod', 'kolonial'], { exclude: ['tortilla chips'] }],
  ['Knækbrød', ['knækbrød', 'riskiks'], ['brod', 'kolonial']],

  // Kolonial
  ['Kaffe', ['kaffe', 'kaffebønner', 'helbønner', 'hele bønner', 'formalet kaffe', 'filterkaffe'], ['kolonial', 'drikkevarer'], { exclude: ['kaffefløde', 'kaffefilter', 'kaffemaskine'], popular: true }],
  ['Kaffekapsler', ['kaffekapsler', 'kapsler', 'dolce gusto', 'nespresso'], ['kolonial', 'drikkevarer']],
  ['Te', ['te', 'grøn te', 'urtete'], ['kolonial', 'drikkevarer'], { exclude: ['iste'] }],
  ['Pasta', ['pasta', 'spaghetti', 'penne', 'fusilli', 'lasagneplader', 'tagliatelle'], ['kolonial', 'mejeri'], { exclude: ['pastasalat', 'pastasauce'], popular: true }],
  ['Ris', ['ris', 'jasminris', 'basmatiris', 'risottoris'], ['kolonial'], { exclude: ['risalamande', 'risengrød', 'riskiks'] }],
  ['Nudler', ['nudler', 'instant nudler'], ['kolonial']],
  ['Havregryn', ['havregryn'], ['kolonial']],
  ['Müsli', ['müsli', 'granola', 'mysli'], ['kolonial']],
  ['Cornflakes', ['cornflakes', 'morgenmadsprodukt', 'havrefras', 'cheerios'], ['kolonial']],
  ['Mel', ['hvedemel', 'mel', 'rugmel'], ['kolonial']],
  ['Sukker', ['sukker', 'flormelis', 'rørsukker'], ['kolonial'], { exclude: ['sukkerfri', 'sukkerærter'] }],
  ['Olivenolie', ['olivenolie'], ['kolonial']],
  ['Rapsolie', ['rapsolie', 'solsikkeolie', 'madolie'], ['kolonial']],
  ['Hakkede tomater', ['hakkede tomater', 'flåede tomater', 'tomatpuré', 'passata'], ['kolonial']],
  ['Ketchup', ['ketchup'], ['kolonial']],
  ['Mayonnaise', ['mayonnaise', 'mayo'], ['kolonial']],
  ['Remoulade', ['remoulade'], ['kolonial']],
  ['Sennep', ['sennep'], ['kolonial']],
  ['Pesto', ['pesto'], ['kolonial']],
  ['Pastasauce', ['pastasauce', 'pastasaucer', 'tomatsauce', 'bolognesesauce'], ['kolonial']],
  ['Bouillon', ['bouillon', 'fond'], ['kolonial']],
  ['Kokosmælk', ['kokosmælk'], ['kolonial']],
  ['Bønner', ['bønner', 'kidneybønner', 'kikærter', 'linser'], ['kolonial'], { exclude: ['kaffebønner'] }],
  ['Peanutbutter', ['peanutbutter', 'jordnøddesmør'], ['kolonial']],
  ['Nutella', ['nutella', 'chokoladepålæg', 'nougatcreme'], ['kolonial'], { phrase: 'Nutella' }],
  ['Pålægschokolade', ['pålægschokolade'], ['snacks', 'kolonial']],
  ['Syltetøj', ['syltetøj', 'marmelade'], ['kolonial']],
  ['Honning', ['honning'], ['kolonial']],
  ['Taco', ['taco', 'tacoskaller', 'tacokrydderi', 'tacosauce'], ['kolonial']],

  // Drikkevarer
  ['Sodavand', ['sodavand', 'cola', 'coca-cola', 'pepsi', 'faxe kondi', 'fanta', 'sprite'], ['drikkevarer'], { popular: true }],
  ['Danskvand', ['danskvand', 'kildevand', 'mineralvand', 'egekilde'], ['drikkevarer']],
  ['Juice', ['juice', 'appelsinjuice', 'æblejuice', 'smoothie'], ['drikkevarer']],
  ['Saft', ['saft', 'koncentrat'], ['drikkevarer']],
  ['Energidrik', ['energidrik', 'red bull', 'monster energy', 'cult energy'], ['drikkevarer']],
  ['Øl', ['øl', 'pilsner', 'pils', 'lager', 'ipa', 'carlsberg'], ['drikkevarer'], { exclude: ['alkoholfri', 'squash', 'sodavand'], popular: true }],
  ['Alkoholfri øl', ['alkoholfri øl', 'alkoholfri'], ['drikkevarer']],
  ['Cider', ['cider'], ['drikkevarer']],
  ['Vin', ['vin', 'rødvin', 'hvidvin', 'rosévin', 'bobler', 'cava', 'prosecco'], ['drikkevarer'], { popular: true }],
  ['Kakaomælk', ['kakaomælk', 'cocio', 'chokolademælk'], ['drikkevarer', 'mejeri']],

  // Snacks & slik
  ['Chips', ['chips', 'kartoffelchips', 'tortilla chips'], ['snacks'], { popular: true }],
  ['Chokolade', ['chokolade', 'marabou', 'ritter sport', 'toms'], ['snacks'], {
    exclude: ['chokoladepålæg', 'chokolademælk', 'cruesli', 'müsli', 'mysli', 'havregryn'],
    popular: true,
  }],
  ['Slik', ['slik', 'vingummi', 'haribo', 'matador mix', 'bland selv'], ['snacks']],
  ['Kiks', ['kiks', 'småkager', 'cookies'], ['snacks'], { exclude: ['riskiks'] }],
  ['Nødder', ['nødder', 'peanuts', 'mandler', 'cashewnødder', 'saltede nødder'], ['snacks', 'kolonial']],
  ['Popcorn', ['popcorn'], ['snacks']],
  ['Is', ['is', 'flødeis', 'sorbetis', 'magnum', 'ben & jerry'], ['frost', 'snacks'], { exclude: ['isterninger', 'brut', 'champagne', 'vin'] }],

  // Frost
  ['Pizza', ['pizza', 'frossen pizza', 'pizzabund'], ['frost', 'kolonial'], { exclude: ['pizzaost'] }],
  ['Pommes frites', ['pommes frites', 'fritter', 'kartoffelbåde'], ['frost']],
  ['Ærter', ['ærter', 'grønne ærter'], ['frost', 'kolonial'], { exclude: ['kikærter', 'sukkerærter'] }],
  ['Frosne grøntsager', ['wokgrøntsager', 'grøntsagsblanding', 'frosne grøntsager'], ['frost']],

  // Husholdning
  ['Toiletpapir', ['toiletpapir'], ['husholdning'], { popular: true }],
  ['Køkkenruller', ['køkkenruller', 'køkkenrulle'], ['husholdning']],
  ['Vaskemiddel', ['vaskemiddel', 'vaskepulver', 'flydende vaskemiddel', 'colorvask'], ['husholdning']],
  ['Skyllemiddel', ['skyllemiddel'], ['husholdning']],
  ['Opvasketabs', ['opvasketabs', 'maskinopvask', 'opvaskemaskine tabs'], ['husholdning']],
  ['Opvaskemiddel', ['opvaskemiddel', 'håndopvask'], ['husholdning']],
  ['Affaldsposer', ['affaldsposer', 'skraldeposer', 'fryseposer'], ['husholdning']],
  ['Rengøringsmiddel', ['rengøringsmiddel', 'universalrengøring', 'kalkfjerner'], ['husholdning']],

  // Personlig pleje
  ['Tandpasta', ['tandpasta'], ['pleje']],
  ['Shampoo', ['shampoo', 'balsam'], ['pleje']],
  ['Deodorant', ['deodorant', 'deo'], ['pleje']],
  ['Håndsæbe', ['håndsæbe', 'flydende sæbe', 'sæbe'], ['pleje', 'husholdning']],
  ['Barberblade', ['barberblade', 'skraber', 'barberskraber'], ['pleje']],

  // Baby & børn
  ['Bleer', ['bleer', 'libero', 'pampers', 'buksebleer'], ['baby'], { popular: true }],
  ['Vådservietter', ['vådservietter'], ['baby', 'pleje']],

  // Dyr
  ['Hundefoder', ['hundefoder', 'hundemad'], ['dyr']],
  ['Kattefoder', ['kattefoder', 'kattemad'], ['dyr']],
  ['Kattegrus', ['kattegrus', 'kattesand'], ['dyr']],
];

export const SEO_TERMS: SeoTerm[] = RAW.map(([label, queries, categories, opts]) => ({
  slug: opts?.slug ?? slugify(label),
  label,
  phrase: opts?.phrase ?? label.toLocaleLowerCase('da-DK'),
  queries,
  categories,
  ...(opts?.exclude ? { exclude: opts.exclude } : {}),
  ...(opts?.popular ? { popular: true } : {}),
}));

export const seoTermBySlug = (slug: string) => SEO_TERMS.find((t) => t.slug === slug);
export const POPULAR_TERMS = SEO_TERMS.filter((t) => t.popular);

/**
 * Kategorisiderne (/kategori/{slug}): de synlige kategorier – ikke de pausede
 * (elektronik, bolig og have) og ikke "Andet", der er en restgruppe.
 */
export const SEO_CATEGORIES = CATEGORIES.filter((c) => !PAUSED_CATEGORIES.includes(c.id) && c.id !== 'andet').map((c) => ({
  id: c.id,
  label: c.label,
  slug: slugify(c.label),
}));

export const seoCategoryBySlug = (slug: string) => SEO_CATEGORIES.find((c) => c.slug === slug);
export const seoCategoryById = (id: string) => SEO_CATEGORIES.find((c) => c.id === id);
