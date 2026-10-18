import type { CompanyInfo } from '@tilbudsradar/shared';
import { CONFIG } from './config';

/**
 * Virksomhedens oplysninger til footer, /om og de juridiske sider. Kommer fra
 * serverens COMPANY_*-variabler (se lib/config.ts) – indtil de er sat, vises
 * tydelige pladsholdere.
 */
export const COMPANY = {
  name: CONFIG.companyName,
  cvr: CONFIG.companyCvr,
  address: CONFIG.companyAddress,
  email: CONFIG.contactEmail,
  instagram: CONFIG.instagramUrl ?? '',
  appUrl: CONFIG.appUrl,
};

/** " inkl. moms" når virksomheden er momsregistreret – ellers ingenting (prisen er den samlede pris). */
export const VAT = CONFIG.vatRegistered ? ' inkl. moms' : '';

export const companyInfo: CompanyInfo = {
  name: COMPANY.name,
  cvr: COMPANY.cvr,
  address: COMPANY.address,
  email: COMPANY.email,
  appUrl: COMPANY.appUrl,
  vatRegistered: CONFIG.vatRegistered,
};
