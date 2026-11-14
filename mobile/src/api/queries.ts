import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { api, ApiError } from './client';
import type { AppNotification, Customer, CustomerLedgerEntry, Dashboard, Invoice, InvoiceListItem, JobDetail, JobListItem, LabourRate, Ledger, Location, Paged, Part, PayMode, Purchase, PurchaseListItem, Reorder, RequestList, Supplier, SupplierLedgerEntry, User } from '@/types';

// Pause queries while offline; refetch when the app comes back to the foreground.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false))
);
AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 3600_000, // keep cached lists so screens open instantly and work offline
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

export const keys = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  parts: (p: Record<string, unknown>) => ['parts', p] as const,
  part: (id: number) => ['part', id] as const,
  ledger: (id: number) => ['ledger', id] as const,
  locations: ['locations'] as const,
};

export function useMe(enabled = true) {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<{ user: User; can_see_cost: boolean }>('/auth/me'),
    enabled,
  });
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<Dashboard>('/dashboard') });
}

export function useParts(params: { q?: string; location?: number; rack?: string; low?: boolean; sort?: string; per_page?: number }) {
  return useQuery({
    queryKey: keys.parts(params),
    queryFn: () => api.get<Paged<Part>>('/parts', { per_page: 100, ...params }),
    placeholderData: (prev) => prev,
  });
}

export function usePart(id: number) {
  return useQuery({ queryKey: keys.part(id), queryFn: () => api.get<{ item: Part }>(`/parts/${id}`).then((r) => r.item) });
}

export function useLedger(id: number, perPage = 50) {
  return useQuery({ queryKey: [...keys.ledger(id), perPage], queryFn: () => api.get<Ledger>(`/parts/${id}/ledger`, { per_page: perPage }) });
}

export function useLocations() {
  return useQuery({
    queryKey: keys.locations,
    queryFn: () => api.get<Paged<Location>>('/locations').then((r) => r.items),
    staleTime: 10 * 60_000,
  });
}

export function useAdjustStock(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { qty: number; reason: string }) => api.post<{ item: Part }>(`/parts/${id}/adjust`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.part(id) });
      void qc.invalidateQueries({ queryKey: keys.ledger(id) });
      void qc.invalidateQueries({ queryKey: ['parts'] });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export function usePostStockCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { location_id: number; note?: string; lines: { part_id: number; counted: number }[] }) =>
      api.post<{ id: number; lines_counted: number; lines_changed: number }>('/stock-counts', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['parts'] });
      void qc.invalidateQueries({ queryKey: ['part'] });
      void qc.invalidateQueries({ queryKey: ['ledger'] });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

/* ------------------------------------------------------------------ Phase 2: suppliers, purchases, reorder */

export function useSuppliers(q = '') {
  return useQuery({
    queryKey: ['suppliers', q],
    queryFn: () => api.get<Paged<Supplier> & { payable_total: number }>('/suppliers', { q, per_page: 200 }),
    placeholderData: (prev) => prev,
  });
}

export function useSupplierLedger(id: number) {
  return useQuery({
    queryKey: ['supplier-ledger', id],
    queryFn: () => api.get<{ supplier: Supplier; items: SupplierLedgerEntry[]; balance: number }>(`/suppliers/${id}/ledger`),
  });
}

export function usePurchases() {
  return useQuery({ queryKey: ['purchases'], queryFn: () => api.get<Paged<PurchaseListItem> & { sum_total: number }>('/purchases', { per_page: 50 }) });
}

export function usePurchase(id: number) {
  return useQuery({ queryKey: ['purchase', id], queryFn: () => api.get<{ item: Purchase }>(`/purchases/${id}`).then((r) => r.item) });
}

export function useReorder() {
  return useQuery({ queryKey: ['reorder'], queryFn: () => api.get<Reorder>('/reorder') });
}

function invalidatePurchasing(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['suppliers', 'supplier-ledger', 'purchases', 'purchase', 'reorder', 'parts', 'part', 'ledger', 'dashboard']) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
}

export function useSavePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ item: Purchase }>('/purchases', body),
    onSuccess: () => invalidatePurchasing(qc),
  });
}

export function useSupplierPayment(supplierId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { amount: number; mode: PayMode; reference?: string; purchase_id?: number }) =>
      api.post<{ item: Supplier }>(`/suppliers/${supplierId}/payments`, body),
    onSuccess: () => invalidatePurchasing(qc),
  });
}

/* ------------------------------------------------------------------ Phase 3: jobs, requests, customers, notifications */

const POLL = 20_000;

export function useJobs(params: { active?: boolean; q?: string; status?: string } = { active: true }) {
  return useQuery({ queryKey: ['jobs', params], queryFn: () => api.get<Paged<JobListItem>>('/jobs', { per_page: 200, ...params }), placeholderData: (p) => p });
}

export function useJob(id: number) {
  return useQuery({ queryKey: ['job', id], queryFn: () => api.get<{ item: JobDetail }>(`/jobs/${id}`).then((r) => r.item), refetchInterval: POLL });
}

/** Queue / approvals / my requests; refreshed every 20 s while the screen is visible. */
export function useRequests(params: { status?: string; tab?: string; mine?: boolean }) {
  return useQuery({ queryKey: ['requests', params], queryFn: () => api.get<RequestList>('/requests', { per_page: 100, ...params }), refetchInterval: POLL });
}

export function useNotifications() {
  return useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: AppNotification[]; unread: number }>('/notifications'), refetchInterval: POLL });
}

export function useLabourRates() {
  return useQuery({ queryKey: ['labour-rates'], queryFn: () => api.get<Paged<LabourRate>>('/labour-rates').then((r) => r.items), staleTime: 10 * 60_000 });
}

export function useMechanics() {
  return useQuery({ queryKey: ['mechanics'], queryFn: () => api.get<Paged<{ id: number; name: string }>>('/users/mechanics').then((r) => r.items), staleTime: 10 * 60_000 });
}

export function useCustomers(q: string) {
  return useQuery({ queryKey: ['customers', q], queryFn: () => api.get<Paged<Customer>>('/customers', { q, per_page: 100 }), placeholderData: (p) => p });
}

export function useCustomer(id: number) {
  return useQuery({ queryKey: ['customer', id], queryFn: () => api.get<{ item: Customer }>(`/customers/${id}`).then((r) => r.item) });
}

/** Any POST/PUT/DELETE that changes job or request state; refreshes the related lists afterwards. */
export function useWorkMutation<TBody, TRes = unknown>(fn: (body: TBody) => Promise<TRes>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of ['jobs', 'job', 'requests', 'notifications', 'parts', 'part', 'ledger', 'dashboard', 'customers', 'customer', 'reorder']) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    },
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: Record<string, string> }>('/settings').then((r) => r.settings),
    staleTime: 10 * 60_000,
  });
}

/* ------------------------------------------------------------------ Phase 4: billing */

export function useInvoices(params: { q?: string; status?: string; pay_status?: string }) {
  return useQuery({
    queryKey: ['invoices', params],
    queryFn: () => api.get<Paged<InvoiceListItem> & { sum_total: number; sum_due: number }>('/invoices', { per_page: 100, ...params }),
    placeholderData: (p) => p,
  });
}

export function useInvoice(id: number) {
  return useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<{ item: Invoice }>(`/invoices/${id}`).then((r) => r.item) });
}

export function useCustomerLedger(id: number) {
  return useQuery({
    queryKey: ['customer-ledger', id],
    queryFn: () => api.get<{ items: CustomerLedgerEntry[]; balance: number; open_invoices: { id: number; invoice_no: string; balance: number }[] }>(`/customers/${id}/ledger`),
  });
}

export function useBillingMutation<TBody, TRes = unknown>(fn: (body: TBody) => Promise<TRes>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of ['invoices', 'invoice', 'customer-ledger', 'customer', 'customers', 'jobs', 'job', 'parts', 'part', 'ledger', 'dashboard']) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    },
  });
}
