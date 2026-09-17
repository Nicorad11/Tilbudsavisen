import clsx from 'clsx';
import { LocateFixed, MapPin, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePrefs } from '../lib/store';
import { Button, Segmented, TextInput } from './ui/primitives';

export function LocationPicker() {
  const { location, setLocation } = usePrefs();
  const [open, setOpen] = useState(false);
  const [zip, setZip] = useState(location.mode === 'zip' ? location.zip : '');
  const [radius, setRadius] = useState(location.mode === 'none' ? 10 : location.radiusKm);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const label =
    location.mode === 'zip'
      ? `${location.zip} · ${location.radiusKm} km`
      : location.mode === 'gps'
        ? `Min position · ${location.radiusKm} km`
        : 'Hele landet';

  const useGps = () => {
    if (!('geolocation' in navigator)) {
      setGpsError('Din browser understøtter ikke geolokation');
      return;
    }
    setLocating(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setLocation({ mode: 'gps', lat: pos.coords.latitude, lng: pos.coords.longitude, radiusKm: radius });
        setOpen(false);
      },
      () => {
        setLocating(false);
        setGpsError('Kunne ikke finde din position – brug postnummer i stedet');
      },
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition',
          location.mode === 'none' ? 'bg-raised text-ink-2 shadow-pill' : 'bg-ink text-white',
        )}
      >
        <MapPin className="size-4" strokeWidth={1.6} />
        {label}
      </button>
      {location.mode !== 'none' && (
        <button
          type="button"
          aria-label="Fjern lokation"
          onClick={() => setLocation({ mode: 'none' })}
          className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-lime text-ink shadow"
        >
          <X className="size-3" />
        </button>
      )}
      {open && (
        <div className="glass absolute right-0 z-40 mt-2 w-[300px] animate-rise rounded-[26px] p-4 max-sm:right-auto max-sm:left-0">
          <p className="text-sm text-ink">Vis kun tilbud fra butikker i nærheden</p>
          <p className="mt-0.5 text-xs text-muted">Kæder uden kendte butikker vises altid.</p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{4}$/.test(zip)) {
                setLocation({ mode: 'zip', zip, radiusKm: radius });
                setOpen(false);
              }
            }}
          >
            <TextInput
              className="h-10 flex-1"
              inputMode="numeric"
              maxLength={4}
              placeholder="Postnummer"
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))}
            />
            <Button type="submit" tone="dark" disabled={!/^\d{4}$/.test(zip)}>
              Brug
            </Button>
          </form>
          <Button className="mt-2 w-full" icon={<LocateFixed className="size-4" />} loading={locating} onClick={useGps}>
            Brug min position
          </Button>
          {gpsError && <p className="mt-2 text-xs text-bad">{gpsError}</p>}
          <p className="mt-4 mb-1.5 text-xs text-muted">Afstand</p>
          <Segmented
            size="sm"
            value={radius}
            onChange={(r) => {
              setRadius(r);
              if (location.mode !== 'none') setLocation({ ...location, radiusKm: r });
            }}
            options={[2, 5, 10, 25, 50].map((r) => ({ value: r, label: `${r} km` }))}
          />
        </div>
      )}
    </div>
  );
}
