import type { PaidFeature, UserDTO } from '@tilbudsradar/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/* Auth – access token holdes kun i hukommelsen; refresh token ligger i en httpOnly-cookie. */
interface AuthState {
  accessToken: string | null;
  user: UserDTO | null;
  /** Sessionen er forsøgt gendannet ved opstart. */
  checked: boolean;
  setAuth: (token: string, user: UserDTO) => void;
  setUser: (user: UserDTO) => void;
  clear: () => void;
  markChecked: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  checked: false,
  setAuth: (accessToken, user) => set({ accessToken, user, checked: true }),
  setUser: (user) => set({ user }),
  clear: () => set({ accessToken: null, user: null }),
  markChecked: () => set({ checked: true }),
}));

/* Brugerens lokale præferencer (kun bekvemmelighed – kan altid mangle). */
export type LocationPref =
  | { mode: 'none' }
  | { mode: 'zip'; zip: string; radiusKm: number }
  | { mode: 'gps'; lat: number; lng: number; radiusKm: number };

interface PrefsState {
  location: LocationPref;
  activeListId: number | null;
  setLocation: (l: LocationPref) => void;
  setActiveList: (id: number | null) => void;
}

const safeStorage = createJSONStorage(() => {
  try {
    const k = '__tr_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => void mem.set(key, value),
      removeItem: (key: string) => void mem.delete(key),
    };
  }
});

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      location: { mode: 'none' },
      activeListId: null,
      setLocation: (location) => set({ location }),
      setActiveList: (activeListId) => set({ activeListId }),
    }),
    { name: 'tilbudsradar:prefs', storage: safeStorage, version: 1 },
  ),
);

export function locationParams(l: LocationPref): Record<string, string> {
  if (l.mode === 'zip') return { zip: l.zip, radius: String(l.radiusKm) };
  if (l.mode === 'gps') return { lat: l.lat.toFixed(4), lng: l.lng.toFixed(4), radius: String(l.radiusKm) };
  return {};
}

/* UI-tilstand */
interface UiState {
  toast: { id: number; text: string; tone: 'ok' | 'error' } | null;
  showToast: (text: string, tone?: 'ok' | 'error') => void;
  /** Betalingsmuren som dialog – `null` = lukket, 'any' = uden en bestemt funktion. */
  paywall: PaidFeature | 'any' | null;
  openPaywall: (feature?: PaidFeature) => void;
  closePaywall: () => void;
}

export const useUi = create<UiState>((set) => ({
  paywall: null,
  openPaywall: (feature) => set({ paywall: feature ?? 'any' }),
  closePaywall: () => set({ paywall: null }),
  toast: null,
  showToast: (text, tone = 'ok') => {
    const id = Date.now();
    set({ toast: { id, text, tone } });
    setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), 3200);
  },
}));
