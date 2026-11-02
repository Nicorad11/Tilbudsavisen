import type { SeoLink, SeoOffer } from './seoPages';

/**
 * Strukturerede data (schema.org) til søgemaskiner og AI. Kun det, siden
 * faktisk viser – aldrig bedømmelser (AggregateRating/Review), som vi ikke har,
 * og ingen SearchAction (Google har fjernet sitelinks-søgefeltet).
 */

export interface SiteInfo {
  appUrl: string;
  instagramUrl: string | null;
}

const abs = (appUrl: string, path: string) => (path.startsWith('http') ? path : `${appUrl}${path}`);

export function organizationJsonLd(site: SiteInfo): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Tilbudsradar',
    url: `${site.appUrl}/`,
    logo: `${site.appUrl}/icons/icon-512.png`,
    ...(site.instagramUrl ? { sameAs: [site.instagramUrl] } : {}),
  };
}

export function websiteJsonLd(site: SiteInfo): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Tilbudsradar',
    url: `${site.appUrl}/`,
    inLanguage: 'da-DK',
  };
}

export function breadcrumbJsonLd(links: SeoLink[], appUrl: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: links.map((l, i) => ({ '@type': 'ListItem', position: i + 1, name: l.label, item: abs(appUrl, l.href) })),
  };
}

/** Selve siden med opdateringstidspunkt – på alle datasider. */
export function webPageJsonLd(p: { appUrl: string; path: string; name: string; description: string; dateModified: string | null }): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: p.name,
    description: p.description,
    url: abs(p.appUrl, p.path),
    inLanguage: 'da-DK',
    isPartOf: { '@type': 'WebSite', name: 'Tilbudsradar', url: `${p.appUrl}/` },
    ...(p.dateModified ? { dateModified: p.dateModified } : {}),
  };
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * Tilbuddene på siden som en liste af produkter med pris. Til maskinlæsning –
 * Google viser ikke produkt-resultater for lister med flere produkter.
 */
export function itemListJsonLd(offers: SeoOffer[], name: string, max = 20): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: Math.min(offers.length, max),
    itemListElement: offers.slice(0, max).map((o, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: o.title,
        ...(o.imageUrl ? { image: o.imageUrl } : {}),
        ...(o.brand ? { brand: { '@type': 'Brand', name: o.brand } } : {}),
        offers: {
          '@type': 'Offer',
          price: o.offerPrice.toFixed(2),
          priceCurrency: 'DKK',
          // Sidste gyldige dag (tilbuddene slutter kl. 23.59 dansk tid dagen før valid_to i UTC).
          priceValidUntil: day(new Date(new Date(o.validTo).getTime() - 1000).toISOString()),
          seller: { '@type': 'Organization', name: o.store.name },
        },
      },
    })),
  };
}
