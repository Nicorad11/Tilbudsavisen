import type { SearchSuggestionDTO, SuggestResponse } from '@tilbudsradar/shared';
import { unitPriceLabel } from '@tilbudsradar/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { History, Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { kr } from '../lib/format';
import { CategoryIcon } from '../lib/icons';
import { Button, IconButton } from './ui/primitives';

/* ------------------------------------------------------------------ */
/* Seneste søgninger (kun i browseren – en bekvemmelighed)            */
/* ------------------------------------------------------------------ */

const RECENT_KEY = 'tr:recent-searches';

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    // Privat vindue o.l. – så huskes søgningerne bare ikke.
  }
}

export function rememberSearch(q: string): void {
  const term = q.trim();
  if (term.length < 2) return;
  writeRecent([term, ...readRecent().filter((x) => x.toLocaleLowerCase('da-DK') !== term.toLocaleLowerCase('da-DK'))]);
}

/* ------------------------------------------------------------------ */
/* Forslag                                                            */
/* ------------------------------------------------------------------ */

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function useSuggest(q: string) {
  const term = useDebounced(q.trim(), 120);
  return useQuery({
    queryKey: ['suggest', term.toLocaleLowerCase('da-DK')],
    queryFn: ({ signal }) => api<SuggestResponse>('/search/suggest', { query: { q: term }, signal }),
    enabled: term.length >= 2,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

type Option =
  | { kind: 'suggestion'; key: string; suggestion: SearchSuggestionDTO }
  | { kind: 'category'; key: string; id: string; label: string; count: number }
  | { kind: 'recent'; key: string; term: string };

const sentence = (s: string) => s.charAt(0).toLocaleUpperCase('da-DK') + s.slice(1);

/** Fremhæver de dele af forslaget der matcher det skrevne: "okse" i "Hakket *okse*kød", "æg" i "Skrabe*æg*". */
function Highlight({ text, query }: { text: string; query: string }) {
  const lower = text.toLocaleLowerCase('da-DK');
  const tokens = query
    .toLocaleLowerCase('da-DK')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  const marked = new Array<boolean>(text.length).fill(false);
  for (const t of tokens) {
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + 1)) {
      const atStart = i === 0 || /[\s-]/.test(lower[i - 1]!);
      const atEnd = i + t.length === lower.length || /[\s-]/.test(lower[i + t.length]!);
      if (atStart || atEnd) marked.fill(true, i, i + t.length);
    }
  }
  const parts: ReactNode[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marked[i] !== marked[start]) {
      const chunk = text.slice(start, i);
      parts.push(
        marked[start] ? (
          <span key={start} className="font-semibold text-ink">
            {chunk}
          </span>
        ) : (
          chunk
        ),
      );
      start = i;
    }
  }
  return <>{parts}</>;
}

/* ------------------------------------------------------------------ */
/* Søgefelt                                                           */
/* ------------------------------------------------------------------ */

export interface SearchBoxProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Enter, klik på et forslag eller søgeknappen. `category` sættes ved "okse i Kød & fisk". */
  onSearch: (q: string, opts?: { category?: string }) => void;
  variant: 'page' | 'hero';
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Søgefelt med forslag (combobox-mønsteret): varetyper med pris og antal kæder,
 * kategorier og seneste søgninger. Styres med piletaster, Enter og Esc.
 */
export function SearchBox({ value, onValueChange, onSearch, variant, placeholder, submitLabel, autoFocus, className }: SearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  // Læses også ved start: feltet kan have autofokus, før fokus-hændelsen når frem.
  const [recent, setRecent] = useState<string[]>(readRecent);
  const suggest = useSuggest(value);
  const typed = value.trim();

  // Forslagene gælder kun, når de passer til det der står i feltet lige nu.
  const data = typed.length >= 2 && suggest.data && suggest.data.query.length >= 2 ? suggest.data : null;
  const options: Option[] =
    typed.length < 2
      ? recent.map((term) => ({ kind: 'recent', key: `r:${term}`, term }))
      : [
          ...(data?.suggestions ?? []).map((s): Option => ({ kind: 'suggestion', key: `s:${s.term}`, suggestion: s })),
          ...(data?.categories ?? []).map(
            (c): Option => ({ kind: 'category', key: `c:${c.id}`, id: c.id, label: c.label, count: c.count }),
          ),
        ];
  const open = focused && !dismissed && options.length > 0;

  useEffect(() => setActive(-1), [typed, data]);

  const close = () => {
    setDismissed(true);
    setActive(-1);
  };

  const search = (q: string, opts?: { category?: string }) => {
    const term = q.trim();
    if (!term) return;
    rememberSearch(term);
    close();
    // Lukker tastaturet på mobil, så resultaterne kan ses.
    inputRef.current?.blur();
    onSearch(term, opts);
  };

  const choose = (o: Option) => {
    if (o.kind === 'category') {
      search(typed, { category: o.id });
    } else {
      const term = o.kind === 'recent' ? o.term : o.suggestion.term;
      onValueChange(term);
      search(term);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      setFocused(true);
      setDismissed(false);
      const n = options.length;
      const down = e.key === 'ArrowDown';
      setActive((i) => (down ? (i + 1 >= n ? 0 : i + 1) : i <= 0 ? n - 1 : i - 1));
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault();
      choose(options[active]!);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;

  const input = (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => {
        onValueChange(e.target.value);
        setFocused(true);
        setDismissed(false);
      }}
      onFocus={() => {
        setRecent(readRecent());
        setFocused(true);
        setDismissed(false);
      }}
      // Autofokus sender ingen fokus-hændelse, og et klik i et felt der allerede
      // har fokus gør heller ikke – så et klik åbner også listen.
      onClick={() => {
        setRecent(readRecent());
        setFocused(true);
        setDismissed(false);
      }}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      aria-label="Søg"
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
      autoComplete="off"
      autoFocus={autoFocus}
      enterKeyHint="search"
      className={clsx(
        'h-full w-full min-w-0 bg-transparent text-ink outline-none placeholder:text-faint',
        variant === 'page' ? 'text-[17px] tracking-tight' : 'text-[15px]',
      )}
    />
  );

  const clear = value && (
    <IconButton
      label="Ryd"
      size="sm"
      tone="ghost"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onValueChange('');
        setDismissed(false);
        inputRef.current?.focus();
      }}
    >
      <X className="size-4" />
    </IconButton>
  );

  const dropdown = open && (
    <ul
      id={listId}
      role="listbox"
      aria-label="Forslag"
      // Klik må ikke tage fokus fra feltet, ellers lukker listen før klikket registreres.
      onMouseDown={(e) => e.preventDefault()}
      className="absolute inset-x-0 top-full z-40 mt-2 max-h-[min(70vh,460px)] overflow-y-auto rounded-[24px] bg-raised p-1.5 shadow-float ring-1 ring-black/[0.04]"
    >
      {options.map((o, i) => {
        const header =
          o.kind === 'recent' && i === 0 ? (
            <li role="presentation" className="flex items-center justify-between px-3 pt-1.5 pb-1 text-[11.5px] text-faint">
              Seneste søgninger
              <button
                type="button"
                className="text-muted hover:text-ink"
                onClick={() => {
                  writeRecent([]);
                  setRecent([]);
                }}
              >
                Ryd
              </button>
            </li>
          ) : o.kind === 'category' && options[i - 1]?.kind !== 'category' ? (
            <li role="presentation" className={clsx('px-3 pt-2 pb-1 text-[11.5px] text-faint', i > 0 && 'mt-1 border-t border-black/[0.05]')}>
              Kategorier
            </li>
          ) : null;
        return (
          <OptionRow key={o.key} header={header} id={optionId(i)} active={i === active} onHover={() => setActive(i)} onChoose={() => choose(o)}>
            {o.kind === 'suggestion' ? (
              <SuggestionContent s={o.suggestion} query={typed} />
            ) : o.kind === 'category' ? (
              <>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">
                  <CategoryIcon id={o.id} className="size-4 text-ink-2" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink-2">
                  “{typed}” i <span className="text-ink">{o.label}</span>
                </span>
                <span className="tabular shrink-0 text-[12.5px] text-muted">{o.count} tilbud</span>
              </>
            ) : (
              <>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">
                  <History className="size-4 text-muted" strokeWidth={1.7} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{o.term}</span>
              </>
            )}
          </OptionRow>
        );
      })}
    </ul>
  );

  if (variant === 'page') {
    return (
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          search(value);
        }}
        className={clsx('relative', className)}
      >
        <div className="flex h-14 items-center gap-3 rounded-full bg-raised pr-2 pl-5 shadow-float ring-ink/80 focus-within:ring-2">
          <SearchIcon className="size-5 shrink-0 text-muted" strokeWidth={1.6} />
          {input}
          {clear}
          <Button type="submit" tone="dark" className="max-sm:hidden">
            {submitLabel}
          </Button>
        </div>
        {dropdown}
      </form>
    );
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        search(value);
      }}
      className={clsx('flex flex-col gap-2 sm:flex-row', className)}
    >
      <div className="relative flex-1">
        <div className="flex h-11 items-center gap-2 rounded-full bg-raised pr-1.5 pl-4 shadow-pill ring-ink/80 focus-within:ring-2">
          <SearchIcon className="size-[18px] shrink-0 text-muted" />
          {input}
          {clear}
        </div>
        {dropdown}
      </div>
      <Button type="submit" tone="dark">
        {submitLabel}
      </Button>
    </form>
  );
}

function OptionRow({
  id,
  active,
  header,
  onHover,
  onChoose,
  children,
}: {
  id: string;
  active: boolean;
  header: ReactNode;
  onHover: () => void;
  onChoose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <>
      {header}
      <li
        ref={ref}
        id={id}
        role="option"
        aria-selected={active}
        onMouseMove={onHover}
        onClick={onChoose}
        className={clsx(
          'flex cursor-pointer items-center gap-3 rounded-[18px] px-2.5 py-2 transition-colors',
          active ? 'bg-sunken' : 'hover:bg-black/[0.03]',
        )}
      >
        {children}
      </li>
    </>
  );
}

function SuggestionContent({ s, query }: { s: SearchSuggestionDTO; query: string }) {
  return (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lime/60">
        <CategoryIcon id={s.category} className="size-4 text-ink" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] text-ink-2">
          <Highlight text={sentence(s.term)} query={query} />
        </span>
        <span className="block truncate text-[12px] text-muted">
          {s.offerCount} tilbud · {s.storeCount} {s.storeCount === 1 ? 'kæde' : 'kæder'}
        </span>
      </span>
      {s.fromUnitPrice != null && s.unit && (
        <span className="shrink-0 text-right leading-tight">
          <span className="block text-[10.5px] text-faint">fra</span>
          <span className="tabular block text-[13.5px] text-ink">
            {kr(s.fromUnitPrice)} <span className="text-[11px] text-muted">{unitPriceLabel(s.unit)}</span>
          </span>
        </span>
      )}
    </>
  );
}
