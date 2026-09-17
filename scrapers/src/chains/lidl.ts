import { createTjekScraper } from '../sources/tjek';
import type { ChainInfo } from '../types';

export const lidlChain: ChainInfo = {
  id: 'lidl',
  name: 'Lidl',
  color: '#0347A1',
  category: 'supermarked',
  website: 'https://lidl.dk',
};

export const lidl = createTjekScraper({ chain: lidlChain, dealerId: '71c90', dealerSlug: 'Lidl' });
