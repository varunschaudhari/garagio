import { Redirect } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { probeServer } from '@/api/client';
import { Loading } from '@/components/ui';
import { versionLess } from '@/format';
import { useSession } from '@/store/session';
import { appVersion } from '@/version';

/** Entry gate: server set? logged in? app new enough? */
export default function Index() {
  const server = useSession((s) => s.server);
  const token = useSession((s) => s.token);
  const setInfo = useSession((s) => s.setInfo);
  const [check, setCheck] = useState<'pending' | 'ok' | 'update'>(server ? 'pending' : 'ok');

  useEffect(() => {
    if (!server) return;
    let alive = true;
    probeServer(server.base)
      .then(({ info }) => {
        if (!alive) return;
        setInfo(info);
        setCheck(info.min_app_version && versionLess(appVersion(), info.min_app_version) ? 'update' : 'ok');
      })
      // Offline or server down: do not block; cached data and the offline banner take over.
      .catch(() => alive && setCheck('ok'));
    return () => {
      alive = false;
    };
  }, [server, setInfo]);

  if (!server) return <Redirect href="/setup" />;
  if (check === 'pending') return <Loading />;
  if (check === 'update') return <Redirect href="/update" />;
  if (!token) return <Redirect href="/login" />;
  return <Redirect href="/(app)" />;
}
