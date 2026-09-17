import { createTjekScraper } from '../sources/tjek';
import type { ChainInfo } from '../types';

export const foetexChain: ChainInfo = {
  id: 'foetex',
  name: 'føtex',
  color: '#1D2F54',
  category: 'supermarked',
  website: 'https://foetex.dk',
};

export const foetex = createTjekScraper({ chain: foetexChain, dealerId: 'bdf5A', dealerSlug: 'fotex' });
