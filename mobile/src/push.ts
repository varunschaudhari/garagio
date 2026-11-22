// Expo push notifications. Registration needs an EAS project id (set after `eas init`);
// without it the app silently relies on in-app notifications polled every 20 s.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { api } from '@/api/client';
import { useSession } from '@/store/session';
import { hasTab } from '@/tabs';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** Ask for permission, get the Expo push token and send it to the server. Never throws. */
export async function registerPush(): Promise<void> {
  try {
    if (!Device.isDevice || !projectId()) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Garage',
        // eslint-disable-next-line import/namespace -- re-exported enum the import plugin cannot see; tsc checks it
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 150, 250],
        lightColor: '#C1272D',
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
    await api.post('/auth/push-token', { token });
  } catch {
    /* push is optional */
  }
}

/** Server links are web hashes (#/jobs/12, #/requests?tab=approvals) → app routes. */
export function openLink(link: string) {
  const user = useSession.getState().user;
  const job = /#\/jobs\/(\d+)/.exec(link);
  if (job) return router.push(`/job/${job[1]}`);
  if (link.includes('tab=approvals')) return router.push(hasTab(user, 'approvals') ? '/approvals' : { pathname: '/parts-requests', params: { mode: 'approvals' } });
  if (link.startsWith('#/requests')) return router.push(hasTab(user, 'queue') ? '/queue' : hasTab(user, 'requests') ? '/requests' : '/parts-requests');
  if (link.startsWith('#/parts/')) return router.push(`/part/${link.split('/').pop()}`);
}

/** Open the right screen when a push notification is tapped. Returns an unsubscribe function. */
export function listenForTaps(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const link = (resp.notification.request.content.data as { link?: string } | undefined)?.link;
    if (link) openLink(link);
  });
  return () => sub.remove();
}
