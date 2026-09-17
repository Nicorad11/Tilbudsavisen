import type { CategoryId } from '@tilbudsradar/shared';
import {
  Apple,
  Baby,
  Beef,
  Candy,
  Croissant,
  CupSoda,
  Hammer,
  LayoutGrid,
  Milk,
  MonitorSmartphone,
  PawPrint,
  Shapes,
  Shirt,
  Snowflake,
  Sparkles,
  SprayCan,
  Wheat,
  type LucideIcon,
} from 'lucide-react';

export const CATEGORY_ICONS: Record<CategoryId | 'alle', LucideIcon> = {
  alle: LayoutGrid,
  'kod-fisk': Beef,
  mejeri: Milk,
  'frugt-gront': Apple,
  brod: Croissant,
  frost: Snowflake,
  kolonial: Wheat,
  drikkevarer: CupSoda,
  snacks: Candy,
  husholdning: SprayCan,
  pleje: Sparkles,
  baby: Baby,
  dyr: PawPrint,
  elektronik: MonitorSmartphone,
  'bolig-have': Hammer,
  tekstil: Shirt,
  andet: Shapes,
};

export function CategoryIcon({ id, className }: { id: string; className?: string }) {
  const Icon = CATEGORY_ICONS[id as CategoryId] ?? Shapes;
  return <Icon className={className} strokeWidth={1.5} />;
}
