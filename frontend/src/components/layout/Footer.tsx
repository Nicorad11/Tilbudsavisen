import { POPULAR_TERMS, SEO_CATEGORIES, SEO_STORES } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { Instagram } from 'lucide-react';
import { Link } from 'react-router';
import { COMPANY } from '../../lib/company';
import { Wordmark } from './Wordmark';

/** Årstallet i dansk tid, så server og browser er enige omkring nytår. */
const copyrightYear = new Intl.DateTimeFormat('da-DK', { year: 'numeric', timeZone: 'Europe/Copenhagen' });

/**
 * Footer på alle sider: populære varer, kæder og kategorier (datasiderne), juridiske
 * sider, kontakt, Instagram, opsigelse og "Fortryd aftale". Faste lister – ingen hentning.
 */
export function Footer({ className, appNav }: { className?: string; /** Plads til mobilmenuen i appen. */ appNav?: boolean }) {
  const link = 'text-ink-2 transition hover:text-ink';
  return (
    <footer className={clsx('border-t border-black/[0.07] pt-8 text-[13px]', appNav ? 'pb-28 md:pb-10' : 'pb-10', className)}>
      <div className="mb-10 grid gap-8 border-b border-black/[0.07] pb-10 md:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1.5fr)]">
        <nav aria-label="Populære varer">
          <p className="text-muted">Populære varer på tilbud</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {POPULAR_TERMS.map((t) => (
              <li key={t.slug}>
                <Link to={`/tilbud/${t.slug}`} className={link}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/tilbud" className="mt-3 inline-block text-ink underline underline-offset-4 hover:no-underline">
            Alle varer A–Å
          </Link>
        </nav>
        <nav aria-label="Tilbudsaviser">
          <p className="text-muted">Tilbudsaviser</p>
          <ul className="mt-3 flex flex-col gap-2">
            {SEO_STORES.map((st) => (
              <li key={st.slug}>
                <Link to={`/butik/${st.slug}`} className={link}>
                  {st.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Kategorier">
          <p className="text-muted">Kategorier</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {SEO_CATEGORIES.map((c) => (
              <li key={c.slug}>
                <Link to={`/kategori/${c.slug}`} className={link}>
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="grid gap-8 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div className="space-y-3">
          <Wordmark />
          <p className="max-w-[34ch] leading-snug text-muted">Alle danske tilbudsaviser i ét søgefelt – med pris pr. kilo og vurdering af, om tilbuddet er reelt.</p>
          {COMPANY.instagram && (
            <a href={COMPANY.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-ink-2 hover:text-ink">
              <Instagram className="size-4" strokeWidth={1.6} />
              Følg os på Instagram
            </a>
          )}
        </div>
        <nav aria-label="Tilbudsradar" className="flex flex-col gap-2">
          <p className="text-muted">Tilbudsradar</p>
          <Link to="/ugens-bedste-tilbud" className={link}>
            Ugens bedste tilbud
          </Link>
          <Link to="/indsigt" className={link}>
            Hvor reelle er tilbuddene?
          </Link>
          <Link to="/metode" className={link}>
            Sådan vurderer vi tilbud
          </Link>
          <Link to="/priser" className={link}>
            Priser
          </Link>
          <Link to="/om" className={link}>
            Om os
          </Link>
          <a href={`mailto:${COMPANY.email}`} className={link}>
            Kontakt
          </a>
        </nav>
        <nav aria-label="Abonnement" className="flex flex-col gap-2">
          <p className="text-muted">Abonnement</p>
          <Link to="/app/konto#abonnement" className={link}>
            Opsig abonnement
          </Link>
          <Link to="/fortryd" className={link}>
            Fortryd aftale
          </Link>
          <Link to="/app/konto" className={link}>
            Konto
          </Link>
        </nav>
        <nav aria-label="Juridisk" className="flex flex-col gap-2">
          <p className="text-muted">Juridisk</p>
          <Link to="/handelsbetingelser" className={link}>
            Handelsbetingelser
          </Link>
          <Link to="/privatlivspolitik" className={link}>
            Privatlivspolitik
          </Link>
          <Link to="/cookies" className={link}>
            Cookies
          </Link>
        </nav>
      </div>
      <p className="mt-8 text-[12px] leading-snug text-muted">
        © {copyrightYear.format(new Date())} {COMPANY.name} · {COMPANY.cvr && `CVR ${COMPANY.cvr} · `}
        {COMPANY.address} ·{' '}
        <a href={`mailto:${COMPANY.email}`} className="hover:text-ink">
          {COMPANY.email}
        </a>
        <br />
        Tilbudsradar er ikke tilknyttet REMA 1000, Netto, føtex, Bilka eller Lidl. Priserne kommer fra kædernes tilbudsaviser – kædens pris i butikken gælder altid.
      </p>
    </footer>
  );
}
