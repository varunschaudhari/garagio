import { create } from 'zustand';

/** Hands a scanned code from the camera screen back to the screen that asked for it. */
interface ScanState {
  code: string | null;
  seq: number;
  put: (code: string) => void;
  take: () => string | null;
}

export const useScan = create<ScanState>()((set, get) => ({
  code: null,
  seq: 0,
  put: (code) => set((s) => ({ code, seq: s.seq + 1 })),
  take: () => {
    const c = get().code;
    set({ code: null });
    return c;
  },
}));

/** "RACK|2|G1" → { locationId: 2, rack: "G1" } */
export function parseRackCode(code: string): { locationId: number; rack: string } | null {
  const m = /^RACK\|(\d+)\|(.+)$/.exec(code.trim());
  return m ? { locationId: Number(m[1]), rack: m[2] } : null;
}
