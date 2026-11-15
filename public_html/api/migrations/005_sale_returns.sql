-- Sale returns (credit notes): parts / labour taken back from a final bill, with an optional refund.
ALTER TABLE invoices ADD COLUMN returned_total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER grand_total;

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
