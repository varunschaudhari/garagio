-- Purchase bills can be cancelled or corrected (a correction cancels the old bill and links it to the new one).
-- Cancelled bills keep their number; the same bill number may be entered again after a cancel.
ALTER TABLE purchases ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'final' AFTER payment_mode;
ALTER TABLE purchases ADD COLUMN cancel_reason VARCHAR(255) NULL AFTER notes;
ALTER TABLE purchases ADD COLUMN cancelled_by INT NULL AFTER cancel_reason;
ALTER TABLE purchases ADD COLUMN cancelled_at DATETIME NULL AFTER cancelled_by;
ALTER TABLE purchases ADD COLUMN replaced_by INT NULL AFTER cancelled_at;
ALTER TABLE purchases ADD KEY ix_purchase_bill (supplier_id, bill_no);
ALTER TABLE purchases DROP INDEX uq_purchase_bill;
