import { can } from '@/store/session';
import type { Perm, Role, User } from '@/types';

// Tabs grow with each build phase (mirrors BUILT_PHASE on the web).
export type TabKey = 'home' | 'jobs' | 'newjob' | 'billing' | 'customers' | 'requests' | 'queue' | 'approvals' | 'stock' | 'purchases' | 'money' | 'more' | 'me';

/**
 * Bottom tabs by role (spec "Android app screens by role"). Phase 4 adds Billing for the front desk
 * and Money for the owner.
 */
export const ROLE_TABS: Record<Role, TabKey[]> = {
  owner: ['home', 'approvals', 'jobs', 'money', 'more'],
  inventory: ['queue', 'approvals', 'stock', 'purchases', 'me'],
  front_desk: ['jobs', 'newjob', 'billing', 'customers', 'me'],
  mechanic: ['jobs', 'requests', 'stock', 'me'],
};

/** Tabs that need a permission (the owner can untick it per person). */
export const TAB_PERM: Partial<Record<TabKey, Perm>> = {
  newjob: 'jobs',
  billing: 'make_bills',
  customers: 'customers',
  queue: 'issue_parts',
  approvals: 'issue_parts',
  purchases: 'purchases',
  money: 'see_money',
};

/**
 * Does this person have the tab? A tab they do not have is hidden, and expo-router sends anyone who opens it
 * back to their first tab, so links must use the stand-alone page (/purchase, /customer, /job/new,
 * /parts-requests, /profile, /parts) unless the tab is theirs.
 */
export function hasTab(user: User | null | undefined, key: TabKey): boolean {
  if (!user) return false;
  const perm = TAB_PERM[key];
  return ROLE_TABS[user.role].includes(key) && (!perm || can(user, perm));
}
