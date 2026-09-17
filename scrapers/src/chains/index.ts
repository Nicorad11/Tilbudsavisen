import type { ChainInfo, Scraper } from '../types';
import { bilka, bilkaChain } from './bilka';
import { foetex, foetexChain } from './foetex';
import { jemogfix } from './jemogfix';
import { lidl, lidlChain } from './lidl';
import { netto, nettoChain } from './netto';
import { power } from './power';
import { rema1000, rema1000Chain, rema1000Webshop } from './rema1000';

export const CHAINS: ChainInfo[] = [rema1000Chain, nettoChain, foetexChain, bilkaChain, lidlChain];

/**
 * Alle aktive scrapere. Hver kæde er et isoleret modul – hvis én kædes kilde
 * ændrer sig, fejler kun den scraper; resten kører videre.
 */
export const SCRAPERS: Scraper[] = [rema1000, rema1000Webshop, netto, foetex, bilka, lidl];

/**
 * Byggemarked og elektronik er sat på pause for nu (se PAUSED_CATEGORIES).
 * Flyt en scraper til SCRAPERS og dens kæde til CHAINS for at slå den til igen.
 */
export const PAUSED_SCRAPERS: Scraper[] = [jemogfix, power];

export function getScraper(id: string): Scraper | undefined {
  return SCRAPERS.find((s) => s.id === id);
}

export function scrapersForChain(chainId: string): Scraper[] {
  return SCRAPERS.filter((s) => s.chain.id === chainId);
}

/** Finder den scraper der kan parse en given rå record (til re-processering). */
export function parserFor(sourceId: string, kind: string): Scraper | undefined {
  return SCRAPERS.find((s) => s.id === sourceId && s.parses.includes(kind));
}
