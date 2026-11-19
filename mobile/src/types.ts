export type Role = 'owner' | 'inventory' | 'front_desk' | 'mechanic';
export type Lang = 'mr' | 'en';

export interface User {
  id: number;
  name: string;
  username: string;
  phone: string | null;
  role: Role;
  language: Lang;
  must_change_password: number;
  active: number;
  /** Effective permissions (role defaults + the owner's ticks); owners have all. */
  perms?: Partial<Record<Perm, boolean>>;
}

export type Perm = 'see_money' | 'see_costs' | 'make_bills' | 'give_discount' | 'cancel_bills' | 'jobs' | 'customers' | 'edit_parts' | 'purchases' | 'issue_parts' | 'reports' | 'cash_book';

export interface PublicInfo {
  app: string;
  shop_name: string;
  shop_name_mr: string;
  min_app_version: string;
  latest_app_url: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface Named {
  name_en: string;
  name_mr: string | null;
}

export interface Location extends Named {
  id: number;
  sort_order: number;
  active: number;
}

export interface Part {
  id: number;
  part_no: string;
  name_en: string;
  name_mr: string | null;
  category_id: number | null;
  category_en: string | null;
  category_mr: string | null;
  location_id: number | null;
  location_en: string | null;
  location_mr: string | null;
  rack: string | null;
  brand: string | null;
  compatible_models: string | null;
  unit: string;
  hsn: string | null;
  gst_rate: number;
  selling_price: number;
  current_stock: number;
  min_stock: number;
  is_low: number;
  active: number;
  open_request_qty?: number;
  // owner / inventory manager only
  last_purchase_price?: number;
  last_purchase_disc_pct?: number;
  avg_cost?: number;
  stock_value?: number;
}

export interface Movement {
  id: number;
  part_id: number;
  qty: number;
  balance_after: number;
  mtype: string;
  ref_type: string | null;
  ref_id: number | null;
  ref_label: string | null;
  unit_cost?: number;
  note: string | null;
  user_name: string | null;
  created_at: string;
}

export interface Ledger extends Paged<Movement> {
  part: Part;
  ledger_sum: number;
  balanced: boolean;
}

export interface Dashboard {
  role: Role;
  stock: { parts: number; low_stock_count: number; out_of_stock: number; stock_value?: number };
  low_stock: (Part & { location_en: string | null; location_mr: string | null })[];
  jobs_by_status: Record<string, number>;
  delivered_today: number;
  open_requests: number;
  approvals_waiting: number;
  money?: { sales_today: number; by_mode: Record<string, number>; credit_today: number; customer_dues: number; supplier_payables: number; sales_30d: { date: string; total: number }[] };
  sales?: { today: BillSum; month: BillSum; latest: { id: number; invoice_no: string; invoice_date: string; grand_total: number; balance: number; customer_name: string | null; reg_no: string | null }[] };
  purchases?: { today: BillSum; month: BillSum; latest: { id: number; bill_no: string; bill_date: string; total: number; due: number; supplier_name: string }[] };
}

export interface BillSum {
  count: number;
  total: number;
}

export type PayMode = 'cash' | 'upi' | 'bank' | 'card' | 'credit';

export interface Supplier {
  id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  gstin: string | null;
  state_code: string;
  state_name?: string;
  address: string | null;
  opening_balance: number;
  balance: number;
  active: number;
}

export interface SupplierLedgerEntry {
  date: string;
  type: 'opening' | 'bill' | 'payment';
  ref: string | null;
  ref_id: number | null;
  bill: number;
  paid: number;
  balance: number;
  note: string | null;
  mode: PayMode | null;
}

export interface PurchaseListItem {
  id: number;
  bill_no: string;
  bill_date: string;
  total: number;
  payment_mode: PayMode;
  supplier_id: number;
  supplier_name: string;
  line_count: number;
  status: 'final' | 'cancelled';
}

export interface PurchaseItem {
  id: number;
  part_id: number;
  part_no: string;
  name_en: string;
  name_mr: string | null;
  unit: string;
  qty: number;
  price: number;
  disc_pct: number;
  mrp: number | null;
  net_cost: number;
  gst_rate: number;
  taxable: number;
  tax_amount: number;
  line_total: number;
}

export type PriceMode = 'mrp' | 'net';

export interface Purchase extends PurchaseListItem {
  is_interstate: number;
  price_mode: PriceMode;
  photo: string | null;
  supplier_contact: string | null;
  supplier_phone: string | null;
  taxable_total: number;
  cgst: number;
  sgst: number;
  igst: number;
  other_charges: number;
  round_off: number;
  notes: string | null;
  user_name: string | null;
  supplier_gstin: string | null;
  items: PurchaseItem[];
  payments: { id: number; amount: number; mode: PayMode; reference: string | null; paid_on: string; user_name: string | null }[];
  paid: number;
  cancel_reason: string | null;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
  replaced_by_bill: { id: number; bill_no: string } | null;
  replaces_bill: { id: number; bill_no: string } | null;
}

export interface BillTotals {
  taxable_total: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax_total: number;
  other_charges: number;
  round_off: number;
  grand_total: number;
}

export interface PurchasePreview {
  interstate: boolean;
  price_mode: PriceMode;
  lines: { part_id: number; taxable: number; tax_amount: number; line_total: number }[];
  totals: BillTotals;
}

export interface ReorderItem {
  part_id: number;
  part_no: string;
  name_en: string;
  name_mr: string | null;
  unit: string;
  rack: string | null;
  current_stock: number;
  min_stock: number;
  qty_short: number;
  reasons: ('low' | 'unavailable')[];
  suggested_qty: number;
  last_purchase_price: number;
  last_bought: string | null;
}

export interface Reorder {
  groups: { supplier: { id: number; name: string; phone: string | null } | null; items: ReorderItem[] }[];
  unlinked: { custom_name: string; qty: number }[];
  total_items: number;
}

/* ------------------------------------------------------------------ Phase 3 */

export type JobStatus = 'pending' | 'estimate_sent' | 'approved' | 'in_progress' | 'waiting_parts' | 'ready' | 'delivered' | 'cancelled';
export type LineStatus = 'requested' | 'needs_approval' | 'approved' | 'issued' | 'unavailable' | 'rejected' | 'cancelled';

export interface JobListItem {
  id: number;
  job_no: string;
  status: JobStatus;
  complaint: string | null;
  promised_at: string | null;
  created_at: string;
  mechanic_id: number | null;
  mechanic_name: string | null;
  customer_name: string;
  customer_phone: string;
  reg_no: string;
  make: string | null;
  model: string | null;
  open_lines: number;
  approval_lines: number;
}

export interface RequestLine {
  id: number;
  request_id: number;
  part_id: number | null;
  custom_name: string | null;
  part_no: string | null;
  name_en: string | null;
  name_mr: string | null;
  unit: string | null;
  rack: string | null;
  location_en: string | null;
  location_mr: string | null;
  current_stock: number | null;
  qty: number;
  issued_qty: number;
  line_value: number;
  status: LineStatus;
  remark: string | null;
  approved_by_name: string | null;
}

export interface PartRequest {
  id: number;
  job_card_id: number;
  job_no?: string;
  reg_no?: string;
  make?: string | null;
  model?: string | null;
  mechanic_name?: string | null;
  requested_by_name: string;
  status: 'open' | 'closed' | 'cancelled';
  note: string | null;
  created_at: string;
  items: RequestLine[];
}

export interface RequestList extends Paged<PartRequest> {
  counts: { open: number; approvals: number };
  approval_limit: number;
}

export interface EstimateItem {
  id: number;
  item_type: 'part' | 'labour';
  part_id: number | null;
  description: string;
  description_mr: string | null;
  qty: number;
  unit_price: number;
  amount: number;
}

export interface Estimate {
  id: number;
  est_no: string;
  version: number;
  status: 'draft' | 'sent' | 'approved' | 'rejected' | 'superseded';
  grand_total: number;
  parts_total: number;
  labour_total: number;
  sent_at: string | null;
  approved_at: string | null;
  approved_via: 'link' | 'call' | null;
  items: EstimateItem[];
}

export interface NextService {
  on: string | null;
  km: number | null;
  /** false = the usual gap from Settings */
  custom: boolean;
}

export interface JobDetail extends JobListItem {
  next_service: NextService;
  customer_id: number;
  vehicle_id: number;
  year: number | null;
  odometer: number | null;
  fuel_level: string | null;
  inspection_notes: string | null;
  approved_estimate_id: number | null;
  invoice_id: number | null;
  estimates: Estimate[];
  labour: { id: number; description: string; description_mr: string | null; amount: number; user_id: number | null; item_kind?: 'labour' | 'part'; qty?: number }[];
  /** issued 0 = planned from the approved estimate (leaves stock when the bill is finalised). */
  parts: { id: number; part_id: number; part_no: string; name_en: string; name_mr: string | null; unit: string; qty: number; returned_qty: number; issued: number; unit_price: number; issued_at: string | null; issued_by_name: string | null }[];
  requests: PartRequest[];
  photos: { id: number; created_at: string }[];
  money: { parts_total: number; labour_total: number; current_total: number; approved_total: number | null; revised_needed: boolean; revision_pending: boolean };
  timeline: { action: string; data: Record<string, unknown> | null; created_at: string; user_name: string | null }[];
  allowed_status: JobStatus[];
  can_approve: boolean;
  invoice: { id: number; invoice_no: string | null; status: 'draft' | 'final' | 'cancelled'; grand_total: number; balance: number; pay_status: string } | null;
}

export interface LabourRate {
  id: number;
  name_en: string;
  name_mr: string | null;
  amount: number;
}

export interface Vehicle {
  id: number;
  reg_no: string;
  make: string | null;
  model: string | null;
  year: number | null;
  last_odometer: number | null;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  language: Lang;
  balance: number;
  is_trusted: number;
  credit_limit: number;
  vehicles: Vehicle[];
  reg_nos?: string | null;
  open_job?: { id: number; job_no: string; status: JobStatus; vehicle_id: number } | null;
  jobs?: { id: number; job_no: string; status: JobStatus; created_at: string; reg_no: string; invoice_total: number | null }[];
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ Phase 4 */

export interface InvoiceListItem {
  id: number;
  invoice_no: string | null;
  invoice_date: string | null;
  inv_type: 'job' | 'counter';
  status: 'draft' | 'final' | 'cancelled';
  pay_status: 'paid' | 'partial' | 'unpaid';
  grand_total: number;
  paid_total: number;
  balance: number;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  job_no: string | null;
  reg_no: string | null;
}

export interface InvoiceItem {
  id: number;
  item_type: 'part' | 'labour';
  part_id: number | null;
  part_no?: string | null;
  job_part_id: number | null;
  job_labour_id: number | null;
  description_en: string;
  description_mr: string | null;
  hsn: string | null;
  qty: number;
  unit_price: number;
  disc_pct: number;
  /** One unit after its discounts (shown next to the MRP). */
  rate: number;
  gst_rate: number;
  line_total: number;
  returned_qty?: number;
}

export interface InvoiceReturn {
  id: number;
  return_no: string;
  return_date: string;
  total: number;
  refund_amount: number;
  refund_mode: 'cash' | 'upi' | 'bank' | null;
  reason: string;
  user_name: string | null;
}

export interface Invoice extends InvoiceListItem {
  job_card_id: number | null;
  job_status: JobStatus | null;
  customer_id: number | null;
  cust_name: string | null;
  cust_phone: string | null;
  is_trusted: number | null;
  credit_limit: number | null;
  is_interstate: number;
  /** 0 for bills made before GST registration (no tax lines). */
  gst_registered?: number;
  bill_disc_pct: number;
  discount_total: number;
  taxable_total: number;
  cgst: number;
  sgst: number;
  igst: number;
  round_off: number;
  cancel_reason: string | null;
  returned_total?: number;
  returns?: InvoiceReturn[];
  items: InvoiceItem[];
  payments: { id: number; mode: PayMode; reference: string | null; received_on: string; amount: number }[];
}

export interface CustomerLedgerEntry {
  date: string;
  type: 'opening' | 'invoice' | 'payment' | 'return' | 'refund';
  ref: string | null;
  ref_id: number | null;
  debit: number;
  credit: number;
  balance: number;
  mode: PayMode | null;
}
