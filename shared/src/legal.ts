import { PLAN, TERMS_VERSION, WITHDRAWAL_DAYS } from './billing';

/**
 * Handelsbetingelserne som data, så siden /handelsbetingelser og
 * ordrebekræftelsen (vedhæftet som tekst = varigt medium) altid er ens.
 *
 * UDKAST – skal gennemgås af en jurist før lancering (se LAUNCH_CHECKLIST.md).
 */

export interface CompanyInfo {
  name: string;
  cvr: string;
  address: string;
  email: string;
  /** Fx https://tilbudsradaren.dk */
  appUrl: string;
}

export interface LegalSection {
  id: string;
  title: string;
  paragraphs: string[];
}

export function termsSections(c: CompanyInfo): LegalSection[] {
  const price = `${PLAN.priceDkk} kr.`;
  return [
    {
      id: 'om-os',
      title: '1. Om Tilbudsradar',
      paragraphs: [
        `Tilbudsradar drives af ${c.name}, CVR-nr. ${c.cvr}, ${c.address} ("vi"). Du kan altid kontakte os på ${c.email}.`,
        'Betingelserne gælder, når du opretter en konto og når du tegner et abonnement på Tilbudsradar. Du skal være mindst 18 år for at tegne et abonnement.',
      ],
    },
    {
      id: 'ydelsen',
      title: '2. Hvad du får',
      paragraphs: [
        'Uden konto kan du gratis søge i ugens tilbudsaviser, se søgeforslag, oversigten med ugens bedste tilbud, detaljer om et tilbud inkl. vurderingen af om det er et reelt tilbud, samt butikker og kategorier.',
        'Med en aktiv prøveperiode eller et abonnement får du desuden indkøbslister med butiks-splitting, prisalarmer og notifikationer, kvitteringsscanneren, prishistorik-grafer samt mulighed for at give og stemme på community-vurderinger.',
        'Kvitteringsscanneren har et loft over antal scanninger pr. kalendermåned, som fremgår af appen. Priserne i Tilbudsradar stammer fra kædernes tilbudsaviser og kan indeholde fejl. Det er altid kædens egen pris i butikken, der gælder.',
      ],
    },
    {
      id: 'proeveperiode',
      title: '3. Konto og gratis prøveperiode',
      paragraphs: [
        `Når du opretter en konto, får du automatisk ${PLAN.trialDays} dages gratis prøveperiode med adgang til alle funktioner. Det kræver ikke betalingskort.`,
        'Prøveperioden bliver ikke automatisk til et betalt abonnement. Når den slutter, skal du selv vælge at tegne et abonnement, hvis du vil fortsætte. Vi sender dig en e-mail 3 dage før prøveperioden slutter.',
        'Der gives én prøveperiode pr. e-mailadresse – også hvis kontoen slettes og oprettes igen.',
        `I en lanceringsperiode, før betaling er åbnet, kan alle funktioner bruges gratis af alle med en konto. Prøveperioden på ${PLAN.trialDays} dage regnes i så fald fra den dag, betaling åbner, og vi giver besked på e-mail inden.`,
        'Når prøveperioden eller abonnementet udløber, sletter vi ikke dine data. Du kan stadig se dine lister, kvitteringer og alarmer, men ikke ændre dem eller bruge de betalte funktioner, før du abonnerer igen.',
      ],
    },
    {
      id: 'pris',
      title: '4. Pris og betaling',
      paragraphs: [
        `Abonnementet koster ${price} pr. måned inkl. moms. Der er ingen oprettelsesgebyrer eller andre omkostninger.`,
        'Abonnementet betales forud for én måned ad gangen og fornyes automatisk hver måned, indtil du opsiger det. Betalingen trækkes på det betalingskort (eller Apple Pay/Google Pay), du angiver. Betalingen håndteres af Stripe; vi ser og gemmer aldrig dine kortoplysninger.',
        'Tegner du abonnementet, mens du stadig er i din gratis prøveperiode, trækkes den første betaling først, når prøveperioden slutter – dog trækkes den med det samme, hvis der er mindre end 48 timer tilbage af prøveperioden.',
        'Hvis vi ændrer prisen, får du besked på e-mail mindst 30 dage før, og du kan opsige abonnementet inden ændringen træder i kraft.',
      ],
    },
    {
      id: 'opsigelse',
      title: '5. Løbetid og opsigelse',
      paragraphs: [
        'Abonnementet er løbende og har ingen binding.',
        'Du kan til enhver tid opsige abonnementet under Konto → "Administrér eller opsig" eller via linket "Opsig abonnement" nederst på alle sider. Opsigelsen får virkning ved udløbet af den måned, du har betalt for, og du har adgang til den dag. Der refunderes ikke for den resterende del af en påbegyndt måned, medmindre du fortryder aftalen (punkt 6).',
        'Sletter du din konto, opsiges et aktivt abonnement med det samme.',
      ],
    },
    {
      id: 'fortrydelse',
      title: '6. Fortrydelsesret',
      paragraphs: [
        `Du har ${WITHDRAWAL_DAYS} dages fortrydelsesret, når du tegner et abonnement. Fristen løber fra den dag, aftalen indgås (når betalingen i Stripe er gennemført).`,
        `Du fortryder nemmest med knappen "Fortryd aftale" under Konto eller på ${c.appUrl}/fortryd. Du kan også sende os en utvetydig erklæring på e-mail til ${c.email}, eventuelt med fortrydelsesformularen nedenfor. Du skal ikke begrunde din beslutning. Fristen er overholdt, hvis du sender din fortrydelse, inden fristen udløber.`,
        'Bruger du "Fortryd aftale", sender vi straks en kvittering på e-mail med indholdet af din fortrydelse og tidspunktet for indsendelsen.',
        'Fortryder du, stopper abonnementet med det samme, og vi refunderer hele det beløb, du har betalt for abonnementet, senest 14 dage efter vi har modtaget din fortrydelse. Refunderingen sker til det betalingsmiddel, du betalte med. Er den første betaling endnu ikke trukket, trækkes der intet.',
      ],
    },
    {
      id: 'manglende-betaling',
      title: '7. Hvis betalingen fejler',
      paragraphs: [
        'Kan en betaling ikke gennemføres, får du besked på e-mail, og vi forsøger igen automatisk de følgende dage. Du beholder adgangen i en kort henstand. Lykkes betalingen ikke, stopper abonnementet, og din konto bliver skrivebeskyttet som beskrevet i punkt 3. Du kan altid opdatere dit kort under Konto.',
      ],
    },
    {
      id: 'brug',
      title: '8. Brug af tjenesten',
      paragraphs: [
        'Tilbudsradar er til personligt, ikke-kommercielt brug. Du må ikke kopiere data fra tjenesten systematisk, bruge automatiserede værktøjer mod tjenesten eller dele din konto med andre.',
        'Vurderingen af om et tilbud er "reelt" er et skøn ud fra de priser, vi har registreret de seneste 90 dage. Den er vejledende og ikke en garanti.',
        'Kvitteringsscanneren sammenligner med de tilbudsaviser, vi har hentet. Den kan tage fejl, og en markering af en "mulig fejl" er ikke en dokumenteret fejl fra kædens side.',
      ],
    },
    {
      id: 'ansvar',
      title: '9. Ansvar og driftsstabilitet',
      paragraphs: [
        'Vi gør vores bedste for, at tjenesten er tilgængelig og priserne korrekte, men vi kan ikke garantere uafbrudt drift eller at alle tilbud er med. Vi er ikke ansvarlige for kædernes priser, varer eller fejl i deres tilbudsaviser.',
        'Dine rettigheder efter dansk forbrugerlovgivning, herunder reglerne om mangler ved digitale ydelser, gælder altid.',
      ],
    },
    {
      id: 'persondata',
      title: '10. Persondata',
      paragraphs: [`Vi behandler dine personoplysninger som beskrevet i privatlivspolitikken på ${c.appUrl}/privatlivspolitik.`],
    },
    {
      id: 'aendringer',
      title: '11. Ændringer af betingelserne',
      paragraphs: [
        'Vi kan ændre betingelserne med mindst 30 dages varsel på e-mail. Er du uenig i ændringerne, kan du opsige abonnementet, før de træder i kraft. Ændringer til din fordel kan ske uden varsel.',
      ],
    },
    {
      id: 'klage',
      title: '12. Klage og lovvalg',
      paragraphs: [
        `Har du en klage, så skriv til ${c.email}. Vi svarer hurtigst muligt.`,
        'Kan vi ikke finde en løsning sammen, kan du klage til Center for Klageløsning, Nævnenes Hus, Toldboden 2, 8800 Viborg, via forbrug.dk.',
        'Aftalen er underlagt dansk ret. Det ændrer ikke ved de rettigheder, du har efter ufravigelige forbrugerregler.',
      ],
    },
    {
      id: 'formular',
      title: 'Standardfortrydelsesformular',
      paragraphs: [
        '(Denne formular udfyldes og returneres kun, hvis du ønsker at gøre fortrydelsesretten gældende.)',
        `Til: ${c.name}, ${c.address}, ${c.email}`,
        'Jeg meddeler herved, at jeg ønsker at gøre min fortrydelsesret gældende i forbindelse med min aftale om levering af følgende tjenesteydelse: Tilbudsradar-abonnement.',
        'Aftalen blev indgået den: ________   Forbrugerens navn: ________   Forbrugerens e-mail på kontoen: ________',
        'Dato: ________   (Underskrift, kun hvis formularen sendes på papir)',
      ],
    },
  ];
}

/** Betingelserne som ren tekst – vedhæftes ordrebekræftelsen. */
export function termsAsText(c: CompanyInfo): string {
  const body = termsSections(c)
    .map((s) => `${s.title}\n\n${s.paragraphs.join('\n\n')}`)
    .join('\n\n\n');
  return `HANDELSBETINGELSER FOR TILBUDSRADAR\nVersion ${TERMS_VERSION}\n\n${body}\n`;
}
