import * as Linking from 'expo-linking';
import { CircleCheck, MessageCircle, Share2 } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useReorder } from '@/api/queries';
import { Button, Card, Chip, Divider, EmptyState, Loading, OfflineBanner, Txt } from '@/components/ui';
import { qty } from '@/format';
import { nm } from '@/i18n';
import { useSession } from '@/store/session';
import { radius, size, space, useTheme } from '@/theme';
import type { Reorder } from '@/types';

export default function ReorderScreen() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const data = useReorder();
  const info = useSession((s) => s.info);
  const lang = useSession((s) => s.lang);
  const [qtys, setQtys] = useState<Record<number, string>>({});

  const message = (g: Reorder['groups'][number]) => {
    const shop = (lang === 'mr' ? info?.shop_name_mr || info?.shop_name : info?.shop_name) ?? '';
    const lines = g.items.map((it, i) => `${i + 1}. ${it.part_no} – ${[it.name_en, it.name_mr].filter(Boolean).join(' / ')} – ${qtys[it.part_id] ?? qty(it.suggested_qty)} ${it.unit}`);
    return `${t('reorder.message_head', { shop })}\n\n${lines.join('\n')}\n\n${t('reorder.message_foot')}`;
  };

  const share = async (g: Reorder['groups'][number]) => {
    const text = message(g);
    const phone = (g.supplier?.phone ?? '').replace(/\D/g, '').slice(-10);
    if (phone) {
      await Linking.openURL(`https://wa.me/91${phone}?text=${encodeURIComponent(text)}`);
    } else {
      await Share.share({ message: text });
    }
  };

  if (data.isPending) return <Loading />;
  const groups = data.data?.groups ?? [];

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={data.isRefetching} onRefresh={() => void data.refetch()} colors={[c.primary]} />}
      >
        <Txt size="sm" muted>
          {t('reorder.sub')}
        </Txt>
        {!groups.length ? <EmptyState icon={CircleCheck} title={t('reorder.empty')} /> : null}
        {groups.map((g, gi) => (
          <Card key={gi} padded={false}>
            <View style={{ padding: space[4], gap: space[1] }}>
              <Txt size="lg" weight="bold">
                {g.supplier ? g.supplier.name : t('reorder.no_supplier')}
              </Txt>
              {g.supplier?.phone ? (
                <Txt size="sm" muted>
                  {g.supplier.phone}
                </Txt>
              ) : null}
            </View>
            {g.items.map((it) => (
              <View key={it.part_id}>
                <Divider />
                <View style={styles.item}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Txt weight="semibold" numberOfLines={2}>
                      {nm(it)}
                    </Txt>
                    <Txt size="sm" muted>
                      {it.part_no} · {t('parts.stock')} {qty(it.current_stock)} / min {qty(it.min_stock)}
                    </Txt>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
                      {it.reasons.map((r) => (
                        <Chip key={r} label={t(r === 'low' ? 'reorder.reason_low' : 'reorder.reason_unavailable')} tone={r === 'low' ? 'danger' : 'warning'} />
                      ))}
                    </View>
                  </View>
                  <TextInput
                    value={qtys[it.part_id] ?? qty(it.suggested_qty)}
                    onChangeText={(v) => setQtys((q) => ({ ...q, [it.part_id]: v }))}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`${t('reorder.suggested')} ${it.part_no}`}
                    style={[styles.qty, { color: c.text, borderColor: c.borderStrong, fontFamily: font('bold'), backgroundColor: c.bg }]}
                  />
                </View>
              </View>
            ))}
            <View style={{ padding: space[4] }}>
              <Button title={g.supplier?.phone ? t('reorder.share') : t('common.share')} icon={g.supplier?.phone ? MessageCircle : Share2} onPress={() => void share(g)} />
            </View>
          </Card>
        ))}
        {data.data?.unlinked.length ? (
          <Card style={{ gap: space[2] }}>
            <Txt weight="semibold">{t('reorder.unlinked')}</Txt>
            {data.data.unlinked.map((u) => (
              <View key={u.custom_name} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt>{u.custom_name}</Txt>
                <Txt tabular weight="semibold">
                  {qty(u.qty)}
                </Txt>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
  qty: { width: 80, minHeight: 52, borderWidth: 2, borderRadius: radius.input, textAlign: 'center', fontSize: size.lg },
});
