import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Bike, Camera, Check, Plus, Search, UserPlus, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api, ApiError } from '@/api/client';
import { useMechanics, useSettings, useWorkMutation } from '@/api/queries';
import { toast, toastError } from '@/components/toast';
import { Banner, Button, Card, Chip, Field, OfflineBanner, Segmented, Txt } from '@/components/ui';
import { money } from '@/format';
import { fieldError } from '@/i18n';
import { radius, size, space, touch, useTheme } from '@/theme';
import type { Customer, JobDetail, Lang } from '@/types';

const CHIPS = ['general_service', 'brake', 'starting', 'oil_leak', 'noise', 'clutch', 'electrical', 'puncture', 'pickup', 'chain'] as const;
const FUEL = ['E', '1/4', '1/2', '3/4', 'F'];

/** What POST /jobs/scan-card returns for a photo of a handwritten paper job card. */
interface ScanResult {
  scan_id: string;
  fields: {
    customer_name: string | null;
    phone: string | null;
    reg_no: string | null;
    make: string | null;
    model: string | null;
    odometer: number | null;
    fuel_level: string | null;
    complaint: string | null;
    mechanic_id: number | null;
    promised_at: string | null;
  };
  unclear: string[];
  match: { customer: Customer | null; vehicle_id: number | null };
}
const SCAN_LABEL: Record<string, string> = {
  customer_name: 'jobs.customer_name',
  phone: 'common.phone',
  reg_no: 'jobs.reg_no',
  make: 'jobs.make',
  model: 'jobs.model',
  odometer: 'jobs.odometer',
  fuel_level: 'jobs.fuel',
  complaint: 'jobs.complaint',
  mechanic: 'jobs.mechanic',
  promised_at: 'jobs.promised',
};

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
  const settings = useSettings();
  const scanEnabled = settings.data?.job_card_scan === '1';
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
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<{ id: string; uri: string; unclear: string[] } | null>(null);
  const [showCard, setShowCard] = useState(false);
  const [promisedExtra, setPromisedExtra] = useState<string | null>(null);

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

  /** Photo of the handwritten paper card → the server reads it → fill the form; staff check and save. */
  const scanCard = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (shot.canceled || !shot.assets[0]) return;
    const uri = shot.assets[0].uri;
    setScanning(true);
    try {
      const fd = new FormData();
      fd.append('photo', { uri, name: 'card.jpg', type: 'image/jpeg' } as unknown as Blob);
      const r = await api.upload<ScanResult>('/jobs/scan-card', fd);
      const f = r.fields;
      const cu = r.match.customer;
      if (cu) {
        setFound([cu]);
        setCustomer(cu);
        setIsNew(false);
        setQ(cu.phone);
        setVehicleId(r.match.vehicle_id ?? 'new');
      } else {
        setFound([]);
        setCustomer(null);
        setIsNew(true);
        setQ('');
        setCName(f.customer_name ?? '');
        setCPhone(f.phone ?? '');
      }
      if (!r.match.vehicle_id) {
        setReg(f.reg_no ?? '');
        setMake(f.make ?? '');
        setModel(f.model ?? '');
      }
      if (f.odometer !== null) setOdometer(String(f.odometer));
      if (f.fuel_level) setFuel(f.fuel_level);
      if (f.complaint) setComplaint(f.complaint);
      if (f.mechanic_id) setMechanicId(f.mechanic_id);
      if (f.promised_at) {
        setPromisedExtra(f.promised_at);
        setPromised(f.promised_at);
      }
      setErrs({});
      setScan({ id: r.scan_id, uri, unclear: r.unclear });
      toast(t('jobs.scan_done'));
    } catch (e) {
      toastError(e);
    } finally {
      setScanning(false);
    }
  };

  const promisedChoices = () => {
    const base = promisedOptions();
    if (promisedExtra && !base.some((o) => o.value === promisedExtra)) {
      base.push({ value: promisedExtra, label: `${promisedExtra.slice(8, 10)}-${promisedExtra.slice(5, 7)} ${promisedExtra.slice(11, 16)}` });
    }
    return base;
  };

  const submit = async () => {
    const body: Record<string, unknown> = {
      odometer: odometer || undefined,
      fuel_level: fuel || undefined,
      complaint,
      mechanic_id: mechanicId ?? undefined,
      promised_at: promised || undefined,
      scan_id: scan?.id,
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
      setScan(null);
      setPromisedExtra(null);
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
        {scanEnabled ? (
          <Card style={{ gap: space[3] }}>
            <Button title={scanning ? t('jobs.scan_reading') : t('jobs.scan_card')} icon={Camera} variant="secondary" onPress={scanCard} loading={scanning} needsOnline />
            {scan ? (
              <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
                <Pressable onPress={() => setShowCard(true)} accessibilityRole="imagebutton" accessibilityLabel={t('jobs.scan_view')}>
                  <Image source={{ uri: scan.uri }} style={[styles.thumb, { borderColor: c.border }]} />
                </Pressable>
                <View style={{ flex: 1, gap: space[2] }}>
                  <Txt size="sm">{t('jobs.scan_done')}</Txt>
                  {scan.unclear.length ? (
                    <Banner tone="warning" text={t('jobs.scan_check', { fields: scan.unclear.map((k) => t(SCAN_LABEL[k] ?? k)).join(', ') })} />
                  ) : null}
                </View>
              </View>
            ) : (
              <Txt size="sm" muted>
                {t('jobs.scan_hint')}
              </Txt>
            )}
          </Card>
        ) : null}
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
          <Chips options={promisedChoices()} value={promised} onChange={setPromised} />
        </Card>
        <Button title={t('jobs.create')} icon={Check} onPress={submit} loading={create.isPending} needsOnline />
      </ScrollView>
      <Modal visible={showCard && !!scan} transparent animationType="fade" onRequestClose={() => setShowCard(false)}>
        <View style={styles.viewer}>
          {scan ? <Image source={{ uri: scan.uri }} style={{ flex: 1 }} resizeMode="contain" accessibilityLabel={t('jobs.scan_view')} /> : null}
          <Button title={t('common.close')} icon={X} variant="secondary" onPress={() => setShowCard(false)} />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderRadius: radius.input, paddingHorizontal: space[3], minHeight: touch.button + 4 },
  cust: { borderWidth: 2, borderRadius: radius.card, padding: space[3], gap: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: space[3], minHeight: 40 },
  thumb: { width: 72, height: 96, borderRadius: radius.input, borderWidth: 1 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', padding: space[4], paddingTop: space[10], gap: space[4] },
});
