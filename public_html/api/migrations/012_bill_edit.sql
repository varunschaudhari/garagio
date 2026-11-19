-- The owner edits a final sales bill (same number): who and when, and money given back when a walk-in bill went down.
ALTER TABLE invoices ADD COLUMN edited_at DATETIME NULL AFTER finalized_at, ADD COLUMN edited_by INT NULL AFTER edited_at;

CREATE TABLE bill_refunds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  mode VARCHAR(10) NOT NULL DEFAULT 'cash',
  refunded_on DATE NOT NULL,
  note VARCHAR(255) NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_br_date (refunded_on),
  CONSTRAINT fk_br_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_br_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
