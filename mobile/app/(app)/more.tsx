import { router, type Href } from 'expo-router';
import { ChartColumn, ChevronRight, HandCoins, Inbox, ListChecks, MessageCircle, Package, Plus, Receipt, ScanLine, Settings, ShoppingCart, Store, Truck, User as UserIcon, UserCog, Users } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Card, OfflineBanner, Txt } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

function Row({ icon: Icon, label, href }: { icon: LucideIcon; label: string; href: Href }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(href)} style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : 'transparent' }]}>
      <View style={[styles.icon, { backgroundColor: c.primarySoft }]}>
        <Icon size={22} color={c.primaryText} />
      </View>
      <Txt weight="semibold" style={{ flex: 1 }}>
        {label}
      </Txt>
      <ChevronRight size={22} color={c.muted} />
    </Pressable>
  );
}

/** Owner's "More" tab. Later phases add mechanic summary, dues, reports, settings and users here. */
export default function More() {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4] }}>
        <Card padded={false}>
          <Row icon={Plus} label={t('jobs.new')} href="/newjob" />
          <Row icon={Users} label={t('customers.title')} href="/customers" />
          <Row icon={Inbox} label={t('requests.title')} href="/queue" />
          <Row icon={Receipt} label={t('billing.new_counter')} href="/invoice/counter" />
        </Card>
        <Card padded={false}>
          <Row icon={Package} label={t('parts.catalogue')} href="/parts" />
          <Row icon={ListChecks} label={t('stock.count_title')} href="/count" />
          <Row icon={ScanLine} label={t('mobile.scan_title')} href={{ pathname: '/scan', params: { mode: 'open' } }} />
        </Card>
        <Card padded={false}>
          <Row icon={Truck} label={t('purchases.title')} href="/purchases" />
          <Row icon={Store} label={t('suppliers.title')} href="/suppliers" />
          <Row icon={ShoppingCart} label={t('reorder.title')} href="/reorder" />
        </Card>
        <Card padded={false}>
          <Row icon={HandCoins} label={t('mechanics.title')} href="/mechanics" />
          <Row icon={ChartColumn} label={t('reports.title')} href="/reports" />
          <Row icon={MessageCircle} label={t('reminders.title')} href="/reminders" />
        </Card>
        <Card padded={false}>
          <Row icon={UserCog} label={t('users.title')} href="/users" />
          <Row icon={Settings} label={t('settings.title')} href="/settings" />
          <Row icon={UserIcon} label={t('nav.profile')} href="/me" />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, borderRadius: radius.input + 2, alignItems: 'center', justifyContent: 'center' },
});
