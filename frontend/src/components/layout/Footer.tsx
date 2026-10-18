import clsx from 'clsx';
import { Instagram } from 'lucide-react';
import { Link } from 'react-router';
import { COMPANY } from '../../lib/company';
import { Wordmark } from './Wordmark';

/** Footer på alle sider: juridiske sider, kontakt, Instagram, opsigelse og "Fortryd aftale". */
export function Footer({ className, appNav }: { className?: string; /** Plads til mobilmenuen i appen. */ appNav?: boolean }) {
  const link = 'text-ink-2 transition hover:text-ink';
  return (
    <footer className={clsx('border-t border-black/[0.07] pt-8 text-[13px]', appNav ? 'pb-28 md:pb-10' : 'pb-10', className)}>
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
          <Link to="/app" className={link}>
            Ugens tilbud
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
        © {new Date().getFullYear()} {COMPANY.name} · {COMPANY.cvr && `CVR ${COMPANY.cvr} · `}
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
