import { describe, expect, it } from 'vitest';

// Firmaoplysningerne kommer fra miljøet – skal sættes før env indlæses.
process.env.COMPANY_NAME = 'Kodo v/ Test Testesen';
process.env.COMPANY_ADDRESS = 'Testvej 1, 8000 Aarhus C';
process.env.COMPANY_CVR = '12345678';

const { configTag, publicConfig } = await import('../src/http/site');

describe('tr-config', () => {
  it('bruger COMPANY_NAME, COMPANY_ADDRESS og COMPANY_CVR fra miljøet – ingen pladsholdere', () => {
    expect(publicConfig()).toMatchObject({
      companyName: 'Kodo v/ Test Testesen',
      companyAddress: 'Testvej 1, 8000 Aarhus C',
      companyCvr: '12345678',
    });
    const tag = configTag();
    expect(tag).toContain('Kodo v/ Test Testesen');
    expect(tag).not.toContain('UDFYLD');
  });
});
