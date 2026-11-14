import { router, useLocalSearchParams } from 'expo-router';
import { Bike, Check, Plus, Search, UserPlus } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api, ApiError } from '@/api/client';
import { useMechanics, useWorkMutation } from '@/api/queries';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Chip, Field, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { money } from '@/format';
import { fieldError } from '@/i18n';
import { radius, size, space, touch, useTheme } from '@/theme';
import type { Customer, JobDetail, Lang } from '@/types';

const CHIPS = ['general_service', 'brake', 'starting', 'oil_leak', 'noise', 'clutch', 'electrical', 'puncture', 'pickup', 'chain'] as const;
const FUEL = ['E', '1/4', '1/2', '3/4', 'F'];

function promisedOptions() {
  const d = new Date();
  const iso = (x: Date, h: number) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(h)}:00:00`;
  };
  const tomorrow = new Date(d);
  tomorrow.setDate(d.getDate() + 1);
  return [
    { value: '', label: '—' },
    { value: iso(d, 18), label: '18:00' },
    { value: iso(tomorrow, 12), label: '+1 · 12:00' },
    { value: iso(tomorrow, 18), label: '+1 · 18:00' },
  ];
}

function Chips<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.chip, { borderColor: on ? c.primary : c.borderStrong, backgroundColor: on ? c.primarySoft : c.surface }]}
          >
            <Txt size="sm" weight="semibold">
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function NewJob() {
  const { t } = useTranslation();
  const { c, font } = useTheme();
  const params = useLocalSearchParams<{ customer?: string }>();
  const mechanics = useMechanics();
  const create = useWorkMutation((body: Record<string, unknown>) => api.post<{ item: JobDetail }>('/jobs', body));

  const [q, setQ] = useState('');
  const [found, setFound] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicleId, setVehicleId] = useState<number | 'new' | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cLang, setCLang] = useState<Lang>('mr');
  const [reg, setReg] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState<string | null>(null);
  const [complaint, setComplaint] = useState('');
  const [mechanicId, setMechanicId] = useState<number | null>(null);
  const [promised, setPromised] = useState(promisedOptions()[1].value);
  const [errs, setErrs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!params.customer) return;
    api.get<{ item: Customer }>(`/customers/${Number(params.customer)}`).then((r) => {
      setFound([r.item]);
      setCustomer(r.item);
      setVehicleId(r.item.vehicles[0]?.id ?? 'new');
      setQ(r.item.phone);
    }).catch(() => {});
  }, [params.customer]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3 || customer?.phone === term) return;
    const timer = setTimeout(() => {
      api.get<{ customers: Customer[]; reg_no: string | null; phone: string | null }>('/lookup', { q: term })
        .then((r) => {
          setFound(r.customers);
          if (!r.customers.length) {
            setIsNew(true);
            setCustomer(null);
            if (r.phone) setCPhone(r.phone);
            if (r.reg_no && !r.phone) setReg(r.reg_no);
          }
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [q, customer]);

  const addChip = (k: (typeof CHIPS)[number]) => {
    const text = t(`jobs.chips.${k}`);
    setComplaint((cur) => (cur.trim() ? `${cur.trim()}, ${text}` : text));
  };

  const submit = async () => {
    const body: Record<string, unknown> = {
      odometer: odometer || undefined,
      fuel_level: fuel || undefined,
      complaint,
      mechanic_id: mechanicId ?? undefined,
      promised_at: promised || undefined,
    };
    const e: Record<string, string> = {};
    if (isNew) {
      if (!cName.trim()) e.name = fieldError('required');
      if (!cPhone.trim()) e.phone = fieldError('required');
      if (!reg.trim()) e.reg_no = fieldError('required');
      body.customer = { name: cName, phone: cPhone, language: cLang };
      body.vehicle = { reg_no: reg, make, model };
    } else if (customer) {
      body.customer_id = customer.id;
      if (vehicleId === 'new' || vehicleId === null) {
        if (!reg.trim()) e.reg_no = fieldError('required');
        body.vehicle = { reg_no: reg, make, model };
      } else body.vehicle_id = vehicleId;
    } else {
      e.lookup = t('jobs.lookup_title');
    }
    setErrs(e);
    if (Object.keys(e).length) return;
    try {
      const res = await create.mutateAsync(body);
      toast(t('jobs.created_ok', { no: res.item.job_no }));
      router.push(`/job/${res.item.id}`);
      setQ('');
      setFound([]);
      setCustomer(null);
      setIsNew(false);
      setComplaint('');
      setOdometer('');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrs(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, fieldError(v)])));
      }
      toastError(err);
    }
  };

  const showNewBike = isNew || vehicleId === 'new';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: space[3] }}>
          <Txt weight="semibold">{t('jobs.lookup_title')}</Txt>
          <View style={[styles.search, { borderColor: errs.lookup ? c.danger : c.borderStrong, backgroundColor: c.bg }]}>
            <Search size={20} color={c.muted} />
            <TextInput
              value={q}
              onChangeText={(v) => {
                setQ(v);
                setCustomer(null);
                setIsNew(false);
              }}
              placeholder={t('jobs.lookup_placeholder')}
              placeholderTextColor={c.muted}
              autoCapitalize="characters"
              style={{ flex: 1, fontSize: size.lg, color: c.text, fontFamily: font('regular') }}
              accessibilityLabel={t('jobs.lookup_placeholder')}
            />
          </View>
          {!isNew &&
            found.map((cu) => {
              const chosen = customer?.id === cu.id;
              return (
                <View key={cu.id} style={[styles.cust, { borderColor: chosen ? c.primary : c.border }]}>
                  <Txt weight="semibold">{cu.name}</Txt>
                  <Txt size="sm" muted>
                    {cu.phone}
                    {cu.balance > 0 ? ` · ${t('customers.balance')} ${money(cu.balance)}` : ''}
                  </Txt>
                  {cu.open_job ? <Chip label={t('jobs.open_job_exists', { job: cu.open_job.job_no })} tone="warning" /> : null}
                  <View style={styles.chips}>
                    {cu.vehicles.map((v) => {
                      const on = chosen && vehicleId === v.id;
                      return (
                        <Pressable
                          key={v.id}
                          onPress={() => {
                            setCustomer(cu);
                            setVehicleId(v.id);
                          }}
                          style={[styles.chip, { borderColor: on ? c.primary : c.borderStrong, backgroundColor: on ? c.primarySoft : c.surface }]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                        >
                          <Bike size={16} color={c.text} />
                          <Txt size="sm" weight="semibold">
                            {v.reg_no}
                          </Txt>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      onPress={() => {
                        setCustomer(cu);
                        setVehicleId('new');
                      }}
                      style={[styles.chip, { borderColor: chosen && vehicleId === 'new' ? c.primary : c.borderStrong }]}
                      accessibilityRole="radio"
                    >
                      <Plus size={16} color={c.text} />
                      <Txt size="sm" weight="semibold">
                        {t('jobs.new_bike')}
                      </Txt>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          {errs.lookup ? <Banner tone="danger" text={errs.lookup} /> : null}
          {!isNew ? <Button title={t('jobs.new_customer')} icon={UserPlus} variant="secondary" small onPress={() => { setIsNew(true); setCustomer(null); }} /> : null}
          {isNew ? (
            <View style={{ gap: space[3] }}>
              <Field label={t('jobs.customer_name')} value={cName} onChangeText={setCName} error={errs.name} required />
              <Field label={t('common.phone')} value={cPhone} onChangeText={setCPhone} keyboardType="phone-pad" error={errs.phone} required />
              <Segmented<Lang> value={cLang} onChange={setCLang} options={[{ value: 'mr', label: 'मराठी' }, { value: 'en', label: 'English' }]} />
            </View>
          ) : null}
          {showNewBike ? (
            <View style={{ gap: space[3] }}>
              <Field label={t('jobs.reg_no')} value={reg} onChangeText={setReg} autoCapitalize="characters" placeholder="MH12AB1234" error={errs.reg_no} required />
              <View style={{ flexDirection: 'row', gap: space[2] }}>
                <View style={{ flex: 1 }}>
                  <Field label={t('jobs.make')} value={make} onChangeText={setMake} placeholder="Hero" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label={t('jobs.model')} value={model} onChangeText={setModel} placeholder="Splendor" />
                </View>
              </View>
            </View>
          ) : null}
        </Card>

        <Card style={{ gap: space[3] }}>
          <Field label={t('jobs.odometer')} value={odometer} onChangeText={setOdometer} keyboardType="number-pad" />
          <Txt size="sm" weight="semibold">
            {t('jobs.fuel')}
          </Txt>
          <Chips options={FUEL.map((f) => ({ value: f, label: f }))} value={fuel} onChange={setFuel} />
          <Txt size="sm" weight="semibold">
            {t('jobs.complaint')}
          </Txt>
          <View style={styles.chips}>
            {CHIPS.map((k) => (
              <Pressable key={k} onPress={() => addChip(k)} style={[styles.chip, { borderColor: c.borderStrong, backgroundColor: c.surface }]} accessibilityRole="button">
                <Txt size="sm">{t(`jobs.chips.${k}`)}</Txt>
              </Pressable>
            ))}
          </View>
          <Field label={t('jobs.complaint')} value={complaint} onChangeText={setComplaint} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
          <Txt size="sm" weight="semibold">
            {t('jobs.mechanic')}
          </Txt>
          <Chips options={(mechanics.data ?? []).map((m) => ({ value: m.id, label: m.name }))} value={mechanicId} onChange={setMechanicId} />
          <Txt size="sm" weight="semibold">
            {t('jobs.promised')}
          </Txt>
          <Chips options={promisedOptions()} value={promised} onChange={setPromised} />
        </Card>
        <Button title={t('jobs.create')} icon={Check} onPress={submit} loading={create.isPending} needsOnline />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: touch.button + 4 },
  cust: { borderWidth: 2, borderRadius: radius.card, padding: space[3], gap: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: space[3], minHeight: 40 },
});
