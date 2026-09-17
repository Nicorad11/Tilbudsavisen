import { createTjekScraper } from '../sources/tjek';
import type { ChainInfo } from '../types';

export const jemogfixChain: ChainInfo = {
  id: 'jemogfix',
  name: 'jem & fix',
  color: '#DE0021',
  category: 'byggemarked',
  website: 'https://jemogfix.dk',
};

export const jemogfix = createTjekScraper({
  chain: jemogfixChain,
  dealerId: '6c6bf',
  dealerSlug: 'jem-fix',
  defaultCategory: 'bolig-have',
});
