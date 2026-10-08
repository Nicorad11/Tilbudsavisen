import type { ReactNode } from 'react';

/** Fælles opsætning for de juridiske sider: overskrift, version og læsevenlig tekstbredde. */
export function LegalPage({ kicker, title, updated, children }: { kicker: string; title: string; updated?: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-[760px] pt-6 pb-4 lg:pt-10">
      <p className="text-sm text-muted">{kicker}</p>
      <h1 className="mt-1 text-[38px] leading-[1.05] tracking-[-0.045em] text-ink sm:text-[52px]">{title}</h1>
      {updated && <p className="mt-3 text-[13px] text-faint">Senest opdateret {updated}</p>}
      <div className="legal mt-8 space-y-8 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </article>
  );
}

export function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="text-[21px] leading-tight tracking-[-0.02em] text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="-mx-1 overflow-x-auto rounded-[22px] bg-raised px-1 shadow-pill">
      <table className="w-full min-w-[560px] text-left text-[13.5px]">
        <thead className="text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line/60 align-top">
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? 'px-4 py-3 text-ink' : 'px-4 py-3'}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DraftNotice() {
  return (
    <p className="rounded-2xl bg-[#fbe6cf] px-4 py-3 text-[13px] leading-snug text-[#6b3a08]">
      Udkast – teksten skal gennemgås af en jurist, før Tilbudsradar lanceres.
    </p>
  );
}
