import { createTjekScraper } from '../sources/tjek';
import type { ChainInfo } from '../types';

export const powerChain: ChainInfo = {
  id: 'power',
  name: 'POWER',
  color: '#F15C25',
  category: 'elektronik',
  website: 'https://power.dk',
};

export const power = createTjekScraper({
  chain: powerChain,
  dealerId: '6448Cm',
  dealerSlug: 'POWER',
  defaultCategory: 'elektronik',
});
