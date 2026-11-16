// Subpath imports: the package entry would bundle every weight and italic (~5 MB).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari/400Regular';
import { NotoSansDevanagari_500Medium } from '@expo-google-fonts/noto-sans-devanagari/500Medium';
import { NotoSansDevanagari_600SemiBold } from '@expo-google-fonts/noto-sans-devanagari/600SemiBold';
import { NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari/700Bold';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from '@/api/queries';
import { ToastHost } from '@/components/toast';
import { setI18nLang } from '@/i18n';
import { useSession } from '@/store/session';
import { useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_500Medium,
    NotoSansDevanagari_600SemiBold,
    NotoSansDevanagari_700Bold,
  });
  const ready = useSession((s) => s.ready);
  const hydrate = useSession((s) => s.hydrate);
  const lang = useSession((s) => s.lang);
  const { c, dark, font } = useTheme();
  const { t } = useTranslation();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setI18nLang(lang);
  }, [lang]);

  useEffect(() => {
    if (fontsLoaded && ready) void SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, ready]);

  if (!fontsLoaded || !ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: c.surface },
              headerTintColor: c.text,
              headerTitleStyle: { fontFamily: font('semibold'), fontSize: 20 },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: c.bg },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="setup" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="update" options={{ headerShown: false }} />
            <Stack.Screen name="(app)" options={{ headerShown: false }} />
            <Stack.Screen name="password" options={{ title: t('auth.change_password') }} />
            <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', headerShown: false }} />
            <Stack.Screen name="part/[id]" options={{ title: t('parts.part') }} />
            <Stack.Screen name="parts" options={{ title: t('parts.title') }} />
            <Stack.Screen name="count" options={{ title: t('stock.count_title') }} />
            <Stack.Screen name="purchase/index" options={{ title: t('purchases.title') }} />
            <Stack.Screen name="purchase/new" options={{ title: t('purchases.new') }} />
            <Stack.Screen name="purchase/[id]" options={{ title: t('purchases.bill') }} />
            <Stack.Screen name="cash" options={{ title: t('cash.title') }} />
            <Stack.Screen name="suppliers" options={{ title: t('suppliers.title') }} />
            <Stack.Screen name="supplier/[id]" options={{ title: t('suppliers.title') }} />
            <Stack.Screen name="reorder" options={{ title: t('reorder.title') }} />
            <Stack.Screen name="job/[id]" options={{ title: t('jobs.job') }} />
            <Stack.Screen name="job/request" options={{ title: t('requests.new') }} />
            <Stack.Screen name="job/estimate" options={{ title: t('estimates.title') }} />
            <Stack.Screen name="customer/index" options={{ title: t('customers.title') }} />
            <Stack.Screen name="customer/[id]" options={{ title: t('jobs.customer') }} />
            <Stack.Screen name="job/new" options={{ title: t('jobs.new') }} />
            <Stack.Screen name="parts-requests" options={{ title: t('requests.title') }} />
            <Stack.Screen name="profile" options={{ title: t('nav.profile') }} />
            <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
            <Stack.Screen name="invoice/[id]" options={{ title: t('billing.title') }} />
            <Stack.Screen name="invoice/counter" options={{ title: t('billing.new_counter') }} />
            <Stack.Screen name="mechanics" options={{ title: t('mechanics.title') }} />
            <Stack.Screen name="reports" options={{ title: t('reports.title') }} />
            <Stack.Screen name="reminders" options={{ title: t('reminders.title') }} />
            <Stack.Screen name="users" options={{ title: t('users.title') }} />
            <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
          </Stack>
          <ToastHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
