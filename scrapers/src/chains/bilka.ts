import { createTjekScraper } from '../sources/tjek';
import type { ChainInfo } from '../types';

export const bilkaChain: ChainInfo = {
  id: 'bilka',
  name: 'Bilka',
  color: '#00AEEF',
  category: 'supermarked',
  website: 'https://bilka.dk',
};

/** Bilka har både Food- og Nonfood-aviser; kategorien afgøres pr. vare. */
export const bilka = createTjekScraper({ chain: bilkaChain, dealerId: '93f13', dealerSlug: 'Bilka' });
