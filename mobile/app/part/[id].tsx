import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowUpDown, Boxes, IndianRupee, MapPin, Minus, Pencil, Plus, Tag } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/api/client';
import { useAdjustStock, useLedger, usePart } from '@/api/queries';
import { toast, toastError } from '@/components/toast';
import { Button, Card, Chip, Divider, Field, Loading, OfflineBanner, Txt } from '@/components/ui';
import { datetime, money, qty } from '@/format';
import { fieldError, nm, nmAlt } from '@/i18n';
import { useSession, can } from '@/store/session';
import { radius, size, space, touch, useTheme, type Colors } from '@/theme';
import type { Part } from '@/types';

function Tile({ icon: Icon, label, value, sub, tone = 'primarySoft', fg = 'primaryText' }: { icon: LucideIcon; label: string; value: string; sub?: string; tone?: keyof Colors; fg?: keyof Colors }) {
  const { c } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <View style={[styles.tileIcon, { backgroundColor: c[tone] }]}>
          <Icon size={18} color={c[fg]} />
        </View>
        <Txt size="sm" muted style={{ flex: 1 }} numberOfLines={1}>
          {label}
        </Txt>
      </View>
      <Txt size="lg" weight="bold" tabular numberOfLines={1}>
        {value}
      </Txt>
      {sub ? (
        <Txt size="sm" muted numberOfLines={2}>
          {sub}
        </Txt>
      ) : null}
    </View>
  );
}

function AdjustSheet({ part, onClose }: { part: Part; onClose: () => void }) {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const insets = useSafeAreaInsets();
  const adjust = useAdjustStock(part.id);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const n = Number(delta.replace(',', '.'));
  const bump = (by: number) => setDelta(String((Number.isFinite(n) ? n : 0) + by));

  const save = async () => {
    const e: Record<string, string> = {};
    if (!delta || !Number.isFinite(n) || n === 0) e.qty = fieldError(!delta ? 'required' : 'zero');
    if (!reason.trim()) e.reason = fieldError('required');
    setErrs(e);
    if (Object.keys(e).length) return;
    try {
      await adjust.mutateAsync({ qty: n, reason: reason.trim() });
      toast(t('parts.adjusted'));
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length && err.code === 'validation_failed') {
        setErrs(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, fieldError(v)])));
      } else toastError(err);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={onClose} accessibilityLabel={t('common.close')} />
      <KeyboardAvoidingView behavior="padding" style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + space[4] }]}>
          <Txt size="lg" weight="bold">
            {t('parts.adjust')}
          </Txt>
          <Txt muted>
            {nm(part)} · {t('parts.current_stock')}: {qty(part.current_stock)} {part.unit}
          </Txt>
          <View style={{ gap: 6 }}>
            <Txt size="sm" weight="semibold">
              {t('parts.adjust_qty')}
            </Txt>
            <View style={styles.stepper}>
              <Pressable accessibilityLabel="−1" onPress={() => bump(-1)} style={[styles.stepBtn, { backgroundColor: c.surface2, borderColor: c.borderStrong }]}>
                <Minus size={28} color={c.text} />
              </Pressable>
              <TextInput
                value={delta}
                onChangeText={setDelta}
                keyboardType="numbers-and-punctuation"
                placeholder="0"
                placeholderTextColor={c.muted}
                accessibilityLabel={t('parts.adjust_qty')}
                style={[styles.stepInput, { color: c.text, borderColor: errs.qty ? c.danger : c.borderStrong, fontFamily: font('bold') }]}
              />
              <Pressable accessibilityLabel="+1" onPress={() => bump(1)} style={[styles.stepBtn, { backgroundColor: c.surface2, borderColor: c.borderStrong }]}>
                <Plus size={28} color={c.text} />
              </Pressable>
            </View>
            <Txt size="sm" color={errs.qty ? 'dangerText' : 'muted'}>
              {errs.qty ?? t('parts.adjust_hint')}
            </Txt>
          </View>
          <Field label={t('common.reason')} value={reason} onChangeText={setReason} placeholder={t('parts.adjust_reason_placeholder')} error={errs.reason} required />
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <Button title={t('common.cancel')} variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button title={t('common.save')} onPress={save} loading={adjust.isPending} needsOnline style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function PartDetail() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const partId = Number(id);
  const user = useSession((s) => s.user);
  const canSeeCost = useSession((s) => s.canSeeCost);
  const part = usePart(partId);
  const ledger = useLedger(partId);
  const [adjusting, setAdjusting] = useState(false);
  const canAdjust = can(user, 'edit_parts');

  if (part.isPending) return <Loading />;
  if (!part.data) return null;
  const p = part.data;
  const low = !!p.is_low;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: p.part_no }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        refreshControl={
          <RefreshControl
            refreshing={part.isRefetching || ledger.isRefetching}
            onRefresh={() => {
              void part.refetch();
              void ledger.refetch();
            }}
            colors={[c.primary]}
          />
        }
      >
        <View style={{ gap: 4 }}>
          <Txt size="xl" weight="bold">
            {nm(p)}
          </Txt>
          <Txt muted>
            {p.part_no}
            {nmAlt(p) ? ` · ${nmAlt(p)}` : ''}
            {p.brand ? ` · ${p.brand}` : ''}
          </Txt>
          {!p.active ? <Chip label={t('parts.inactive_part')} /> : null}
        </View>

        <View style={[styles.stockCard, { backgroundColor: low ? c.dangerSoft : c.successSoft }]}>
          <Boxes size={28} color={low ? c.dangerText : c.successText} />
          <View style={{ flex: 1 }}>
            <Txt size="sm" color={low ? 'dangerText' : 'successText'}>
              {t('parts.current_stock')}
            </Txt>
            <Txt size="xxl" weight="bold" tabular color={low ? 'dangerText' : 'successText'}>
              {qty(p.current_stock)} <Txt size="md">{p.unit}</Txt>
            </Txt>
          </View>
          <Txt size="sm" color={low ? 'dangerText' : 'successText'}>
            {t('parts.min_stock')}: {qty(p.min_stock)}
          </Txt>
        </View>

        <View style={styles.tiles}>
          <Tile icon={MapPin} label={t('parts.location')} value={nm(p, 'location') || '—'} sub={`${t('parts.rack')}: ${p.rack || '—'}`} />
          <Tile icon={Tag} label={t('parts.mrp')} value={money(p.selling_price)} sub={`GST ${qty(p.gst_rate)}% · HSN ${p.hsn || '—'}`} tone="infoSoft" fg="infoText" />
          {canSeeCost && p.avg_cost !== undefined ? (
            <Tile
              icon={IndianRupee}
              label={t('parts.avg_cost')}
              value={money(p.avg_cost)}
              sub={`${t('parts.last_purchase_price')}: ${money(p.last_purchase_price)} − ${qty(p.last_purchase_disc_pct)}%`}
              tone="warningSoft"
              fg="warningText"
            />
          ) : null}
        </View>

        {canAdjust ? <Button title={t('parts.adjust')} icon={ArrowUpDown} variant="secondary" onPress={() => setAdjusting(true)} needsOnline /> : null}
        {canAdjust ? <Button title={t('parts.edit')} icon={Pencil} variant="ghost" onPress={() => router.push({ pathname: '/part/edit', params: { id: String(p.id) } })} needsOnline /> : null}

        <Card style={{ gap: space[2] }}>
          <Txt muted size="sm">
            {t('parts.category')}: <Txt size="sm">{nm(p, 'category') || '—'}</Txt>
          </Txt>
          <Txt muted size="sm">
            {t('parts.compatible_models')}: <Txt size="sm">{p.compatible_models || '—'}</Txt>
          </Txt>
          {p.open_request_qty ? (
            <Txt muted size="sm">
              {t('parts.open_requests')}: <Txt size="sm">{qty(p.open_request_qty)}</Txt>
            </Txt>
          ) : null}
        </Card>

        <Card padded={false}>
          <View style={[styles.ledgerHead, { borderColor: c.border }]}>
            <Txt weight="semibold" style={{ flex: 1 }}>
              {t('parts.ledger')}
            </Txt>
            {ledger.data ? <Chip label={ledger.data.balanced ? t('parts.balanced') : `Σ ${qty(ledger.data.ledger_sum)}`} tone={ledger.data.balanced ? 'success' : 'danger'} /> : null}
          </View>
          {ledger.isPending ? (
            <Loading />
          ) : ledger.data?.items.length ? (
            ledger.data.items.map((m, i) => (
              <View key={m.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.move}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt weight="semibold">{t(`movement.${m.mtype}`)}</Txt>
                    <Txt size="sm" muted numberOfLines={2}>
                      {datetime(m.created_at)}
                      {m.ref_label ? ` · ${m.ref_label}` : ''}
                      {m.user_name ? ` · ${m.user_name}` : ''}
                    </Txt>
                    {m.note ? (
                      <Txt size="sm" muted numberOfLines={2}>
                        {m.note}
                      </Txt>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt weight="bold" tabular color={m.qty > 0 ? 'successText' : 'dangerText'}>
                      {m.qty > 0 ? '+' : ''}
                      {qty(m.qty)}
                    </Txt>
                    <Txt size="sm" muted tabular>
                      = {qty(m.balance_after)}
                    </Txt>
                  </View>
                </View>
              </View>
            ))
          ) : (
            <Txt muted style={{ padding: space[4] }}>
              {t('parts.ledger_empty')}
            </Txt>
          )}
        </Card>
      </ScrollView>
      {adjusting ? <AdjustSheet part={p} onClose={() => setAdjusting(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stockCard: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], borderRadius: radius.card },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  tile: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: radius.card, padding: space[4], gap: space[1] },
  tileIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  ledgerHead: { flexDirection: 'row', alignItems: 'center', padding: space[4], borderBottomWidth: 1 },
  move: { flexDirection: 'row', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space[5], gap: space[4] },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  stepBtn: { width: 64, height: touch.button + 8, borderRadius: radius.input, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepInput: { flex: 1, height: touch.button + 8, borderWidth: 1, borderRadius: radius.input, textAlign: 'center', fontSize: size.xl },
});
