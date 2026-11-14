import { create } from 'zustand';

/** Counted quantities survive leaving the stock-count screen until they are posted. */
interface CountState {
  locationId: number | null;
  counted: Record<number, number>;
  setLocation: (id: number) => void;
  set: (partId: number, value: number | null) => void;
  clear: () => void;
}

export const useCount = create<CountState>()((set) => ({
  locationId: null,
  counted: {},
  setLocation: (id) => set({ locationId: id, counted: {} }),
  set: (partId, value) =>
    set((s) => {
      const next = { ...s.counted };
      if (value === null) delete next[partId];
      else next[partId] = value;
      return { counted: next };
    }),
  clear: () => set({ counted: {} }),
}));
