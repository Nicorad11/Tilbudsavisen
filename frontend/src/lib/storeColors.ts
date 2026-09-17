/**
 * Faste identitetsfarver pr. kæde – samme farve overalt (prikker, grafer,
 * tidslinje). Valideret som kategorisk palet mod lys flade (#f6f6f5) med
 * dataviz-validatoren, alle par: normalsyn ΔE ≥ 15,6, CVD ΔE ≥ 6,9.
 * CVD ligger i 6-8-båndet og gul/aqua er under 3:1 kontrast, så kædenavnet
 * står altid ved siden af farven (legend, direkte labels, tooltip).
 *
 * POWER deler ikke varer med dagligvarekæderne og vises i neutral grå.
 */
const STORE_COLORS: Record<string, string> = {
  rema1000: '#2a78d6',
  netto: '#eda100',
  foetex: '#4a3aa7',
  bilka: '#1baf7a',
  lidl: '#e34948',
  jemogfix: '#008300',
  power: '#6f6f6d',
};

export function storeColor(id: string, fallback = '#8a8a88'): string {
  return STORE_COLORS[id] ?? fallback;
}
