-- Garage Manager (Trimurti Auto) - full schema
-- MySQL 5.7+/8.0, MariaDB 10.4+ . Import in phpMyAdmin before seed.sql.
-- Timestamps are set by PHP in Asia/Kolkata. Statuses are VARCHAR validated in PHP.

-- Import into an EMPTY database. It deliberately has no DROP statements, so an
-- accidental re-import on a live database fails instead of wiping data.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  skey VARCHAR(64) NOT NULL,
  svalue TEXT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_settings_key (skey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL,
  phone VARCHAR(15) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  permissions TEXT NULL,
  language VARCHAR(2) NOT NULL DEFAULT 'mr',
  push_token VARCHAR(255) NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_users_username (username),
  KEY ix_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  success TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  KEY ix_login_attempts (username, ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE storage_locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name_en VARCHAR(60) NOT NULL,
  name_mr VARCHAR(60) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NULL,
  updated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name_en VARCHAR(80) NOT NULL,
  name_mr VARCHAR(80) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NULL,
  updated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE parts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  part_no VARCHAR(40) NOT NULL,
  name_en VARCHAR(150) NOT NULL,
  name_mr VARCHAR(150) NULL,
  category_id INT NULL,
  brand VARCHAR(60) NULL,
  compatible_models VARCHAR(255) NULL,
  unit VARCHAR(10) NOT NULL DEFAULT 'pcs',
  hsn VARCHAR(10) NULL,
  gst_rate DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  last_purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  last_purchase_disc_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  avg_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  location_id INT NULL,
  rack VARCHAR(20) NULL,
  current_stock DECIMAL(10,2) NOT NULL DEFAULT 0,
  min_stock DECIMAL(10,2) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_parts_part_no (part_no),
  KEY ix_parts_name_en (name_en),
  KEY ix_parts_name_mr (name_mr),
  KEY ix_parts_loc_rack (location_id, rack),
  CONSTRAINT fk_parts_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_parts_location FOREIGN KEY (location_id) REFERENCES storage_locations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  part_id INT NOT NULL,
  qty DECIMAL(10,2) NOT NULL,
  balance_after DECIMAL(10,2) NOT NULL,
  mtype VARCHAR(20) NOT NULL,
  ref_type VARCHAR(20) NULL,
  ref_id INT NULL,
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_sm_part (part_id, id),
  KEY ix_sm_ref (ref_type, ref_id),
  KEY ix_sm_created (created_at),
  CONSTRAINT fk_sm_part FOREIGN KEY (part_id) REFERENCES parts(id),
  CONSTRAINT fk_sm_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_counts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_id INT NULL,
  lines_counted INT NOT NULL DEFAULT 0,
  lines_changed INT NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  CONSTRAINT fk_sc_location FOREIGN KEY (location_id) REFERENCES storage_locations(id),
  CONSTRAINT fk_sc_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(15) NULL,
  gstin VARCHAR(15) NULL,
  state_code VARCHAR(2) NOT NULL DEFAULT '27',
  address VARCHAR(255) NULL,
  opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_suppliers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  bill_no VARCHAR(40) NOT NULL,
  bill_date DATE NOT NULL,
  is_interstate TINYINT(1) NOT NULL DEFAULT 0,
  taxable_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  cgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_charges DECIMAL(12,2) NOT NULL DEFAULT 0,
  round_off DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_mode VARCHAR(10) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'final',
  notes VARCHAR(255) NULL,
  cancel_reason VARCHAR(255) NULL,
  cancelled_by INT NULL,
  cancelled_at DATETIME NULL,
  replaced_by INT NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_purchase_bill (supplier_id, bill_no),
  KEY ix_purchases_date (bill_date),
  CONSTRAINT fk_purchases_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_purchases_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE purchase_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT NOT NULL,
  part_id INT NOT NULL,
  qty DECIMAL(10,2) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  disc_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  net_cost DECIMAL(12,4) NOT NULL,
  gst_rate DECIMAL(5,2) NOT NULL,
  taxable DECIMAL(12,2) NOT NULL,
  cgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  CONSTRAINT fk_pi_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  CONSTRAINT fk_pi_part FOREIGN KEY (part_id) REFERENCES parts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supplier_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  purchase_id INT NULL,
  amount DECIMAL(12,2) NOT NULL,
  mode VARCHAR(10) NOT NULL,
  reference VARCHAR(60) NULL,
  paid_on DATE NOT NULL,
  note VARCHAR(255) NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_sp_supplier (supplier_id, paid_on),
  CONSTRAINT fk_sp_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_sp_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  CONSTRAINT fk_sp_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(15) NOT NULL,
  alt_phone VARCHAR(15) NULL,
  address VARCHAR(255) NULL,
  gstin VARCHAR(15) NULL,
  state_code VARCHAR(2) NOT NULL DEFAULT '27',
  language VARCHAR(2) NOT NULL DEFAULT 'mr',
  is_trusted TINYINT(1) NOT NULL DEFAULT 0,
  credit_limit DECIMAL(12,2) NOT NULL DEFAULT 0,
  opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_customers_phone (phone),
  KEY ix_customers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  reg_no VARCHAR(15) NOT NULL,
  make VARCHAR(40) NULL,
  model VARCHAR(60) NULL,
  year SMALLINT NULL,
  last_odometer INT NULL,
  last_service_on DATE NULL,
  last_service_odometer INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_vehicles_reg (reg_no),
  CONSTRAINT fk_vehicles_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE labour_rates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name_en VARCHAR(100) NOT NULL,
  name_mr VARCHAR(100) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NULL,
  updated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE job_cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_no VARCHAR(20) NOT NULL,
  customer_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  odometer INT NULL,
  fuel_level VARCHAR(10) NULL,
  complaint TEXT NULL,
  inspection_notes TEXT NULL,
  mechanic_id INT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  promised_at DATETIME NULL,
  approved_estimate_id INT NULL,
  invoice_id INT NULL,
  delivered_at DATETIME NULL,
  cancel_reason VARCHAR(255) NULL,
  created_by INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_job_no (job_no),
  KEY ix_jobs_status (status),
  KEY ix_jobs_mechanic (mechanic_id, status),
  KEY ix_jobs_vehicle (vehicle_id),
  CONSTRAINT fk_jobs_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_jobs_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_jobs_mechanic FOREIGN KEY (mechanic_id) REFERENCES users(id),
  CONSTRAINT fk_jobs_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE job_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_card_id INT NOT NULL,
  path VARCHAR(255) NOT NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  CONSTRAINT fk_photos_job FOREIGN KEY (job_card_id) REFERENCES job_cards(id),
  CONSTRAINT fk_photos_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE job_labour (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_card_id INT NOT NULL,
  labour_rate_id INT NULL,
  item_kind VARCHAR(10) NOT NULL DEFAULT 'labour',
  qty DECIMAL(10,2) NOT NULL DEFAULT 1,
  description VARCHAR(150) NOT NULL,
  description_mr VARCHAR(150) NULL,
  amount DECIMAL(12,2) NOT NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  CONSTRAINT fk_jl_job FOREIGN KEY (job_card_id) REFERENCES job_cards(id),
  CONSTRAINT fk_jl_rate FOREIGN KEY (labour_rate_id) REFERENCES labour_rates(id),
  CONSTRAINT fk_jl_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE part_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_card_id INT NOT NULL,
  requested_by INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  note VARCHAR(255) NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_pr_status (status, id),
  CONSTRAINT fk_pr_job FOREIGN KEY (job_card_id) REFERENCES job_cards(id),
  CONSTRAINT fk_pr_user FOREIGN KEY (requested_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE part_request_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  part_id INT NULL,
  custom_name VARCHAR(150) NULL,
  qty DECIMAL(10,2) NOT NULL,
  issued_qty DECIMAL(10,2) NOT NULL DEFAULT 0,
  line_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  approved_by INT NULL,
  approved_at DATETIME NULL,
  remark VARCHAR(255) NULL,
  handled_by INT NULL,
  handled_at DATETIME NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_pri_status (status),
  CONSTRAINT fk_pri_request FOREIGN KEY (request_id) REFERENCES part_requests(id),
  CONSTRAINT fk_pri_part FOREIGN KEY (part_id) REFERENCES parts(id),
  CONSTRAINT fk_pri_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_pri_handled_by FOREIGN KEY (handled_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE job_parts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_card_id INT NOT NULL,
  part_id INT NOT NULL,
  qty DECIMAL(10,2) NOT NULL,
  returned_qty DECIMAL(10,2) NOT NULL DEFAULT 0,
  issued TINYINT(1) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL,
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  request_item_id INT NULL,
  issued_by INT NULL,
  issued_at DATETIME NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_jp_job (job_card_id),
  CONSTRAINT fk_jp_job FOREIGN KEY (job_card_id) REFERENCES job_cards(id),
  CONSTRAINT fk_jp_part FOREIGN KEY (part_id) REFERENCES parts(id),
  CONSTRAINT fk_jp_request_item FOREIGN KEY (request_item_id) REFERENCES part_request_items(id),
  CONSTRAINT fk_jp_issued_by FOREIGN KEY (issued_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE estimates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_card_id INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  est_no VARCHAR(20) NOT NULL,
  parts_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  labour_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  grand_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  approval_token VARCHAR(64) NULL,
  sent_at DATETIME NULL,
  expires_at DATETIME NULL,
  approved_via VARCHAR(10) NULL,
  approved_at DATETIME NULL,
  approved_by INT NULL,
  note VARCHAR(255) NULL,
  created_by INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_est_no (est_no),
  UNIQUE KEY uq_est_token (approval_token),
  KEY ix_est_job (job_card_id, version),
  CONSTRAINT fk_est_job FOREIGN KEY (job_card_id) REFERENCES job_cards(id),
  CONSTRAINT fk_est_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_est_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE estimate_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estimate_id INT NOT NULL,
  item_type VARCHAR(10) NOT NULL,
  part_id INT NULL,
  labour_rate_id INT NULL,
  description VARCHAR(150) NOT NULL,
  description_mr VARCHAR(150) NULL,
  qty DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  CONSTRAINT fk_ei_estimate FOREIGN KEY (estimate_id) REFERENCES estimates(id),
  CONSTRAINT fk_ei_part FOREIGN KEY (part_id) REFERENCES parts(id),
  CONSTRAINT fk_ei_rate FOREIGN KEY (labour_rate_id) REFERENCES labour_rates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(16) NULL,
  invoice_date DATE NULL,
  inv_type VARCHAR(10) NOT NULL,
  job_card_id INT NULL,
  customer_id INT NULL,
  cust_name VARCHAR(120) NULL,
  cust_phone VARCHAR(15) NULL,
  cust_gstin VARCHAR(15) NULL,
  cust_state_code VARCHAR(2) NULL,
  is_interstate TINYINT(1) NOT NULL DEFAULT 0,
  gst_registered TINYINT(1) NOT NULL DEFAULT 1,
  bill_disc_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  discount_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  taxable_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  cgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst DECIMAL(12,2) NOT NULL DEFAULT 0,
  round_off DECIMAL(12,2) NOT NULL DEFAULT 0,
  grand_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  returned_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  pay_status VARCHAR(10) NOT NULL DEFAULT 'unpaid',
  status VARCHAR(10) NOT NULL DEFAULT 'draft',
  cancel_reason VARCHAR(255) NULL,
  cancelled_by INT NULL,
  cancelled_at DATETIME NULL,
  finalized_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_invoice_no (invoice_no),
  KEY ix_inv_date (invoice_date),
  KEY ix_inv_customer (customer_id, status),
  CONSTRAINT fk_inv_job FOREIGN KEY (job_card_id) REFERENCES job_cards(id),
  CONSTRAINT fk_inv_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_inv_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id),
  CONSTRAINT fk_inv_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE invoice_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  item_type VARCHAR(10) NOT NULL,
  part_id INT NULL,
  job_part_id INT NULL,
  job_labour_id INT NULL,
  description_en VARCHAR(150) NOT NULL,
  description_mr VARCHAR(150) NULL,
  hsn VARCHAR(10) NULL,
  qty DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  disc_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  disc_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  gst_rate DECIMAL(5,2) NOT NULL,
  taxable DECIMAL(12,2) NOT NULL,
  cgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  CONSTRAINT fk_ii_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_ii_part FOREIGN KEY (part_id) REFERENCES parts(id),
  CONSTRAINT fk_ii_job_part FOREIGN KEY (job_part_id) REFERENCES job_parts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NULL,
  invoice_id INT NULL,
  amount DECIMAL(12,2) NOT NULL,
  mode VARCHAR(10) NOT NULL,
  reference VARCHAR(60) NULL,
  received_on DATE NOT NULL,
  note VARCHAR(255) NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_cp_customer (customer_id, received_on),
  KEY ix_cp_date (received_on),
  CONSTRAINT fk_cp_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_cp_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_cp_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sale_returns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_no VARCHAR(16) NOT NULL,
  invoice_id INT NOT NULL,
  customer_id INT NULL,
  return_date DATE NOT NULL,
  gst_registered TINYINT(1) NOT NULL DEFAULT 1,
  taxable_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  cgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst DECIMAL(12,2) NOT NULL DEFAULT 0,
  round_off DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  refund_mode VARCHAR(10) NULL,
  reason VARCHAR(255) NOT NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_return_no (return_no),
  KEY ix_ret_date (return_date),
  KEY ix_ret_customer (customer_id),
  CONSTRAINT fk_ret_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_ret_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_ret_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sale_return_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_id INT NOT NULL,
  invoice_item_id INT NOT NULL,
  part_id INT NULL,
  qty DECIMAL(10,2) NOT NULL,
  taxable DECIMAL(12,2) NOT NULL,
  cgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  igst DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  restock TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_ri_return (return_id),
  KEY ix_ri_item (invoice_item_id),
  CONSTRAINT fk_ri_return FOREIGN KEY (return_id) REFERENCES sale_returns(id),
  CONSTRAINT fk_ri_item FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id),
  CONSTRAINT fk_ri_part FOREIGN KEY (part_id) REFERENCES parts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  invoice_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_pa_invoice (invoice_id),
  CONSTRAINT fk_pa_payment FOREIGN KEY (payment_id) REFERENCES customer_payments(id),
  CONSTRAINT fk_pa_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mechanic_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mechanic_id INT NOT NULL,
  work_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  kind VARCHAR(10) NOT NULL DEFAULT 'daily',
  note VARCHAR(255) NULL,
  paid_by INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_mp_mech_date (mechanic_id, work_date),
  CONSTRAINT fk_mp_mechanic FOREIGN KEY (mechanic_id) REFERENCES users(id),
  CONSTRAINT fk_mp_paid_by FOREIGN KEY (paid_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(30) NOT NULL,
  title VARCHAR(150) NOT NULL,
  body VARCHAR(255) NULL,
  link VARCHAR(150) NULL,
  read_at DATETIME NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_notif_user (user_id, read_at, id),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE message_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NULL,
  channel VARCHAR(10) NOT NULL DEFAULT 'whatsapp',
  template VARCHAR(30) NOT NULL,
  ref_type VARCHAR(20) NULL,
  ref_id INT NULL,
  payload TEXT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'opened',
  sent_by INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_ml_customer (customer_id, template, created_at),
  CONSTRAINT fk_ml_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_ml_user FOREIGN KEY (sent_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE counters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ckey VARCHAR(30) NOT NULL,
  cval INT NOT NULL DEFAULT 0,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_counters_key (ckey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(40) NOT NULL,
  entity VARCHAR(30) NOT NULL,
  entity_id INT NULL,
  before_json TEXT NULL,
  after_json TEXT NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_audit_entity (entity, entity_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Database changes after the first release: public_html/api/migrations/NNN_name.sql, applied once each by
-- api/cron/migrate.php. When adding one, make the same change in this file and list its name below.
CREATE TABLE schema_migrations (
  name VARCHAR(190) NOT NULL PRIMARY KEY,
  applied_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO schema_migrations (name, applied_at) VALUES ('001_planned_job_parts.sql', NOW());
INSERT INTO schema_migrations (name, applied_at) VALUES ('002_user_permissions.sql', NOW());
INSERT INTO schema_migrations (name, applied_at) VALUES ('003_job_misc_parts.sql', NOW());
INSERT INTO schema_migrations (name, applied_at) VALUES ('004_purchase_cancel.sql', NOW());
INSERT INTO schema_migrations (name, applied_at) VALUES ('005_sale_returns.sql', NOW());

-- circular references
ALTER TABLE job_cards
  ADD CONSTRAINT fk_jobs_estimate FOREIGN KEY (approved_estimate_id) REFERENCES estimates(id),
  ADD CONSTRAINT fk_jobs_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id);

SET FOREIGN_KEY_CHECKS = 1;
