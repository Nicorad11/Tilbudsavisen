import { createTjekScraper } from '../sources/tjek';
import type { ChainInfo } from '../types';

export const nettoChain: ChainInfo = {
  id: 'netto',
  name: 'Netto',
  color: '#E8B700',
  category: 'supermarked',
  website: 'https://netto.dk',
};

export const netto = createTjekScraper({ chain: nettoChain, dealerId: '9ba51', dealerSlug: 'Netto' });
