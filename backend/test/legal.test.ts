import { termsAsText, type CompanyInfo } from '@tilbudsradar/shared';
import { describe, expect, it } from 'vitest';
import { subscriptionStartedMail, verifyEmailMail } from '../src/services/emails';

const soleTrader: CompanyInfo = {
  name: 'Kodo',
  cvr: null,
  address: 'Testvej 1, 8000 Aarhus C',
  email: 'kontakt@tilbudsradar.test',
  appUrl: 'https://tilbudsradar.test',
  vatRegistered: false,
};

describe('enkeltmand uden CVR og moms', () => {
  it('betingelserne nævner hverken CVR eller "inkl. moms"', () => {
    const terms = termsAsText(soleTrader);
    expect(terms).toContain('Tilbudsradar drives af Kodo, Testvej 1, 8000 Aarhus C');
    expect(terms).not.toContain('CVR');
    expect(terms).not.toContain('inkl. moms');
    expect(terms).toContain('ikke momsregistreret');
  });

  it('med CVR og momsregistrering skifter teksten automatisk', () => {
    const terms = termsAsText({ ...soleTrader, cvr: '12345678', vatRegistered: true });
    expect(terms).toContain('Kodo, CVR-nr. 12345678, Testvej 1');
    expect(terms).toContain('Abonnementet koster 49 kr. pr. måned inkl. moms.');
  });

  it('mails har ingen CVR-linje og ingen "inkl. moms", når de ikke er sat', () => {
    // Testmiljøet har hverken COMPANY_CVR eller VAT_REGISTERED.
    const verify = verifyEmailMail('a@eksempel.dk', 'https://tilbudsradar.test/app/bekraeft-email?token=x');
    expect(verify.text).not.toContain('CVR');
    const started = subscriptionStartedMail('a@eksempel.dk', {
      startedAt: new Date('2026-10-18T10:00:00Z'),
      firstChargeAt: new Date('2026-10-18T10:00:00Z'),
      currentPeriodEnd: new Date('2026-11-18T10:00:00Z'),
    });
    expect(started.text).not.toContain('inkl. moms');
    expect(started.text).toContain('49 kr. pr. måned');
  });
});
