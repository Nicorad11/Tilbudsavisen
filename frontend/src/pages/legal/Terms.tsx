import { TERMS_VERSION, termsSections } from '@tilbudsradar/shared';
import { companyInfo } from '../../lib/company';
import { DraftNotice, LegalPage, Section } from './LegalPage';

/** Handelsbetingelserne – samme tekst som vedhæftes ordrebekræftelsen (shared/src/legal.ts). */
export function Terms() {
  const sections = termsSections(companyInfo);
  return (
    <LegalPage kicker={`Version ${TERMS_VERSION}`} title="Handelsbetingelser">
      <DraftNotice />
      <nav aria-label="Indhold" className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="text-ink-2 underline decoration-ink/20 underline-offset-2 hover:text-ink">
            {s.title.replace(/^\d+\.\s*/, '')}
          </a>
        ))}
      </nav>
      {sections.map((s) => (
        <Section key={s.id} id={s.id} title={s.title}>
          {s.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </Section>
      ))}
    </LegalPage>
  );
}
