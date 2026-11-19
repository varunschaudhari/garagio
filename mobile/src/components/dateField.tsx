import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { CalendarDays, X } from 'lucide-react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { date as dmy } from '@/format';
import { radius, space, touch, useTheme } from '@/theme';
import { IconButton, Txt } from './ui';

/** "2026-11-19" for a picked day (local time, not UTC). */
export function isoDay(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fromIso(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
}

/**
 * A date picked from the phone's calendar (no typing, so never an invalid date). value / min / max are
 * "YYYY-MM-DD"; clearable shows an × to empty it.
 */
export function DateField({ label, value, onChange, min, max, clearable, required, hint, error }: {
  label: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  min?: string;
  max?: string;
  clearable?: boolean;
  required?: boolean;
  hint?: string;
  error?: string;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const open = () =>
    DateTimePickerAndroid.open({
      value: fromIso(value) ?? fromIso(max) ?? new Date(),
      mode: 'date',
      minimumDate: fromIso(min),
      maximumDate: fromIso(max),
      onChange: (event, picked) => {
        if (event.type === 'set' && picked) onChange(isoDay(picked));
      },
    });
  return (
    <View style={{ gap: 6 }}>
      <Txt size="sm" weight="semibold">
        {label}
        {required ? <Txt color="danger"> *</Txt> : null}
      </Txt>
      <View style={[styles.wrap, { borderColor: error ? c.danger : c.borderStrong, backgroundColor: c.surface }]}>
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${label}: ${value ? dmy(value) : t('fields.pick_date')}`} style={styles.press}>
          <CalendarDays size={20} color={c.muted} />
          <Txt size="lg" weight={value ? 'semibold' : 'regular'} color={value ? 'text' : 'muted'} style={{ flex: 1 }}>
            {value ? dmy(value) : t('fields.pick_date')}
          </Txt>
        </Pressable>
        {clearable && value ? <IconButton icon={X} label={t('common.clear')} color={c.muted} onPress={() => onChange(null)} /> : null}
      </View>
      {error ? (
        <Txt size="sm" color="dangerText">
          {error}
        </Txt>
      ) : hint ? (
        <Txt size="sm" muted>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.input, minHeight: touch.button },
  press: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: space[2], minHeight: touch.button },
});
