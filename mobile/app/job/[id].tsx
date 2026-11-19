import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ban, Bike, Camera, CalendarClock, CircleCheck, FileText, Hourglass, MessageCircle, PackageSearch, Pencil, Phone, Plus, Receipt, Send, Trash2, Undo2, Wrench, X } from 'lucide-react-native';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { api, apiUrl } from '@/api/client';
import { useJob, useLabourRates, useSettings, useWorkMutation } from '@/api/queries';
import { Plate } from '@/components/brand';
import { DateField } from '@/components/dateField';
import { Sheet } from '@/components/sheet';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Chip, Divider, Field, IconButton, Loading, OfflineBanner, Txt } from '@/components/ui';
import { StatusChip } from '@/components/work';
import { date, datetime, money, qty } from '@/format';
import { nm } from '@/i18n';
import { useSession, can } from '@/store/session';
import { radius, space, useTheme } from '@/theme';
import type { JobDetail, JobStatus, NextService } from '@/types';

const STATUS_BTN: Partial<Record<JobStatus, { label: string; icon: LucideIcon; variant: 'primary' | 'secondary' | 'ghost' }>> = {
  in_progress: { label: 'jobs.to_in_progress', icon: Wrench, variant: 'primary' },
  waiting_parts: { label: 'jobs.to_waiting_parts', icon: Hourglass, variant: 'secondary' },
  ready: { label: 'jobs.to_ready', icon: CircleCheck, variant: 'primary' },
  delivered: { label: 'jobs.to_delivered', icon: Bike, variant: 'primary' },
  cancelled: { label: 'jobs.to_cancelled', icon: Ban, variant: 'ghost' },
};

type SheetKind = { kind: 'note' | 'cancel' | 'labour' | 'return' | 'next'; estimateId?: number; jobPartId?: number; left?: number } | null;

/** "17-02-2027 or 15400 km, whichever comes first" */
function nextServiceText(ns: NextService | undefined, t: TFunction): string {
  if (!ns) return '—';
  if (ns.on && ns.km) return t('inv.next_service_both', { date: date(ns.on), km: ns.km });
  return ns.on ? date(ns.on) : ns.km ? `${ns.km} km` : '—';
}

export default function JobScreen() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = Number(id);
  const job = useJob(jobId);
  const user = useSession((s) => s.user);
  const server = useSession((s) => s.server);
  const token = useSession((s) => s.token);
  const rates = useLabourRates();
  const settings = useSettings().data;
  const isMech = user?.role === 'mechanic';
  const canEdit = can(user, 'jobs'); // estimates, approve, labour, photos
  const canBill = can(user, 'make_bills');
  const canStock = can(user, 'issue_parts');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [text, setText] = useState('');
  const [notes, setNotes] = useState<string | null>(null);
  const [rateId, setRateId] = useState<number | null>(null);
  const [nsKm, setNsKm] = useState('');
  const [nsOn, setNsOn] = useState<string | null>(null);

  const act = useWorkMutation((v: { method?: 'POST' | 'PUT' | 'DELETE'; path: string; body?: unknown }) =>
    v.method === 'PUT' ? api.put<{ item: JobDetail }>(v.path, v.body) : v.method === 'DELETE' ? api.del<{ item: JobDetail }>(v.path) : api.post<{ item: JobDetail }>(v.path, v.body ?? {})
  );
  const run = async (v: { method?: 'POST' | 'PUT' | 'DELETE'; path: string; body?: unknown }, ok?: string) => {
    try {
      const res = await act.mutateAsync(v);
      if (ok) toast(ok);
      setSheet(null);
      return res;
    } catch (e) {
      toastError(e);
      return null;
    }
  };

  if (job.isPending) return <Loading />;
  if (!job.data) return null;
  const j = job.data;
  const latest = j.estimates[0];
  const requestable = ['approved', 'in_progress', 'waiting_parts'].includes(j.status);
  const statusButtons = j.allowed_status.filter((s) => !(isMech && (s === 'cancelled' || s === 'delivered')) && user?.role !== 'inventory');
  const billed = !!j.invoice_id;

  const changeStatus = (s: JobStatus) => {
    if (s === 'cancelled') {
      setText('');
      setSheet({ kind: 'cancel' });
      return;
    }
    void run({ path: `/jobs/${jobId}/status`, body: { status: s } }, t(`status.${s}`));
  };

  const sendEstimate = async (estimateId: number) => {
    try {
      const res = await api.post<{ url: string }>(`/estimates/${estimateId}/send`);
      void job.refetch();
      await Linking.openURL(res.url);
    } catch (e) {
      toastError(e);
    }
  };

  const addPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (shot.canceled || !shot.assets[0]) return;
    const fd = new FormData();
    fd.append('photo', { uri: shot.assets[0].uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
    await run({ path: `/jobs/${jobId}/photos`, body: fd });
  };

  const readyWhatsApp = async () => {
    try {
      const res = await api.post<{ url: string }>(`/jobs/${jobId}/whatsapp`, { template: 'ready' });
      await Linking.openURL(res.url);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: `${j.reg_no} · ${j.job_no}` }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        refreshControl={<RefreshControl refreshing={job.isRefetching} onRefresh={() => void job.refetch()} colors={[c.primary]} />}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={{ gap: space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <View style={{ flex: 1 }}>
              <Plate reg={j.reg_no} large />
            </View>
            <StatusChip status={j.status} />
          </View>
          <Txt muted>
            {[j.make, j.model, j.year].filter(Boolean).join(' ')} · {j.customer_name}
          </Txt>
          <Txt size="sm" muted>
            {j.mechanic_name ?? t('jobs.no_mechanic')}
            {j.promised_at ? ` · ${t('jobs.promised')} ${datetime(j.promised_at)}` : ''}
          </Txt>
          {j.complaint ? <Txt>{j.complaint}</Txt> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <CalendarClock size={18} color={c.muted} />
            <Txt size="sm" style={{ flex: 1 }}>
              {t('jobs.next_service')}: <Txt size="sm" weight="semibold">{nextServiceText(j.next_service, t)}</Txt>
            </Txt>
            {canEdit && j.status !== 'cancelled' ? (
              <IconButton
                icon={Pencil}
                label={`${t('common.edit')} · ${t('jobs.next_service')}`}
                color={c.muted}
                onPress={() => {
                  setNsOn(j.next_service?.on ?? null);
                  setNsKm(j.next_service?.km ? String(j.next_service.km) : '');
                  setSheet({ kind: 'next' });
                }}
              />
            ) : null}
          </View>
          {canEdit ? (
            <View style={{ flexDirection: 'row', gap: space[2], marginTop: space[2] }}>
              <Button title={t('jobs.call')} icon={Phone} variant="secondary" small onPress={() => void Linking.openURL(`tel:${j.customer_phone}`)} style={{ flex: 1 }} />
              {j.status === 'ready' ? <Button title="WhatsApp" icon={MessageCircle} variant="secondary" small onPress={readyWhatsApp} style={{ flex: 1 }} /> : null}
            </View>
          ) : null}
        </Card>

        {j.money.revised_needed && !j.money.revision_pending ? <Banner tone="warning" text={t('jobs.revised_needed')} /> : null}
        {j.money.revision_pending ? <Banner text={t('jobs.revision_pending')} /> : null}

        {canEdit && j.can_approve ? (
          <Button
            title={t('jobs.approve')}
            icon={CircleCheck}
            needsOnline
            loading={act.isPending}
            onPress={() => {
              const est = j.estimates[0] && ['draft', 'sent'].includes(j.estimates[0].status) ? j.estimates[0] : null;
              Alert.alert(t('jobs.approve'), est ? t('jobs.approve_confirm_est', { no: est.est_no, total: money(est.grand_total) }) : t('jobs.approve_confirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('jobs.approve'), onPress: () => void run({ path: `/jobs/${jobId}/approve` }, t('jobs.approved_ok')) },
              ]);
            }}
          />
        ) : null}
        {statusButtons.length ? (
          <View style={{ gap: space[2] }}>
            {statusButtons.map((s) => {
              const b = STATUS_BTN[s];
              if (!b) return null;
              const label = s === 'in_progress' && j.status === 'ready' ? 'jobs.back_in_progress' : b.label;
              return <Button key={s} title={t(label)} icon={b.icon} variant={b.variant} onPress={() => changeStatus(s)} loading={act.isPending} needsOnline />;
            })}
          </View>
        ) : null}

        {canBill && j.invoice ? (
          <Button title={j.invoice.invoice_no ?? t('billing.draft')} icon={Receipt} variant="secondary" onPress={() => router.push(`/invoice/${j.invoice!.id}`)} />
        ) : null}
        {canBill && !j.invoice && ['approved', 'in_progress', 'waiting_parts', 'ready'].includes(j.status) ? (
          <Button
            title={t('billing.create_bill')}
            icon={Receipt}
            variant="secondary"
            needsOnline
            onPress={async () => {
              const res = (await run({ path: '/invoices', body: { job_card_id: jobId } })) as { item?: { id: number } } | null;
              if (res?.item) router.push(`/invoice/${res.item.id}`);
            }}
          />
        ) : null}

        {requestable && (canEdit || isMech) ? (
          <Button title={t('requests.new')} icon={PackageSearch} variant="secondary" onPress={() => router.push({ pathname: '/job/request', params: { job: String(jobId) } })} needsOnline />
        ) : null}

        {canEdit ? (
          <Card style={{ gap: space[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Txt weight="semibold" style={{ flex: 1 }}>
                {t('estimates.title')}
              </Txt>
              {!['delivered', 'cancelled'].includes(j.status) ? (
                <Button title={j.approved_estimate_id ? t('estimates.revise') : t('estimates.new')} icon={FileText} small variant="secondary" onPress={() => router.push({ pathname: '/job/estimate', params: { job: String(jobId) } })} />
              ) : null}
            </View>
            {latest ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                  <Txt weight="semibold" style={{ flex: 1 }}>
                    {latest.est_no} v{latest.version}
                  </Txt>
                  <StatusChip status={latest.status} />
                </View>
                {latest.items.map((it) => (
                  <View key={it.id} style={styles.kv}>
                    <Txt size="sm" style={{ flex: 1 }} numberOfLines={1}>
                      {it.description} × {qty(it.qty)}
                    </Txt>
                    <Txt size="sm" tabular>
                      {money(it.amount)}
                    </Txt>
                  </View>
                ))}
                <View style={styles.kv}>
                  <Txt weight="bold">{t('estimates.total')}</Txt>
                  <Txt weight="bold" tabular>
                    {money(latest.grand_total)}
                  </Txt>
                </View>
                {['draft', 'sent'].includes(latest.status) ? (
                  <View style={{ gap: space[2] }}>
                    <Button title={latest.status === 'sent' ? t('estimates.resend') : t('estimates.send')} icon={Send} onPress={() => sendEstimate(latest.id)} needsOnline />
                    <Button title={t('estimates.approve_call')} icon={Phone} variant="secondary" onPress={() => { setText(''); setSheet({ kind: 'note', estimateId: latest.id }); }} needsOnline />
                  </View>
                ) : null}
              </>
            ) : (
              <Txt muted>{t('estimates.empty')}</Txt>
            )}
          </Card>
        ) : null}

        <Card padded={false}>
          <Txt weight="semibold" style={{ padding: space[4] }}>
            {t('jobs.parts_used')}
          </Txt>
          {j.parts.map((p) => {
            const left = Number(p.qty) - Number(p.returned_qty);
            return (
              <View key={p.id}>
                <Divider />
                <View style={styles.line}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="semibold">{nm(p)}</Txt>
                    <Txt size="sm" muted>
                      {p.part_no} · {qty(left)} {p.unit}
                      {Number(p.returned_qty) ? ` (${qty(p.returned_qty)} ${t('jobs.returned')})` : ''}
                    </Txt>
                    {!Number(p.issued) ? <Chip label={t('jobs.part_planned')} tone="info" /> : null}
                  </View>
                  <Txt tabular weight="semibold">
                    {money(left * p.unit_price)}
                  </Txt>
                  {Number(p.issued) && canStock && left > 0 && !billed ? (
                    <IconButton icon={Undo2} label={t('jobs.return')} onPress={() => { setText(qty(left)); setSheet({ kind: 'return', jobPartId: p.id, left }); }} />
                  ) : null}
                  {!Number(p.issued) && canEdit && j.invoice?.status !== 'final' ? (
                    <IconButton
                      icon={X}
                      label={t('jobs.remove_part')}
                      onPress={() =>
                        Alert.alert(t('jobs.remove_part'), t('jobs.remove_part_confirm', { part: nm(p) }), [
                          { text: t('common.cancel'), style: 'cancel' },
                          { text: t('jobs.remove_part'), style: 'destructive', onPress: () => void run({ method: 'DELETE', path: `/jobs/${jobId}/parts/${p.id}` }) },
                        ])
                      }
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
          {j.requests.flatMap((r) =>
            r.items
              .filter((l) => l.status !== 'issued')
              .map((l) => (
                <View key={l.id}>
                  <Divider />
                  <View style={styles.line}>
                    <View style={{ flex: 1 }}>
                      <Txt>{l.part_id ? nm(l) : l.custom_name}</Txt>
                      <Txt size="sm" muted>
                        × {qty(l.qty)}
                        {l.remark ? ` · ${l.remark}` : ''}
                      </Txt>
                    </View>
                    <StatusChip status={l.status} />
                  </View>
                </View>
              ))
          )}
          {!j.parts.length && !j.requests.length ? <Txt muted style={{ paddingHorizontal: space[4], paddingBottom: space[4] }}>—</Txt> : null}
        </Card>

        <Card padded={false}>
          <View style={[styles.line, { paddingVertical: space[2] }]}>
            <Txt weight="semibold" style={{ flex: 1 }}>
              {t('jobs.labour')}
            </Txt>
            {(canEdit || isMech) && !billed && !['delivered', 'cancelled'].includes(j.status) ? (
              <Button title={t('jobs.add_labour')} icon={Plus} small variant="secondary" onPress={() => { setRateId(null); setText(''); setSheet({ kind: 'labour' }); }} />
            ) : null}
          </View>
          {j.labour.map((l) => (
            <View key={l.id}>
              <Divider />
              <View style={styles.line}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt>
                    {l.description}
                    {l.item_kind === 'part' && Number(l.qty) !== 1 ? ` × ${qty(l.qty)}` : ''}
                  </Txt>
                  {l.item_kind === 'part' ? <Chip label={t('jobs.part_not_stock')} tone="info" /> : null}
                </View>
                <Txt tabular weight="semibold">
                  {money(Number(l.amount) * (l.item_kind === 'part' ? Number(l.qty) : 1))}
                </Txt>
                {(canEdit || (isMech && l.user_id === user?.id)) && !billed ? (
                  <IconButton icon={Trash2} label={t('common.delete')} color={c.dangerText} onPress={() => void run({ method: 'DELETE', path: `/jobs/${jobId}/labour/${l.id}` })} />
                ) : null}
              </View>
            </View>
          ))}
        </Card>

        <Card style={{ gap: space[2] }}>
          <Field
            label={t('jobs.inspection')}
            value={notes ?? j.inspection_notes ?? ''}
            onChangeText={setNotes}
            multiline
            editable={canEdit || isMech}
            style={{ minHeight: 90, textAlignVertical: 'top' }}
          />
          {(canEdit || isMech) && notes !== null ? (
            <Button title={t('common.save')} small onPress={async () => { if (await run({ method: 'PUT', path: `/jobs/${jobId}`, body: { inspection_notes: notes } }, t('common.saved'))) setNotes(null); }} needsOnline />
          ) : null}
        </Card>

        <Card style={{ gap: space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt weight="semibold" style={{ flex: 1 }}>
              {t('jobs.photos')}
            </Txt>
            {(canEdit || isMech) && j.photos.length < 4 ? <Button title={t('jobs.add_photo')} icon={Camera} small variant="secondary" onPress={addPhoto} needsOnline /> : null}
          </View>
          <View style={styles.photos}>
            {j.photos.map((p) => (
              <Pressable
                key={p.id}
                onLongPress={() =>
                  (canEdit || isMech) &&
                  Alert.alert(t('common.delete') + '?', '', [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('common.delete'), style: 'destructive', onPress: () => void run({ method: 'DELETE', path: `/jobs/${jobId}/photos/${p.id}` }) },
                  ])
                }
                style={styles.photo}
              >
                <Image
                  source={{ uri: server ? apiUrl(server, `/jobs/${jobId}/photos/${p.id}`) : '', headers: { Authorization: `Bearer ${token}`, 'X-Auth-Token': token ?? '' } }}
                  style={{ width: '100%', height: '100%', borderRadius: radius.input }}
                  accessibilityLabel={t('jobs.photos')}
                />
              </Pressable>
            ))}
          </View>
          {!j.photos.length ? <Txt size="sm" muted>{t('jobs.photo_limit')}</Txt> : null}
        </Card>

        <Card style={{ gap: space[2] }}>
          <Txt weight="semibold">{t('jobs.money')}</Txt>
          <View style={styles.kv}><Txt muted>{t('jobs.parts_total')}</Txt><Txt tabular>{money(j.money.parts_total)}</Txt></View>
          <View style={styles.kv}><Txt muted>{t('jobs.labour_total')}</Txt><Txt tabular>{money(j.money.labour_total)}</Txt></View>
          <View style={styles.kv}><Txt weight="bold">{t('jobs.current_total')}</Txt><Txt weight="bold" tabular>{money(j.money.current_total)}</Txt></View>
          {j.money.approved_total !== null ? <View style={styles.kv}><Txt muted>{t('jobs.approved_total')}</Txt><Txt tabular>{money(j.money.approved_total)}</Txt></View> : null}
        </Card>
      </ScrollView>

      {sheet ? (
        <Sheet
          visible
          onClose={() => setSheet(null)}
          title={t(sheet.kind === 'note' ? 'estimates.approve_call' : sheet.kind === 'cancel' ? 'jobs.to_cancelled' : sheet.kind === 'return' ? 'jobs.return' : sheet.kind === 'next' ? 'jobs.next_service' : 'jobs.add_labour')}
        >
          {sheet.kind === 'next' ? (
            <View style={{ gap: space[3] }}>
              {!j.next_service?.custom ? <Banner text={t('jobs.next_service_default', { days: settings?.service_reminder_days ?? 90, km: settings?.service_reminder_km ?? 3000 })} /> : null}
              <DateField label={t('jobs.next_service_on')} value={nsOn} onChange={setNsOn} min={j.created_at.slice(0, 10)} clearable />
              <Field label={t('jobs.next_service_km')} value={nsKm} onChangeText={setNsKm} keyboardType="number-pad" />
              <Txt size="sm" muted>{t('jobs.next_service_hint')}</Txt>
            </View>
          ) : sheet.kind === 'labour' ? (
            <View style={{ gap: space[2] }}>
              {(rates.data ?? []).map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => { setRateId(r.id); setText(String(r.amount)); }}
                  style={[styles.rate, { borderColor: rateId === r.id ? c.primary : c.border, backgroundColor: rateId === r.id ? c.primarySoft : c.surface }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: rateId === r.id }}
                >
                  <Txt style={{ flex: 1 }}>{nm(r)}</Txt>
                  <Txt tabular weight="semibold">{money(r.amount)}</Txt>
                </Pressable>
              ))}
              {canEdit ? <Field label={t('common.amount')} value={text} onChangeText={setText} keyboardType="decimal-pad" /> : null}
            </View>
          ) : (
            <Field
              label={t(sheet.kind === 'note' ? 'estimates.approve_note' : sheet.kind === 'cancel' ? 'jobs.cancel_reason' : 'jobs.return_qty')}
              value={text}
              onChangeText={setText}
              keyboardType={sheet.kind === 'return' ? 'decimal-pad' : 'default'}
              autoFocus
            />
          )}
          <Button
            title={t('common.confirm')}
            loading={act.isPending}
            needsOnline
            disabled={sheet.kind === 'labour' ? !rateId : sheet.kind === 'next' ? false : !text.trim()}
            onPress={() => {
              if (sheet.kind === 'next') return void run({ method: 'PUT', path: `/jobs/${jobId}/next-service`, body: { next_service_on: nsOn, next_service_km: nsKm.trim() || null } }, t('jobs.next_service_saved'));
              if (sheet.kind === 'note') return void run({ path: `/estimates/${sheet.estimateId}/approve-call`, body: { note: text.trim() } }, t('status.approved'));
              if (sheet.kind === 'cancel') return void run({ path: `/jobs/${jobId}/status`, body: { status: 'cancelled', note: text.trim() } }, t('status.cancelled'));
              if (sheet.kind === 'return') return void run({ path: `/jobs/${jobId}/return`, body: { job_part_id: sheet.jobPartId, qty: Number(text.replace(',', '.')) } }, t('common.saved'));
              return void run({ path: `/jobs/${jobId}/labour`, body: canEdit ? { labour_rate_id: rateId, amount: text } : { labour_rate_id: rateId } }, t('common.saved'));
            }}
          />
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  photo: { width: '48%', aspectRatio: 4 / 3 },
  rate: { flexDirection: 'row', alignItems: 'center', gap: space[3], borderWidth: 1, borderRadius: radius.input, padding: space[3], minHeight: 52 },
});
