-- Purchase bills the shop's way: MRP (with GST) less the trade discount, or net prices without GST (per bill).
-- The MRP on a purchase line becomes the part's selling price. Suppliers get a contact person.
ALTER TABLE purchases ADD COLUMN price_mode VARCHAR(4) NOT NULL DEFAULT 'net' AFTER is_interstate;
ALTER TABLE purchase_items ADD COLUMN mrp DECIMAL(12,2) NULL AFTER disc_pct;
ALTER TABLE suppliers ADD COLUMN contact_person VARCHAR(100) NULL AFTER name;
