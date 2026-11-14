import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import type { Lang, PublicInfo, User } from '@/types';

export interface Server {
  /** e.g. https://trimurtiauto.in (no trailing slash) */
  base: string;
  /** pretty = /api/path ; query = /api/index.php?r=/path (hosts without mod_rewrite) */
  mode: 'pretty' | 'query';
}

interface SessionState {
  ready: boolean;
  server: Server | null;
  info: PublicInfo | null;
  token: string | null;
  user: User | null;
  canSeeCost: boolean;
  lang: Lang;
  hydrate: () => Promise<void>;
  setServer: (server: Server, info: PublicInfo) => Promise<void>;
  setInfo: (info: PublicInfo) => void;
  setAuth: (token: string, user: User) => Promise<void>;
  setUser: (user: User, canSeeCost?: boolean) => void;
  setLang: (lang: Lang) => Promise<void>;
  logout: () => Promise<void>;
  forgetServer: () => Promise<void>;
}

const K = { server: 'gm_server', token: 'gm_token', lang: 'gm_lang' };

export const useSession = create<SessionState>()((set) => ({
  ready: false,
  server: null,
  info: null,
  token: null,
  user: null,
  canSeeCost: false,
  lang: 'mr',

  hydrate: async () => {
    const [server, token, lang] = await Promise.all([
      SecureStore.getItemAsync(K.server),
      SecureStore.getItemAsync(K.token),
      SecureStore.getItemAsync(K.lang),
    ]);
    let parsed: Server | null = null;
    try {
      parsed = server ? (JSON.parse(server) as Server) : null;
    } catch {
      parsed = null;
    }
    set({ server: parsed, token, lang: lang === 'en' ? 'en' : 'mr', ready: true });
  },

  setServer: async (server, info) => {
    await SecureStore.setItemAsync(K.server, JSON.stringify(server));
    set({ server, info });
  },

  setInfo: (info) => set({ info }),

  setAuth: async (token, user) => {
    await SecureStore.setItemAsync(K.token, token);
    await SecureStore.setItemAsync(K.lang, user.language);
    set({ token, user, lang: user.language });
  },

  setUser: (user, canSeeCost) =>
    set((s) => ({ user, canSeeCost: canSeeCost ?? s.canSeeCost, lang: user.language })),

  setLang: async (lang) => {
    await SecureStore.setItemAsync(K.lang, lang);
    set((s) => ({ lang, user: s.user ? { ...s.user, language: lang } : s.user }));
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(K.token);
    set({ token: null, user: null, canSeeCost: false });
  },

  forgetServer: async () => {
    await Promise.all([SecureStore.deleteItemAsync(K.server), SecureStore.deleteItemAsync(K.token)]);
    set({ server: null, info: null, token: null, user: null, canSeeCost: false });
  },
}));

export const hasRole = (user: User | null, ...roles: User['role'][]) => !!user && roles.includes(user.role);
