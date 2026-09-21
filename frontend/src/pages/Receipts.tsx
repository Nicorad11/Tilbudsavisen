import type {
  OfferDTO,
  ParsedReceipt,
  ReceiptCheckDTO,
  ReceiptItemCheck,
  ReceiptLine,
  ReceiptLineKind,
  ReceiptSource,
  ReceiptVerdict,
} from '@tilbudsradar/shared';
import { sumLines } from '@tilbudsradar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  ClipboardPaste,
  ImageUp,
  Plus,
  ReceiptText,
  ScanSearch,
  ShieldCheck,
  Smartphone,
  Store,
  Trash2,
  TrendingDown,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ProductImage, useOpenOffer } from '../components/OfferCard';
import { DotNumber } from '../components/ui/DotNumber';
import { Button, Card, EmptyState, IconButton, Pill, SectionHeader, Skeleton, StoreDot } from '../components/ui/primitives';
import { authed } from '../lib/api';
import { formatDay, formatTime, kr, validityLabel } from '../lib/format';
import { useReceipt, useReceipts, useStores } from '../lib/hooks';
import { useAuth, useUi } from '../lib/store';
import { storeColor } from '../lib/storeColors';

type PillTone = NonNullable<ComponentProps<typeof Pill>['tone']>;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function Receipts() {
  const { id } = useParams();
  return id ? <ReceiptResult id={Number(id)} /> : <ReceiptHome />;
}

/* ------------------------------------------------------------------ */
/* Scan                                                               */
/* ------------------------------------------------------------------ */

type Stage =
  | { kind: 'capture' }
  | { kind: 'reading'; preview: string | null }
  | { kind: 'review'; draft: Draft; preview: string | null };

interface DraftLine extends ReceiptLine {
  key: number;
}

interface Draft {
  storeId: string | null;
  purchasedAt: string | null;
  total: number | null;
  lines: DraftLine[];
  source: ReceiptSource;
  dateMissing: boolean;
}

let nextKey = 1;
const withKey = (l: ReceiptLine): DraftLine => ({ ...l, key: nextKey++ });

function toDraft(p: ParsedReceipt): Draft {
  return {
    storeId: p.storeId,
    // De fleste scanner kvitteringen samme dag – tidspunktet kan rettes.
    purchasedAt: p.purchasedAt ?? new Date().toISOString(),
    total: p.total,
    lines: p.lines.map(withKey),
    source: p.source,
    dateMissing: !p.purchasedAt,
  };
}

/** Telefonbilleder skaleres ned og vendes rigtigt før upload; HEIC bliver til JPEG i Safari. */
async function prepareImage(file: File): Promise<Blob> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('Vælg et billede af kvitteringen.');
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 4_000_000 && /jpe?g|png/i.test(file.type)) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Billedet kunne ikke behandles.'))), 'image/jpeg', 0.9),
    );
  } catch {
    return file; // serveren klarer selv orientering og format
  }
}

function ReceiptHome() {
  const [stage, setStage] = useState<Stage>({ kind: 'capture' });
  const toast = useUi((s) => s.showToast);
  const preview = stage.kind === 'capture' ? null : stage.preview;

  // Frigiv forhåndsvisningen når den ikke bruges mere.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const fail = (e: unknown) => {
    toast(e instanceof Error ? e.message : 'Kvitteringen kunne ikke læses', 'error');
    setStage({ kind: 'capture' });
  };

  const scan = useMutation({
    mutationFn: async (file: File) => authed<ParsedReceipt>('/receipts/scan', { method: 'POST', body: await prepareImage(file) }),
    onError: fail,
  });
  const parseText = useMutation({
    mutationFn: (text: string) => authed<ParsedReceipt>('/receipts/parse-text', { method: 'POST', body: { text } }),
    onError: fail,
  });

  const onFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setStage({ kind: 'reading', preview: url });
    scan.mutate(file, { onSuccess: (p) => setStage({ kind: 'review', draft: toDraft(p), preview: url }) });
  };
  const onText = (text: string) => {
    setStage({ kind: 'reading', preview: null });
    parseText.mutate(text, { onSuccess: (p) => setStage({ kind: 'review', draft: toDraft(p), preview: null }) });
  };
  const onManual = () =>
    setStage({
      kind: 'review',
      preview: null,
      draft: toDraft({ storeId: null, purchasedAt: null, total: null, lines: [], source: 'manual', warnings: [] }),
    });

  return (
    <div className="space-y-8 pt-2 lg:pt-4">
      <div>
        <p className="text-sm text-muted">Se hvad du sparede – og om kassen slog rigtigt</p>
        <h1 className="mt-1 text-[36px] leading-[1.05] tracking-[-0.045em] sm:text-[48px]">Kvitteringer</h1>
      </div>

      {stage.kind === 'capture' && <Capture onFile={onFile} onText={onText} onManual={onManual} />}
      {stage.kind === 'reading' && <Reading preview={stage.preview} />}
      {stage.kind === 'review' && (
        <Review
          initial={stage.draft}
          preview={stage.preview}
          onCancel={() => setStage({ kind: 'capture' })}
        />
      )}

      {stage.kind === 'capture' && <History />}
    </div>
  );
}

function Capture({ onFile, onText, onManual }: { onFile: (f: File) => void; onText: (t: string) => void; onManual: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files);
        }}
        className={clsx(
          'relative flex min-h-[300px] flex-col justify-between overflow-hidden rounded-[30px] bg-raised p-6 shadow-soft ring-2 transition sm:p-8',
          dragging ? 'ring-ink' : 'ring-transparent',
        )}
      >
        <div className="max-w-md">
          <span className="grid size-12 place-items-center rounded-full bg-lime">
            <ReceiptText className="size-6" strokeWidth={1.6} />
          </span>
          <h2 className="mt-4 text-[26px] leading-tight tracking-[-0.03em] text-ink">Scan din kvittering</h2>
          <p className="mt-2 text-[15px] leading-snug text-muted">
            Vi læser linjerne, finder kædens avis på købsdagen og viser hvad du sparede – og om en vare blev slået forkert ind.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => pick(e.target.files)}
          />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files)} />
          <Button tone="dark" size="lg" icon={<Camera className="size-5" />} className="md:hidden" onClick={() => cameraRef.current?.click()}>
            Tag billede
          </Button>
          <Button size="lg" icon={<ImageUp className="size-5" />} onClick={() => fileRef.current?.click()}>
            Vælg billede
          </Button>
          <span className="hidden text-[13px] text-faint md:inline">eller træk billedet herind</span>
        </div>

        <ReceiptIllustration />
      </div>

      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised shadow-pill">
              <ClipboardPaste className="size-[18px]" strokeWidth={1.6} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] text-ink">E-kvittering?</p>
              <p className="mt-0.5 text-[13px] leading-snug text-muted">Kopiér teksten fra kædens app eller mail og indsæt den her.</p>
            </div>
          </div>
          {pasting ? (
            <form
              className="mt-4 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) onText(text);
              }}
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={7}
                autoFocus
                placeholder={'Løg 1kg      12,00 x 2   24,00\nRabat                    -4,00\n…'}
                className="w-full resize-y rounded-2xl bg-raised p-3 font-mono text-[12.5px] text-ink shadow-pill outline-none placeholder:text-faint focus:ring-2 focus:ring-ink/80"
              />
              <div className="flex gap-2">
                <Button type="submit" tone="dark" size="sm" disabled={!text.trim()}>
                  Læs teksten
                </Button>
                <Button size="sm" tone="ghost" onClick={() => setPasting(false)}>
                  Annullér
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" className="mt-4" onClick={() => setPasting(true)}>
              Indsæt tekst
            </Button>
          )}
        </Card>

        <Card className="flex-1 p-5">
          <p className="text-[15px] text-ink">Sådan tjekker vi</p>
          <ul className="mt-3 space-y-2.5 text-[13px] leading-snug text-muted">
            <Step icon={<Check className="size-3.5" />}>Hver vare sammenlignes med kædens avis på købsdagen.</Step>
            <Step icon={<AlertTriangle className="size-3.5" />}>Betalte du mere end avisprisen, markeres det som en mulig fejl.</Step>
            <Step icon={<Store className="size-3.5" />}>Vi viser også, hvis samme vare var billigere i en anden kæde.</Step>
            <Step icon={<ShieldCheck className="size-3.5" />}>Billedet gemmes ikke – kun linjerne, så du kan se kvitteringen igen.</Step>
          </ul>
          <button type="button" onClick={onManual} className="mt-4 text-[13px] text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
            Skriv linjerne selv
          </button>
        </Card>
      </div>
    </section>
  );
}

function Step({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-black/[0.05] text-ink-2">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

/** Lille bon med prikker og en lime pris – samme sprog som papirerne på forsiden. */
function ReceiptIllustration() {
  return (
    <div aria-hidden className="pointer-events-none absolute -right-6 -bottom-10 hidden w-44 rotate-[8deg] sm:block">
      <div className="rounded-t-lg bg-white px-4 pt-4 pb-6 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.35)]">
        <div className="mx-auto h-1.5 w-12 rounded bg-ink/70" />
        <div className="mt-3 space-y-2">
          {[70, 52, 64, 40, 58].map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="h-[3px] rounded bg-ink/15" style={{ width: `${w}%` }} />
              <span className={clsx('h-[3px] w-6 rounded', i === 2 ? 'bg-lime-deep' : 'bg-ink/25')} />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-dashed border-ink/20 pt-2">
          <span className="h-1 w-8 rounded bg-ink/40" />
          <span className="rounded-full bg-lime px-1.5 text-[8px] font-semibold text-ink">−86,95</span>
        </div>
      </div>
      <div className="h-3 bg-[radial-gradient(circle_at_6px_0,transparent_6px,white_6.5px)] bg-[length:12px_12px]" />
    </div>
  );
}

function Reading({ preview }: { preview: string | null }) {
  return (
    <section className="flex flex-col items-center gap-5 rounded-[30px] bg-raised px-6 py-10 shadow-soft">
      {preview && (
        <div className="relative h-72 w-52 overflow-hidden rounded-2xl bg-sunken shadow-pill">
          <img src={preview} alt="" className="size-full object-cover opacity-80" />
          <div className="absolute inset-x-0 h-0.5 bg-lime shadow-[0_0_18px_4px_rgba(226,243,59,0.8)] animate-[receipt-scan_2.2s_ease-in-out_infinite] motion-reduce:animate-none" />
        </div>
      )}
      <div className="text-center">
        <p className="text-lg tracking-tight text-ink">Læser kvitteringen …</p>
        <p className="mt-1 text-[13px] text-muted">Det tager typisk 5–30 sekunder. Billedet gemmes ikke.</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Gennemsyn                                                          */
/* ------------------------------------------------------------------ */

const SOURCE_LABEL: Record<ReceiptSource, string> = {
  claude: 'Læst af Claude',
  ocr: 'Læst med tekstgenkendelse',
  text: 'Indsat tekst',
  manual: 'Skrevet selv',
};

const fmtNum = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');
function parseNum(text: string): number | null {
  const t = text.replace(/\s/g, '').replace(/kr\.?$/i, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Tal med dansk komma. Teksten må være ufærdig mens man skriver; tallet sættes ved blur. */
function NumberField({
  value,
  onChange,
  digits = 2,
  label,
  className,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  digits?: number;
  label: string;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value == null ? '' : fmtNum(value, digits));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value == null ? '' : fmtNum(value, digits));
  }, [value, digits, focused]);
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      title={label}
      value={text}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const n = parseNum(text);
        if (n !== null || !text.trim()) onChange(n);
        else setText(value == null ? '' : fmtNum(value, digits));
      }}
      className={clsx(
        'tabular h-9 rounded-xl bg-raised px-2.5 text-right text-[13.5px] text-ink shadow-pill outline-none focus:ring-2 focus:ring-ink/80',
        className,
      )}
    />
  );
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const KIND_LABEL: Record<ReceiptLineKind, string> = { item: 'Vare', discount: 'Rabat', deposit: 'Pant' };

function Review({ initial, preview, onCancel }: { initial: Draft; preview: string | null; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const stores = useStores();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);

  const setLine = (key: number, patch: Partial<ReceiptLine>) =>
    setDraft((d) => ({
      ...d,
      // Rettes en usikker linje, regnes den som kontrolleret.
      lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch, uncertain: false } : l)),
    }));
  const removeLine = (key: number) => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.key !== key) }));
  const addLine = () =>
    setDraft((d) => ({
      ...d,
      lines: [...d.lines, withKey({ kind: 'item', name: '', quantity: 1, unit: 'stk', unitPrice: null, amount: 0 })],
    }));

  const lines = draft.lines.filter((l) => l.name.trim());
  const linesTotal = sumLines(lines);
  const itemCount = lines.filter((l) => l.kind === 'item').length;
  const uncertain = draft.lines.filter((l) => l.uncertain).length;
  const totalOk = draft.total != null && Math.abs(draft.total - linesTotal) <= 0.05;

  const save = useMutation({
    mutationFn: () =>
      authed<ReceiptCheckDTO>('/receipts', {
        method: 'POST',
        body: {
          storeId: draft.storeId,
          purchasedAt: draft.purchasedAt,
          total: draft.total,
          source: draft.source,
          lines: lines.map(({ key: _key, ...l }) => ({
            ...l,
            name: l.name.trim(),
            amount: l.kind === 'discount' ? -Math.abs(l.amount) : l.amount,
            quantity: l.quantity > 0 ? l.quantity : 1,
            unitPrice: l.kind === 'item' ? r2(l.amount / (l.quantity > 0 ? l.quantity : 1)) : null,
          })),
        },
      }),
    onSuccess: (check) => {
      qc.setQueryData(['receipt', check.id], check);
      void qc.invalidateQueries({ queryKey: ['receipts'] });
      navigate(`/kvitteringer/${check.id}`);
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Kvitteringen kunne ikke gemmes', 'error'),
  });

  return (
    <section className={clsx('grid gap-5', preview && 'lg:grid-cols-[280px_minmax(0,1fr)]')}>
      {preview && (
        <div className="hidden lg:block">
          <div className="sticky top-24 overflow-hidden rounded-[26px] bg-sunken shadow-soft">
            <img src={preview} alt="Din kvittering" className="max-h-[75vh] w-full object-contain" />
          </div>
        </div>
      )}

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeader title="Tjek linjerne" subtitle="Ret det der er læst forkert – så bliver tjekket mod avisen præcist." />
          <Pill tone="ghost">{SOURCE_LABEL[draft.source]}</Pill>
        </div>

        <Card className="grid gap-3 p-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-[12px] text-muted">Kæde</span>
            <select
              value={draft.storeId ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, storeId: e.target.value || null }))}
              className={clsx(
                'mt-1 h-10 w-full rounded-xl bg-raised px-3 text-[14px] text-ink shadow-pill outline-none focus:ring-2 focus:ring-ink/80',
                !draft.storeId && 'ring-2 ring-warn/60',
              )}
            >
              <option value="">Vælg kæde …</option>
              {stores.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] text-muted">Købt {draft.dateMissing && <span className="text-warn">– kunne ikke læses, tjek</span>}</span>
            <input
              type="datetime-local"
              value={toLocalInput(draft.purchasedAt)}
              onChange={(e) =>
                setDraft((d) => ({ ...d, dateMissing: false, purchasedAt: e.target.value ? new Date(e.target.value).toISOString() : null }))
              }
              className={clsx(
                'mt-1 h-10 w-full rounded-xl bg-raised px-3 text-[14px] text-ink shadow-pill outline-none focus:ring-2 focus:ring-ink/80',
                draft.dateMissing && 'ring-2 ring-warn/60',
              )}
            />
          </label>
          <label className="block">
            <span className="text-[12px] text-muted">Total på kvitteringen (SUM)</span>
            <NumberField
              label="Total på kvitteringen"
              value={draft.total}
              onChange={(v) => setDraft((d) => ({ ...d, total: v }))}
              placeholder="fx 973,15"
              className={clsx('mt-1 !h-10 w-full', draft.total == null && 'ring-2 ring-warn/60')}
            />
          </label>
        </Card>

        <SumBanner linesTotal={linesTotal} total={draft.total} uncertain={uncertain} />

        <Card className="p-2 sm:p-3">
          <ul className="divide-y divide-black/[0.05]">
            {draft.lines.map((l) => (
              <LineRow key={l.key} line={l} onChange={(patch) => setLine(l.key, patch)} onRemove={() => removeLine(l.key)} />
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 px-2 pt-3 pb-1">
            <Button size="sm" icon={<Plus className="size-4" />} onClick={addLine}>
              Tilføj linje
            </Button>
            <span className="tabular text-[13px] text-muted">
              {itemCount} {itemCount === 1 ? 'vare' : 'varer'} · {kr(linesTotal)} kr
            </span>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button tone="dark" size="lg" loading={save.isPending} disabled={!itemCount} onClick={() => save.mutate()}>
            Tjek mod tilbuddene
          </Button>
          <Button tone="ghost" size="lg" onClick={onCancel}>
            Start forfra
          </Button>
          {!totalOk && draft.total != null && (
            <span className="text-[12.5px] text-muted">Du kan godt tjekke, selvom summen ikke passer helt.</span>
          )}
        </div>
      </div>
    </section>
  );
}

function SumBanner({ linesTotal, total, uncertain }: { linesTotal: number; total: number | null; uncertain: number }) {
  const ok = total != null && Math.abs(total - linesTotal) <= 0.05;
  const tone = total == null ? 'bg-black/[0.04] text-ink-2' : ok ? 'bg-lime/50 text-ink' : 'bg-[#fbe6cf] text-[#6b3a08]';
  return (
    <div className={clsx('flex items-start gap-3 rounded-2xl px-4 py-3 text-[13.5px] leading-snug', tone)} role="status">
      {ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      <p>
        {total == null
          ? `Linjerne giver ${kr(linesTotal)} kr. Skriv totalen fra kvitteringen, så kan vi se om alle linjer er med.`
          : ok
            ? `Linjerne giver ${kr(linesTotal)} kr – det samme som kvitteringen.`
            : `Linjerne giver ${kr(linesTotal)} kr, men kvitteringen siger ${kr(total)} kr (${kr(Math.abs(total - linesTotal))} kr ${
                linesTotal < total ? 'mangler' : 'for meget'
              }). Tjek de markerede linjer.`}
        {uncertain > 0 && ` ${uncertain} ${uncertain === 1 ? 'linje er usikker' : 'linjer er usikre'}.`}
      </p>
    </div>
  );
}

function LineRow({
  line,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  onChange: (patch: Partial<ReceiptLine>) => void;
  onRemove: () => void;
}) {
  const discount = line.kind === 'discount';
  return (
    <li className={clsx('rounded-xl px-2 py-2', line.uncertain && 'bg-[#fbe6cf]/70')}>
      <div className={clsx('flex flex-wrap items-center gap-2', discount && 'sm:pl-6')}>
        <select
          value={line.kind}
          aria-label="Linjetype"
          onChange={(e) => {
            const kind = e.target.value as ReceiptLineKind;
            onChange({ kind, amount: kind === 'discount' ? -Math.abs(line.amount) : Math.abs(line.amount) });
          }}
          className="h-9 w-[76px] shrink-0 rounded-xl bg-transparent px-1.5 text-[12.5px] text-muted outline-none hover:bg-black/[0.04] focus:ring-2 focus:ring-ink/80"
        >
          {(Object.keys(KIND_LABEL) as ReceiptLineKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input
          value={line.name}
          aria-label="Tekst på kvitteringen"
          placeholder="Varens navn"
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-9 min-w-0 flex-1 basis-[160px] rounded-xl bg-raised px-3 text-[13.5px] text-ink shadow-pill outline-none placeholder:text-faint focus:ring-2 focus:ring-ink/80"
        />
        {line.kind === 'item' && (
          <span className="flex items-center gap-1">
            <NumberField
              label={line.unit === 'kg' ? 'Vægt i kg' : 'Antal'}
              value={line.quantity}
              digits={line.unit === 'kg' ? 3 : 0}
              onChange={(v) => onChange({ quantity: v && v > 0 ? v : 1 })}
              className="w-16"
            />
            <select
              value={line.unit}
              aria-label="Enhed"
              onChange={(e) => onChange({ unit: e.target.value as 'stk' | 'kg' })}
              className="h-9 rounded-xl bg-transparent px-1 text-[12.5px] text-muted outline-none hover:bg-black/[0.04] focus:ring-2 focus:ring-ink/80"
            >
              <option value="stk">stk</option>
              <option value="kg">kg</option>
            </select>
          </span>
        )}
        <NumberField
          label="Beløb i kr"
          value={discount ? -Math.abs(line.amount) : line.amount}
          onChange={(v) => onChange({ amount: v ?? 0 })}
          className={clsx('w-24', discount && 'text-[#8a4a0b]')}
        />
        <IconButton label="Fjern linje" size="sm" tone="ghost" onClick={onRemove}>
          <X className="size-4" />
        </IconButton>
      </div>
      {line.uncertain && (
        <p className="mt-1.5 flex items-center gap-1.5 pl-1 text-[12px] text-[#8a4a0b]">
          <AlertTriangle className="size-3.5" /> Usikker aflæsning – sammenlign med kvitteringen.
          <button type="button" onClick={() => onChange({})} className="ml-1 underline underline-offset-2">
            Den er rigtig
          </button>
        </p>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Resultat                                                           */
/* ------------------------------------------------------------------ */

const VERDICT: Record<ReceiptVerdict, { label: string; tone: PillTone; icon: ReactNode }> = {
  match: { label: 'Stemmer', tone: 'real', icon: <Check className="size-3.5" /> },
  cheaper: { label: 'Under avisprisen', tone: 'ok', icon: <TrendingDown className="size-3.5" /> },
  overcharged: { label: 'Mulig fejl', tone: 'bad', icon: <AlertTriangle className="size-3.5" /> },
  app_price: { label: 'Kræver app', tone: 'warn', icon: <Smartphone className="size-3.5" /> },
  check: { label: 'Tjek selv', tone: 'warn', icon: <ScanSearch className="size-3.5" /> },
  no_offer: { label: 'Ikke i avisen', tone: 'ghost', icon: null },
};

function purchasedLabel(iso: string | null): string {
  if (!iso) return 'Ukendt dato';
  return `${formatDay(iso)} kl. ${formatTime(iso)}`;
}

function ReceiptResult({ id }: { id: number }) {
  const { data, isLoading, error } = useReceipt(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);

  const remove = useMutation({
    mutationFn: () => authed<void>(`/receipts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['receipt', id] });
      void qc.invalidateQueries({ queryKey: ['receipts'] });
      toast('Kvitteringen er slettet');
      navigate('/kvitteringer');
    },
  });

  const back = (
    <Link to="/kvitteringer" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
      <ArrowLeft className="size-4" /> Kvitteringer
    </Link>
  );

  if (isLoading) {
    return (
      <div className="space-y-5 pt-4">
        {back}
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[190px] rounded-[26px]" />
          ))}
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="pt-4">
        {back}
        <EmptyState icon={<ReceiptText className="size-6" />} title="Kvitteringen findes ikke" />
      </div>
    );
  }

  const errors = data.items.filter((i) => i.verdict === 'overcharged');
  const toCheck = data.items.filter((i) => i.verdict === 'check' || i.verdict === 'app_price');
  const confirmed = data.items.filter((i) => i.offer && (i.verdict === 'match' || i.verdict === 'cheaper'));
  const elsewhere = data.items.filter((i) => i.cheaperElsewhere);

  return (
    <div className="space-y-8 pt-2 lg:pt-4">
      <div>
        {back}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm text-muted">
              {data.store && <StoreDot color={storeColor(data.store.id)} />}
              {data.store?.name ?? 'Ukendt kæde'} · {purchasedLabel(data.purchasedAt)}
            </p>
            <h1 className="tabular mt-1 text-[36px] leading-[1.05] tracking-[-0.045em] sm:text-[48px]">{kr(data.total)} kr</h1>
          </div>
          <Pill tone="ghost">{SOURCE_LABEL[data.source]}</Pill>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="grad-card grad-green flex min-h-[200px] flex-col p-5">
          <p className="text-sm text-white/85">Du sparede</p>
          <div className="flex flex-1 items-center">
            <DotNumber value={Math.floor(data.saved)} height={52} />
            <span className="ml-2 self-end pb-2 text-[15px] text-white/90">,{kr(data.saved).split(',')[1]} kr</span>
          </div>
          <p className="text-[12.5px] leading-snug text-white/80">
            {data.discountsOnReceipt > 0
              ? `Heraf ${kr(data.discountsOnReceipt)} kr i rabatter trukket på kvitteringen.`
              : 'Ingen rabatter trukket på kvitteringen.'}
          </p>
        </div>

        {errors.length ? (
          <div className="grad-card grad-pink flex min-h-[200px] flex-col p-5">
            <p className="text-sm text-white/85">Mulige fejl</p>
            <div className="flex flex-1 items-center">
              <DotNumber value={errors.length} height={52} />
            </div>
            <p className="text-[12.5px] leading-snug text-white/90">
              Du har muligvis betalt {kr(data.possibleRefund)} kr for meget. Se hvilke varer nedenfor.
            </p>
          </div>
        ) : (
          <Card className="flex min-h-[200px] flex-col p-5">
            <p className="text-sm text-muted">Tjekket mod avisen</p>
            <div className="flex flex-1 items-center gap-3">
              <DotNumber value={data.verifiedOffers} height={52} />
              <span className="grid size-9 place-items-center rounded-full bg-lime">
                <Check className="size-5" />
              </span>
            </div>
            <p className="text-[12.5px] leading-snug text-muted">
              {data.verifiedOffers
                ? `${data.verifiedOffers} ${data.verifiedOffers === 1 ? 'tilbud' : 'tilbud'} fra avisen blev afregnet korrekt. Ingen fejl fundet.`
                : 'Ingen af varerne var på tilbud i avisen – og ingen fejl fundet.'}
            </p>
          </Card>
        )}

        <Card className="flex min-h-[200px] flex-col p-5">
          <p className="text-sm text-muted">Billigere andre steder</p>
          <div className="flex flex-1 items-center">
            {data.cheaperElsewhereTotal > 0 ? (
              <>
                <DotNumber value={Math.floor(data.cheaperElsewhereTotal)} height={52} />
                <span className="ml-2 self-end pb-2 text-[15px] text-ink-2">,{kr(data.cheaperElsewhereTotal).split(',')[1]} kr</span>
              </>
            ) : (
              <span className="text-[40px] leading-none tracking-[-0.04em] text-ink">0 kr</span>
            )}
          </div>
          <p className="text-[12.5px] leading-snug text-muted">
            {data.cheaperElsewhereTotal > 0
              ? `${elsewhere.length} ${elsewhere.length === 1 ? 'vare' : 'varer'} var billigere i en anden kæde samme dag.`
              : 'Ingen af varerne var billigere i de andre kæder samme dag.'}
          </p>
        </Card>
      </section>

      {data.totalMatches === false && (
        <div className="flex items-start gap-3 rounded-2xl bg-[#fbe6cf] px-4 py-3 text-[13.5px] leading-snug text-[#6b3a08]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Linjerne giver {kr(data.linesTotal)} kr, men kvitteringen siger {kr(data.total)} kr – nogle linjer kan mangle eller være
          læst forkert.
        </div>
      )}

      {errors.length > 0 && (
        <ResultSection
          title="Mulige fejl"
          subtitle="Du betalte mere end avisprisen. Vis kvitteringen ved kassen eller kundeservice – de fleste kæder refunderer forskellen."
        >
          {errors.map((i) => (
            <ItemCard key={i.index} item={i} />
          ))}
        </ResultSection>
      )}

      {toCheck.length > 0 && (
        <ResultSection title="Tjek selv" subtitle="Avisen har en pris, vi ikke kan bekræfte – fx en app-pris eller en lignende vare.">
          {toCheck.map((i) => (
            <ItemCard key={i.index} item={i} />
          ))}
        </ResultSection>
      )}

      {confirmed.length > 0 && (
        <ResultSection title="Tilbud der stemte" subtitle="Afregnet til avisprisen eller billigere.">
          {confirmed.map((i) => (
            <ItemCard key={i.index} item={i} compact />
          ))}
        </ResultSection>
      )}

      {elsewhere.length > 0 && (
        <ResultSection title="Billigere andre steder" subtitle="Samme vare, samme dag, i en anden kæde.">
          {elsewhere.map((i) => (
            <ElsewhereCard key={i.index} item={i} />
          ))}
        </ResultSection>
      )}

      <section>
        <SectionHeader title="Alle varer" subtitle={`${data.itemCount} varer${data.deposits ? ` · pant ${kr(data.deposits)} kr` : ''}`} />
        <Card className="mt-4 divide-y divide-black/[0.05] p-2">
          {data.items.map((i) => (
            <AllRow key={i.index} item={i} />
          ))}
        </Card>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link to="/kvitteringer">
          <Button tone="dark" icon={<Camera className="size-4" />}>
            Scan en ny
          </Button>
        </Link>
        <Button
          tone="danger"
          icon={<Trash2 className="size-4" />}
          loading={remove.isPending}
          onClick={() => {
            if (window.confirm('Slet kvitteringen?')) remove.mutate();
          }}
        >
          Slet kvittering
        </Button>
      </div>
    </div>
  );
}

function ResultSection({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section>
      <SectionHeader title={title} subtitle={subtitle} />
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function qtyLabel(i: ReceiptItemCheck): string {
  if (i.unit === 'kg') return `${fmtNum(i.quantity, 3)} kg`;
  return i.quantity > 1 ? `${i.quantity} stk` : '';
}

function ItemCard({ item, compact }: { item: ReceiptItemCheck; compact?: boolean }) {
  const v = VERDICT[item.verdict];
  return (
    <Card className={clsx('flex flex-col gap-3 p-4', item.verdict === 'overcharged' && 'ring-2 ring-bad/30')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] text-ink">{item.name}</p>
          <p className="tabular mt-0.5 text-[12.5px] text-muted">
            {qtyLabel(item) && `${qtyLabel(item)} · `}betalt {kr(item.paid)} kr
            {item.discount > 0 && ` efter ${kr(item.discount)} kr rabat`}
          </p>
        </div>
        <Pill tone={v.tone} icon={v.icon}>
          {v.label}
        </Pill>
      </div>
      {!compact && <p className="text-[13.5px] leading-snug text-ink-2">{item.message}</p>}
      {item.offer && <OfferMini offer={item.offer} note={compact ? item.message : undefined} />}
    </Card>
  );
}

function OfferMini({ offer, note, label = 'I avisen' }: { offer: OfferDTO; note?: string; label?: string }) {
  const open = useOpenOffer();
  const validity = validityLabel(offer.validFrom, offer.validTo);
  return (
    <button
      type="button"
      onClick={() => open(offer.id)}
      className="flex items-center gap-3 rounded-2xl bg-raised p-2 pr-3 text-left shadow-pill transition hover:bg-white"
    >
      <span className="size-12 shrink-0 rounded-xl bg-surface-2 p-1">
        <ProductImage src={offer.imageUrl} category={offer.category} alt="" className="size-full" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-faint">
          {label} · {offer.store.name} · {validity.text}
        </span>
        <span className="block truncate text-[13px] text-ink">{offer.title}</span>
        {note && <span className="block truncate text-[12px] text-muted">{note}</span>}
      </span>
      <span className="tabular shrink-0 text-right text-[14px] text-ink">
        {kr(offer.offerPrice)}
        <span className="block text-[10.5px] text-muted">kr</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </button>
  );
}

function ElsewhereCard({ item }: { item: ReceiptItemCheck }) {
  const other = item.cheaperElsewhere!;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] text-ink">{item.name}</p>
          <p className="tabular mt-0.5 text-[12.5px] text-muted">
            {qtyLabel(item) && `${qtyLabel(item)} · `}betalt {kr(item.paid)} kr
          </p>
        </div>
        <Pill tone="lime">−{kr(other.saving)} kr</Pill>
      </div>
      <OfferMini offer={other.offer} label="Billigere" />
    </Card>
  );
}

function AllRow({ item }: { item: ReceiptItemCheck }) {
  const v = VERDICT[item.verdict];
  return (
    <div className="flex items-center gap-3 px-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-ink">{item.name}</p>
        <p className="text-[12px] text-muted">
          {qtyLabel(item)}
          {item.uncertain && <span className="text-[#8a4a0b]">{qtyLabel(item) ? ' · ' : ''}usikker aflæsning</span>}
        </p>
      </div>
      {item.verdict !== 'no_offer' && (
        <Pill tone={v.tone} icon={v.icon} className="hidden sm:inline-flex">
          {v.label}
        </Pill>
      )}
      {item.saved > 0 && <Pill tone="lime">−{kr(item.saved)}</Pill>}
      <span className="tabular w-20 shrink-0 text-right text-[13.5px] text-ink">{kr(item.paid)} kr</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Historik                                                           */
/* ------------------------------------------------------------------ */

function History() {
  const token = useAuth((s) => s.accessToken);
  const { data, isLoading } = useReceipts(Boolean(token));
  if (!token || (!isLoading && !data?.receipts.length)) return null;

  return (
    <section>
      <SectionHeader
        title="Dine kvitteringer"
        subtitle={
          data
            ? `Sparet i alt ${kr(data.totalSaved)} kr på ${data.receipts.length} ${data.receipts.length === 1 ? 'kvittering' : 'kvitteringer'}`
            : undefined
        }
      />
      <Card className="mt-4 divide-y divide-black/[0.05] p-2">
        {isLoading
          ? [0, 1].map((i) => <Skeleton key={i} className="m-2 h-12" />)
          : data!.receipts.map((r) => (
              <Link key={r.id} to={`/kvitteringer/${r.id}`} className="flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-black/[0.03]">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised shadow-pill">
                  <ReceiptText className="size-[18px]" strokeWidth={1.6} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[14px] text-ink">
                    {r.store && <StoreDot color={storeColor(r.store.id)} />}
                    {r.store?.name ?? 'Ukendt kæde'}
                  </span>
                  <span className="block text-[12px] text-muted">
                    {purchasedLabel(r.purchasedAt ?? r.createdAt)} · {r.itemCount} varer
                  </span>
                </span>
                {r.possibleErrors > 0 && (
                  <Pill tone="bad" icon={<AlertTriangle className="size-3.5" />}>
                    {r.possibleErrors} mulig{r.possibleErrors === 1 ? '' : 'e'} fejl
                  </Pill>
                )}
                {r.saved > 0 && <Pill tone="lime">−{kr(r.saved)}</Pill>}
                <span className="tabular hidden w-24 shrink-0 text-right text-[14px] text-ink sm:block">{kr(r.total)} kr</span>
                <ChevronRight className="size-4 shrink-0 text-faint" />
              </Link>
            ))}
      </Card>
    </section>
  );
}
