import { router } from 'expo-router';
import { Bell, Check, Clock, Link2, Package, Wrench, X } from 'lucide-react-native';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { useNotifications, useWorkMutation } from '@/api/queries';
import { datetime, money, qty } from '@/format';
import { nm } from '@/i18n';
import { hasRole, useSession } from '@/store/session';
import { radius, space, useTheme } from '@/theme';
import type { JobListItem, Part, PartRequest, RequestLine } from '@/types';
import { PartPicker } from './pickers';
import { Sheet } from './sheet';
import { toast, toastError } from './toast';
import { Button, Card, Chip, Divider, Field, IconButton, Txt } from './ui';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
const TONE: Record<string, Tone> = {
  pending: 'neutral', estimate_sent: 'info', approved: 'primary', in_progress: 'warning', waiting_parts: 'danger', ready: 'success', delivered: 'neutral', cancelled: 'neutral',
  requested: 'info', needs_approval: 'warning', issued: 'success', unavailable: 'danger', rejected: 'danger', open: 'info', closed: 'neutral',
  draft: 'neutral', sent: 'info', superseded: 'neutral',
};

export function StatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Chip label={t(`status.${status}`)} tone={TONE[status] ?? 'neutral'} />;
}

export function JobRow({ job, onPress }: { job: JobListItem; onPress: () => void }) {
  const { c } = useTheme();
  const { t } = useTranslation();
  const late = job.promised_at && !['delivered', 'cancelled'].includes(job.status) && new Date(job.promised_at.replace(' ', 'T')) < new Date();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { borderColor: c.border, backgroundColor: pressed ? c.surface2 : c.surface }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Txt size="lg" weight="bold" style={{ flex: 1 }}>
          {job.reg_no}
        </Txt>
        <StatusChip status={job.status} />
      </View>
      <Txt size="sm" muted numberOfLines={1}>
        {job.job_no} · {[job.make, job.model].filter(Boolean).join(' ')} · {job.customer_name}
      </Txt>
      {job.complaint ? (
        <Txt size="sm" numberOfLines={2}>
          {job.complaint}
        </Txt>
      ) : null}
      <View style={styles.meta}>
        {job.promised_at ? (
          <View style={styles.metaItem}>
            <Clock size={14} color={late ? c.dangerText : c.muted} />
            <Txt size="xs" color={late ? 'dangerText' : 'muted'}>
              {datetime(job.promised_at)}
            </Txt>
          </View>
        ) : null}
        <View style={styles.metaItem}>
          <Wrench size={14} color={c.muted} />
          <Txt size="xs" muted>
            {job.mechanic_name ?? t('jobs.no_mechanic')}
          </Txt>
        </View>
        {job.approval_lines ? <Chip label={t('jobs.waiting_approval', { n: job.approval_lines })} tone="warning" /> : null}
        {job.open_lines ? <Chip label={t('jobs.parts_pending', { n: job.open_lines })} tone="info" /> : null}
      </View>
    </Pressable>
  );
}

/** Header bell with the unread count (polls every 20 s). */
export function NotificationBell() {
  const { c } = useTheme();
  const { t } = useTranslation();
  const n = useNotifications();
  const unread = n.data?.unread ?? 0;
  return (
    <View>
      <IconButton icon={Bell} label={t('notifications.title')} onPress={() => router.push('/notifications')} />
      {unread ? (
        <View style={[styles.dot, { backgroundColor: c.danger }]} pointerEvents="none">
          <Txt size="xs" weight="bold" style={{ color: '#fff' }}>
            {unread > 99 ? '99+' : unread}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ request cards with line actions */

type SheetState = { kind: 'issue' | 'unavailable' | 'reject'; req: PartRequest; line: RequestLine } | null;

export function RequestCard({ req, showJob = true }: { req: PartRequest; showJob?: boolean }) {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const staff = hasRole(user, 'owner', 'inventory') && req.status === 'open';
  const [sheet, setSheet] = useState<SheetState>(null);
  const [linking, setLinking] = useState<RequestLine | null>(null);
  const [value, setValue] = useState('');

  const act = useWorkMutation((v: { path: string; body?: Record<string, unknown> }) => api.post(v.path, v.body ?? {}));
  const run = async (path: string, body: Record<string, unknown> | undefined, ok: string) => {
    try {
      await act.mutateAsync({ path, body });
      toast(ok);
      setSheet(null);
    } catch (e) {
      toastError(e);
    }
  };
  const base = (line: RequestLine) => `/requests/${req.id}/items/${line.id}`;
  const remaining = (l: RequestLine) => Number(l.qty) - Number(l.issued_qty);

  const lineButtons = (l: RequestLine) => {
    if (!staff) return null;
    if (l.status === 'needs_approval') {
      return (
        <View style={styles.actions}>
          <Button title={t('requests.approve')} icon={Check} small onPress={() => run(`${base(l)}/approve`, undefined, t('requests.approved_ok'))} needsOnline style={{ flex: 1 }} />
          <Button title={t('requests.reject')} icon={X} small variant="secondary" onPress={() => { setValue(''); setSheet({ kind: 'reject', req, line: l }); }} style={{ flex: 1 }} />
        </View>
      );
    }
    if (l.status !== 'requested' && l.status !== 'approved') return null;
    if (!l.part_id) {
      return (
        <View style={styles.actions}>
          <Button title={t('requests.link')} icon={Link2} small onPress={() => setLinking(l)} needsOnline style={{ flex: 1 }} />
          <Button title={t('requests.unavailable')} small variant="secondary" onPress={() => { setValue(''); setSheet({ kind: 'unavailable', req, line: l }); }} style={{ flex: 1 }} />
        </View>
      );
    }
    return (
      <View style={styles.actions}>
        <Button
          title={t('requests.issue')}
          icon={Package}
          small
          disabled={Number(l.current_stock) <= 0}
          onPress={() => {
            if (remaining(l) > 1) {
              setValue(qty(Math.min(remaining(l), Number(l.current_stock))));
              setSheet({ kind: 'issue', req, line: l });
            } else void run(`${base(l)}/issue`, {}, t('requests.issued_ok'));
          }}
          needsOnline
          style={{ flex: 1 }}
        />
        <Button title={t('requests.unavailable')} small variant="secondary" onPress={() => { setValue(''); setSheet({ kind: 'unavailable', req, line: l }); }} style={{ flex: 1 }} />
      </View>
    );
  };

  return (
    <Card padded={false}>
      <View style={{ padding: space[4], gap: 2 }}>
        {showJob ? (
          <Txt size="lg" weight="bold" color="primaryText" onPress={() => router.push(`/job/${req.job_card_id}`)}>
            {req.reg_no} <Txt muted>{req.job_no}</Txt>
          </Txt>
        ) : null}
        <Txt size="sm" muted>
          {req.requested_by_name} · {datetime(req.created_at)}
        </Txt>
        {req.note ? <Txt size="sm">{req.note}</Txt> : null}
      </View>
      {req.items.map((l) => (
        <View key={l.id}>
          <Divider />
          <View style={{ padding: space[4], gap: space[2] }}>
            <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt weight="semibold">{l.part_id ? nm(l) : l.custom_name}</Txt>
                {l.part_id ? (
                  <Txt size="sm" color="primaryText" weight="semibold">
                    {[nm(l, 'location'), l.rack ? `${t('parts.rack')} ${l.rack}` : ''].filter(Boolean).join(' · ') || l.part_no}
                  </Txt>
                ) : (
                  <Txt size="sm" muted>
                    {t('requests.free_text')}
                  </Txt>
                )}
                <Txt size="sm" muted>
                  {t('common.qty')} {qty(l.qty)}
                  {Number(l.issued_qty) && l.status !== 'issued' ? ` · ${t('requests.issued_of', { issued: qty(l.issued_qty), qty: qty(l.qty) })}` : ''}
                  {l.part_id && staff ? ` · ${t('requests.in_stock')} ${qty(l.current_stock)}` : ''}
                  {l.part_id && l.line_value ? ` · ${money(l.line_value)}` : ''}
                </Txt>
                {l.remark ? (
                  <Txt size="sm" muted>
                    {l.remark}
                  </Txt>
                ) : null}
              </View>
              <StatusChip status={l.status} />
            </View>
            {lineButtons(l)}
          </View>
        </View>
      ))}

      {sheet ? (
        <Sheet
          visible
          onClose={() => setSheet(null)}
          title={`${t(sheet.kind === 'issue' ? 'requests.issue' : sheet.kind === 'reject' ? 'requests.reject' : 'requests.unavailable')} · ${sheet.line.part_id ? nm(sheet.line) : sheet.line.custom_name}`}
        >
          <Field
            label={t(sheet.kind === 'issue' ? 'requests.issue_qty' : sheet.kind === 'reject' ? 'requests.reject_reason' : 'requests.remark')}
            value={value}
            onChangeText={setValue}
            keyboardType={sheet.kind === 'issue' ? 'decimal-pad' : 'default'}
            autoFocus
          />
          <Button
            title={t('common.confirm')}
            loading={act.isPending}
            needsOnline
            disabled={sheet.kind === 'reject' && !value.trim()}
            onPress={() => {
              const path = `${base(sheet.line)}/${sheet.kind}`;
              if (sheet.kind === 'issue') return run(path, { qty: Number(value.replace(',', '.')) }, t('requests.issued_ok'));
              if (sheet.kind === 'reject') return run(path, { reason: value.trim() }, t('requests.rejected_ok'));
              return run(path, { remark: value.trim() }, t('requests.unavailable_ok'));
            }}
          />
        </Sheet>
      ) : null}
      <PartPicker
        visible={!!linking}
        onClose={() => setLinking(null)}
        onPick={(p: Part) => {
          const l = linking;
          setLinking(null);
          if (l) void run(`${base(l)}/link`, { part_id: p.id }, t('requests.linked_ok'));
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { padding: space[4], borderWidth: 1, borderRadius: radius.card, gap: 4 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2], marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { flexDirection: 'row', gap: space[2] },
  dot: { position: 'absolute', top: 6, right: 6, minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },

});
