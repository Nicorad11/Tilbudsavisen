import type { MealPlanDTO, RecipeDTO } from '@tilbudsradar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChefHat, ChevronDown, ListPlus, Minus, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useOpenOffer } from '../components/OfferCard';
import { DotNumber } from '../components/ui/DotNumber';
import { Button, Card, Chip, EmptyState, IconButton, Pill, Skeleton, TextInput } from '../components/ui/primitives';
import { authed } from '../lib/api';
import { formatDay, kr } from '../lib/format';
import { useCreateMealPlan, useMealPlans } from '../lib/hooks';
import { usePrefs, useUi } from '../lib/store';

const PREFS = ['Vegetar', 'Pescetar', 'Glutenfri', 'Laktosefri', 'Børnevenlig', 'Hurtig hverdagsmad', 'Højt proteinindhold'];
const DAYS = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

export function MealPlan() {
  const plans = useMealPlans();
  const create = useCreateMealPlan();
  const toast = useUi((s) => s.showToast);
  const [household, setHousehold] = useState(2);
  const [days, setDays] = useState(5);
  const [budget, setBudget] = useState('');
  const [prefs, setPrefs] = useState<string[]>([]);
  const [allergies, setAllergies] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const plan = create.data ?? plans.data?.find((p) => p.id === selectedId) ?? plans.data?.[0] ?? null;

  const submit = () => {
    create.mutate(
      {
        householdSize: household,
        days,
        budget: budget ? Number(budget.replace(',', '.')) : null,
        preferences: prefs,
        allergies: allergies
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
      },
      {
        onSuccess: (p) => setSelectedId(p.id),
        onError: (e) => toast(e instanceof Error ? e.message : 'Madplanen kunne ikke laves', 'error'),
      },
    );
  };

  return (
    <div className="space-y-5 pt-2 lg:pt-4">
      <div>
        <p className="text-sm text-muted">Aftensmad bygget på ugens tilbud</p>
        <h1 className="mt-1 text-[36px] leading-[1.05] tracking-[-0.045em] sm:text-[48px]">Madplan</h1>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="space-y-5 p-5 sm:p-6 xl:sticky xl:top-20">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-2">Personer</span>
            <Stepper value={household} min={1} max={12} onChange={setHousehold} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-2">Antal dage</span>
            <Stepper value={days} min={1} max={7} onChange={setDays} />
          </div>
          <label className="block">
            <span className="text-sm text-ink-2">Budget for ugen (valgfrit)</span>
            <TextInput
              className="mt-2"
              inputMode="decimal"
              placeholder="fx 450"
              value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/[^\d,.]/g, ''))}
              icon={<span className="text-xs">kr</span>}
            />
          </label>
          <div>
            <span className="text-sm text-ink-2">Præferencer</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {PREFS.map((p) => (
                <Chip
                  key={p}
                  active={prefs.includes(p)}
                  onClick={() => setPrefs((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))}
                >
                  {p}
                </Chip>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-sm text-ink-2">Allergier / undgå (kommasepareret)</span>
            <TextInput className="mt-2" placeholder="fx nødder, rejer" value={allergies} onChange={(e) => setAllergies(e.target.value)} />
          </label>
          <Button tone="dark" size="lg" className="w-full" icon={<Wand2 className="size-4" />} loading={create.isPending} onClick={submit}>
            {create.isPending ? 'Planlægger ugen…' : 'Lav madplan'}
          </Button>
          <p className="text-[11px] leading-snug text-muted">
            Med en Anthropic API-nøgle laver Claude planen ud fra ugens tilbud. Uden nøgle bruges en regelbaseret plan.
          </p>

          {(plans.data?.length ?? 0) > 1 && (
            <div className="border-t border-line/70 pt-4">
              <p className="mb-2 text-xs text-muted">Tidligere planer</p>
              <div className="flex flex-wrap gap-2">
                {plans.data!.map((p) => (
                  <Chip key={p.id} active={plan?.id === p.id} onClick={() => { create.reset(); setSelectedId(p.id); }}>
                    {formatDay(p.createdAt)}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </Card>

        <div className="min-w-0">
          {create.isPending ? (
            <Generating />
          ) : plans.isLoading ? (
            <Skeleton className="h-96 rounded-[30px]" />
          ) : plan ? (
            <PlanView plan={plan} onDeleted={() => { create.reset(); setSelectedId(null); }} />
          ) : (
            <Card>
              <EmptyState icon={<ChefHat className="size-6" />} title="Ingen madplan endnu">
                Vælg husstand, budget og præferencer – så foreslår vi retter, der bruger det, der er billigt i denne uge.
              </EmptyState>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-black/[0.04] p-1">
      <IconButton label="Færre" size="sm" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus className="size-3.5" />
      </IconButton>
      <span className="tabular w-8 text-center text-lg">{value}</span>
      <IconButton label="Flere" size="sm" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="size-3.5" />
      </IconButton>
    </div>
  );
}

function Generating() {
  return (
    <div className="grad-card grad-orange grid min-h-[340px] place-items-center p-8 text-center">
      <div>
        <div className="mx-auto flex justify-center gap-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="size-2.5 animate-pulse-soft rounded-full bg-white" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
        <p className="mt-5 text-2xl tracking-tight">Planlægger ugens aftensmad</p>
        <p className="mt-1 text-sm text-white/85">Vi kigger ugens tilbud igennem og matcher dem med retter.</p>
      </div>
    </div>
  );
}

function PlanView({ plan, onDeleted }: { plan: MealPlanDTO; onDeleted: () => void }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const navigate = useNavigate();
  const { setActiveList } = usePrefs();
  const linked = plan.recipes.flatMap((r) => r.ingredients).filter((i) => i.offerId !== null);
  const saved = linked.reduce((s, i) => s + (i.price ?? 0), 0);

  const toList = useMutation({
    mutationFn: async () => {
      const list = await authed<{ id: number }>('/lists', {
        method: 'POST',
        body: { name: `Madplan ${formatDay(plan.createdAt)}` },
      });
      const unique = [...new Map(plan.recipes.flatMap((r) => r.ingredients).filter((i) => i.offerId !== null || !/efter (smag|behov)/.test(i.amount)).map((i) => [i.name.toLowerCase(), i])).values()];
      for (const i of unique) await authed(`/lists/${list.id}/items`, { method: 'POST', body: { text: i.name.slice(0, 120) } });
      return list.id;
    },
    onSuccess: (id) => {
      setActiveList(id);
      void qc.invalidateQueries({ queryKey: ['lists'] });
      toast('Ingredienserne er lagt på en ny indkøbsliste');
      navigate('/lister');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Fejl', 'error'),
  });
  const del = useMutation({
    mutationFn: () => authed(`/meal-plans/${plan.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mealplans'] });
      onDeleted();
    },
  });

  return (
    <div className="space-y-4">
      <div className="grad-card grad-orange p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Pill tone="glass" icon={<Sparkles className="size-3" />}>
              {plan.generatedBy === 'ai' ? 'Lavet af Claude' : 'Regelbaseret'}
            </Pill>
            <Pill tone="glass">{plan.householdSize} personer</Pill>
            {plan.preferences.map((p) => (
              <Pill key={p} tone="glass">
                {p}
              </Pill>
            ))}
          </div>
          <IconButton label="Slet madplan" size="sm" tone="glass" onClick={() => del.mutate()}>
            <Trash2 className="size-4" />
          </IconButton>
        </div>
        <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <p className="text-sm text-white/85">Anslået pris</p>
            <div className="mt-1 flex items-end gap-2">
              <DotNumber value={Math.round(plan.totalCost)} height={50} />
              <span className="pb-1 text-sm">kr</span>
            </div>
            {plan.budget && <p className="mt-1 text-xs text-white/80">budget {kr(plan.budget)} kr</p>}
          </div>
          <div>
            <p className="text-sm text-white/85">Tilbudsvarer brugt</p>
            <div className="mt-1 flex items-end gap-2">
              <DotNumber value={linked.length} height={50} />
              <span className="pb-1 text-sm">for {kr(saved)} kr</span>
            </div>
          </div>
        </div>
        <p className="mt-5 max-w-2xl text-[15px] leading-snug">{plan.summary}</p>
        <Button className="mt-5" icon={<ListPlus className="size-4" />} loading={toList.isPending} onClick={() => toList.mutate()}>
          Læg ingredienser på indkøbsliste
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {plan.recipes.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
      </div>
    </div>
  );
}

function RecipeCard({ recipe }: { recipe: RecipeDTO }) {
  const [open, setOpen] = useState(false);
  const openOffer = useOpenOffer();
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <Pill tone="lime">{DAYS[(recipe.day - 1) % 7]}</Pill>
        <span className="tabular text-sm text-ink-2">ca. {kr(recipe.estimatedCost)} kr</span>
      </div>
      <h3 className="mt-3 text-xl leading-tight tracking-[-0.02em]">{recipe.title}</h3>
      <p className="mt-1 text-sm text-muted">{recipe.description}</p>
      <ul className="mt-4 space-y-1">
        {recipe.ingredients.map((i, idx) => (
          <li key={idx} className="flex items-center justify-between gap-3 text-[13px]">
            {i.offerId ? (
              <button type="button" onClick={() => openOffer(i.offerId!)} className="flex min-w-0 items-center gap-2 text-left text-ink hover:underline">
                <span className="size-1.5 shrink-0 rounded-full bg-lime-deep" />
                <span className="truncate">{i.name}</span>
              </button>
            ) : (
              <span className="flex min-w-0 items-center gap-2 text-ink-2">
                <span className="size-1.5 shrink-0 rounded-full bg-ink/15" />
                <span className="truncate">{i.name}</span>
              </span>
            )}
            <span className="shrink-0 text-muted">
              {i.amount}
              {i.price != null && (
                <span className="tabular ml-2 text-ink">
                  {kr(i.price)} kr <span className="text-faint">{i.storeName}</span>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-4 flex items-center gap-1 self-start text-[13px] text-ink-2 hover:text-ink"
        aria-expanded={open}
      >
        Fremgangsmåde <ChevronDown className={clsx('size-4 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
          {recipe.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </Card>
  );
}
