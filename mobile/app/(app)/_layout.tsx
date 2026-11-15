import { Redirect, Tabs } from 'expo-router';
import { Boxes, ClipboardList, House, Inbox, LayoutGrid, PackageSearch, Plus, Receipt, ShieldCheck, Truck, User as UserIcon, Users, Wallet } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe, useRequests } from '@/api/queries';
import { Loading } from '@/components/ui';
import { NotificationBell } from '@/components/work';
import { listenForTaps, registerPush } from '@/push';
import { useSession, can } from '@/store/session';
import { useTheme } from '@/theme';
import type { Perm, Role } from '@/types';

// Tabs grow with each build phase (mirrors BUILT_PHASE on the web, currently phase 4).
type TabKey = 'home' | 'jobs' | 'newjob' | 'billing' | 'customers' | 'requests' | 'queue' | 'approvals' | 'stock' | 'purchases' | 'money' | 'more' | 'me';

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
const TAB_PERM: Partial<Record<TabKey, Perm>> = {
  newjob: 'jobs',
  billing: 'make_bills',
  customers: 'customers',
  queue: 'issue_parts',
  approvals: 'issue_parts',
  purchases: 'purchases',
  money: 'see_money',
};

const TAB_META: Record<TabKey, { icon: LucideIcon; label: string }> = {
  home: { icon: House, label: 'nav.home' },
  jobs: { icon: ClipboardList, label: 'nav.jobs' },
  newjob: { icon: Plus, label: 'nav.new_job' },
  billing: { icon: Receipt, label: 'nav.billing' },
  customers: { icon: Users, label: 'nav.customers' },
  requests: { icon: PackageSearch, label: 'nav.requests' },
  queue: { icon: Inbox, label: 'nav.queue' },
  approvals: { icon: ShieldCheck, label: 'nav.approvals' },
  stock: { icon: Boxes, label: 'nav.stock' },
  purchases: { icon: Truck, label: 'nav.purchases' },
  money: { icon: Wallet, label: 'nav.money' },
  more: { icon: LayoutGrid, label: 'common.more' },
  me: { icon: UserIcon, label: 'nav.me' },
};


export default function AppLayout() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const token = useSession((s) => s.token);
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const me = useMe(!!token);
  const staff = user?.role === 'owner' || user?.role === 'inventory';
  const counts = useRequests({ status: 'open' });

  useEffect(() => {
    if (me.data) setUser(me.data.user, me.data.can_see_cost);
  }, [me.data, setUser]);

  // Push registration once per login; taps on notifications open the right screen.
  useEffect(() => {
    if (!token || !user || user.must_change_password) return;
    void registerPush();
    return listenForTaps();
  }, [token, user]);

  if (!token) return <Redirect href="/login" />;
  const current = me.data?.user ?? user;
  if (!current) return me.isError ? <Redirect href="/login" /> : <Loading />;
  if (current.must_change_password) return <Redirect href={{ pathname: '/password', params: { forced: '1' } }} />;

  const visible = new Set(ROLE_TABS[current.role].filter((k) => !TAB_PERM[k] || can(current, TAB_PERM[k])));
  const badge = (key: TabKey): number | undefined => {
    if (!staff || !counts.data) return undefined;
    if (key === 'queue') return counts.data.counts.open || undefined;
    if (key === 'approvals') return counts.data.counts.approvals || undefined;
    return undefined;
  };

  return (
    <>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          headerTitleStyle: { fontFamily: font('semibold'), fontSize: 20 },
          headerShadowVisible: false,
          headerRight: () => <NotificationBell />,
          tabBarActiveTintColor: c.primaryText,
          tabBarInactiveTintColor: c.muted,
          tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 68, paddingTop: 6 },
          tabBarLabelStyle: { fontFamily: font('semibold'), fontSize: 12 },
          tabBarBadgeStyle: { backgroundColor: c.primary, color: c.primaryInk, fontFamily: font('bold') },
          sceneStyle: { backgroundColor: c.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ href: null, headerShown: false }} />
        {(Object.keys(TAB_META) as TabKey[]).map((key) => {
          const meta = TAB_META[key];
          const Icon = meta.icon;
          const title = key === 'jobs' && current.role === 'mechanic' ? t('jobs.my_jobs') : t(meta.label);
          return (
            <Tabs.Screen
              key={key}
              name={key}
              options={{
                href: visible.has(key) ? undefined : null,
                title,
                tabBarIcon: ({ color }) => <Icon size={26} color={color} />,
                tabBarBadge: badge(key),
              }}
            />
          );
        })}
      </Tabs>
    </>
  );
}
