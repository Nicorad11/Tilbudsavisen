import { createRemaWebshopScraper } from '../sources/remaWebshop';
import { createTjekScraper } from '../sources/tjek';
import type { ChainInfo } from '../types';

export const rema1000Chain: ChainInfo = {
  id: 'rema1000',
  name: 'REMA 1000',
  color: '#014693',
  category: 'supermarked',
  website: 'https://rema1000.dk',
};

/** Ugens avis (Tjek-API) – selve tilbuddene. */
export const rema1000 = createTjekScraper({ chain: rema1000Chain, dealerId: '11deC', dealerSlug: 'REMA-1000' });

/** Webshop-API – hyldepriser til prishistorik og "reelt tilbud"-vurdering. */
export const rema1000Webshop = createRemaWebshopScraper(rema1000Chain);
