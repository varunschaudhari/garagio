import { Redirect } from 'expo-router';
import React from 'react';
import { Loading } from '@/components/ui';
import { useSession } from '@/store/session';

/** Lands each role on its first tab. */
export default function AppIndex() {
  const user = useSession((s) => s.user);
  if (!user) return <Loading />;
  const first = { owner: '/home', inventory: '/queue', front_desk: '/jobs', mechanic: '/jobs' } as const;
  return <Redirect href={first[user.role]} />;
}
