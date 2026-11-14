-- Garage Manager (Trimurti Auto) - seed data. Import after schema.sql.
-- Demo users all have password  garage123  and must change it on first login.
-- Demo customers / suppliers are marked "(Demo)"; edit or ignore them once real data is in.

SET NAMES utf8mb4;

SET @now = NOW();

-- ------------------------------------------------------------------ settings
INSERT INTO settings (skey, svalue, created_at, updated_at) VALUES
('shop_name', 'Trimurti Auto', @now, @now),
('shop_name_mr', 'त्रिमूर्ती ऑटो', @now, @now),
('shop_address', 'Shop address, City, Maharashtra - PIN', @now, @now),
('shop_address_mr', '', @now, @now),
('shop_phone', '', @now, @now),
('shop_gstin', '', @now, @now),
('shop_state_code', '27', @now, @now),
('shop_state_name', 'Maharashtra', @now, @now),
('job_prefix', 'JC-', @now, @now),
('estimate_prefix', 'EST-', @now, @now),
('invoice_prefix', 'INV', @now, @now),
('prices_include_gst', '1', @now, @now),
('default_part_gst_rate', '18', @now, @now),
('labour_gst_rate', '18', @now, @now),
('labour_sac', '998714', @now, @now),
('approval_limit', '1000', @now, @now),
('service_reminder_days', '90', @now, @now),
('service_reminder_km', '3000', @now, @now),
('payment_reminder_days', '7', @now, @now),
('estimate_link_days', '7', @now, @now),
('invoice_terms_en', 'Goods once sold will not be taken back. Warranty on parts as per manufacturer. Subject to local jurisdiction.', @now, @now),
('invoice_terms_mr', 'एकदा विकलेला माल परत घेतला जाणार नाही. पार्ट्सची वॉरंटी कंपनीच्या नियमांनुसार. स्थानिक न्यायक्षेत्राच्या अधीन.', @now, @now),
('min_app_version', '1.0.0', @now, @now);

-- ------------------------------------------------------------------ users (password: garage123)
INSERT INTO users (id, name, username, phone, password_hash, role, language, must_change_password, active, created_at, updated_at) VALUES
(1, 'Owner', 'admin', NULL, '$2y$10$YlInobMXu43GaBFpI..zMe5NVHx7B04saMwTHuvj1q9m5eF68YgL6', 'owner', 'mr', 1, 1, @now, @now),
(2, 'Sunil (Stock)', 'stock', NULL, '$2y$10$YlInobMXu43GaBFpI..zMe5NVHx7B04saMwTHuvj1q9m5eF68YgL6', 'inventory', 'mr', 1, 1, @now, @now),
(3, 'Pooja (Front desk)', 'desk', NULL, '$2y$10$YlInobMXu43GaBFpI..zMe5NVHx7B04saMwTHuvj1q9m5eF68YgL6', 'front_desk', 'mr', 1, 1, @now, @now),
(4, 'Ramesh (Mechanic)', 'ramesh', NULL, '$2y$10$YlInobMXu43GaBFpI..zMe5NVHx7B04saMwTHuvj1q9m5eF68YgL6', 'mechanic', 'mr', 1, 1, @now, @now),
(5, 'Mahesh (Mechanic)', 'mahesh', NULL, '$2y$10$YlInobMXu43GaBFpI..zMe5NVHx7B04saMwTHuvj1q9m5eF68YgL6', 'mechanic', 'mr', 1, 1, @now, @now);

-- ------------------------------------------------------------------ storage locations
INSERT INTO storage_locations (id, name_en, name_mr, sort_order, active, created_at, updated_at) VALUES
(1, 'Counter', 'काउंटर', 1, 1, @now, @now),
(2, 'Godown', 'गोडाऊन', 2, 1, @now, @now),
(3, 'Upstairs', 'वरचा मजला', 3, 1, @now, @now);

-- ------------------------------------------------------------------ categories
INSERT INTO categories (id, name_en, name_mr, active, created_at, updated_at) VALUES
(1, 'Engine', 'इंजिन', 1, @now, @now),
(2, 'Brakes', 'ब्रेक', 1, @now, @now),
(3, 'Electrical', 'इलेक्ट्रिकल', 1, @now, @now),
(4, 'Tyres & Tubes', 'टायर व ट्यूब', 1, @now, @now),
(5, 'Oils & Lubricants', 'ऑइल व ल्युब्रिकंट', 1, @now, @now),
(6, 'Filters', 'फिल्टर', 1, @now, @now),
(7, 'Cables', 'केबल', 1, @now, @now),
(8, 'Transmission', 'ट्रान्समिशन', 1, @now, @now),
(9, 'Body & Accessories', 'बॉडी व ॲक्सेसरीज', 1, @now, @now),
(10, 'Suspension & Bearings', 'सस्पेन्शन व बेअरिंग', 1, @now, @now);

-- ------------------------------------------------------------------ labour rate list
INSERT INTO labour_rates (name_en, name_mr, amount, active, created_at, updated_at) VALUES
('General servicing', 'जनरल सर्व्हिसिंग', 350, 1, @now, @now),
('Oil change', 'ऑइल बदलणे', 100, 1, @now, @now),
('Brake adjustment', 'ब्रेक ॲडजस्टमेंट', 80, 1, @now, @now),
('Brake shoe replacement', 'ब्रेक शू बदलणे', 150, 1, @now, @now),
('Clutch plate replacement', 'क्लच प्लेट बदलणे', 400, 1, @now, @now),
('Cable replacement', 'केबल बदलणे', 100, 1, @now, @now),
('Chain sprocket kit fitting', 'चेन स्प्रॉकेट किट बसवणे', 250, 1, @now, @now),
('Puncture repair', 'पंक्चर काढणे', 80, 1, @now, @now),
('Tyre fitting', 'टायर बसवणे', 100, 1, @now, @now),
('Carburettor cleaning', 'कार्बोरेटर साफ करणे', 200, 1, @now, @now),
('Battery fitting', 'बॅटरी बसवणे', 50, 1, @now, @now),
('Electrical repair', 'इलेक्ट्रिकल दुरुस्ती', 200, 1, @now, @now),
('Wheel bearing replacement', 'व्हील बेअरिंग बदलणे', 150, 1, @now, @now),
('Engine overhaul', 'इंजिन ओव्हरहॉल', 2500, 1, @now, @now),
('Washing', 'वॉशिंग', 100, 1, @now, @now);

-- ------------------------------------------------------------------ parts
-- selling_price = MRP incl. GST; last_purchase_price = supplier price ex-GST before discount.
INSERT INTO parts (part_no, name_en, name_mr, category_id, brand, compatible_models, unit, hsn, gst_rate, selling_price, last_purchase_price, last_purchase_disc_pct, location_id, rack, current_stock, min_stock, active, created_at, updated_at) VALUES
('SP-CPR7EA9', 'Spark plug', 'स्पार्क प्लग', 1, 'NGK', 'Splendor, Passion, Activa, Jupiter', 'pcs', '85111000', 18, 150, 85, 5, 1, 'A1', 40, 10, 1, @now, @now),
('TYR-9090-17', 'Rear tyre 90/90-17 tubeless', 'मागील टायर 90/90-17 ट्यूबलेस', 4, 'MRF', 'Splendor, Passion, Shine', 'pcs', '40114000', 18, 1450, 900, 4, 2, 'G1', 6, 2, 1, @now, @now),
('TYR-275-18', 'Front tyre 2.75-18', 'पुढील टायर 2.75-18', 4, 'TVS Eurogrip', 'Splendor, Platina', 'pcs', '40114000', 18, 1250, 780, 4, 2, 'G1', 5, 2, 1, @now, @now),
('TUB-300-18', 'Tube 3.00-18', 'ट्यूब 3.00-18', 4, 'MRF', 'Splendor, Platina, CT100', 'pcs', '40131020', 18, 320, 190, 3, 2, 'G1', 12, 4, 1, @now, @now),
('OIL-2040-1L', 'Engine oil 20W-40 (1 litre)', 'इंजिन ऑइल 20W-40 (1 लिटर)', 5, 'Castrol Activ', 'All bikes', 'btl', '27101980', 18, 420, 270, 6, 1, 'A2', 24, 8, 1, @now, @now),
('OIL-1030-08L', 'Scooter oil 10W-30 (0.8 litre)', 'स्कूटर ऑइल 10W-30 (0.8 लिटर)', 5, 'Honda', 'Activa, Dio', 'btl', '27101980', 18, 380, 245, 6, 1, 'A2', 18, 6, 1, @now, @now),
('BS-SPL', 'Brake shoe set', 'ब्रेक शू सेट', 2, 'Hero Genuine', 'Splendor, Passion', 'set', '68138100', 18, 260, 150, 5, 1, 'A3', 15, 5, 1, @now, @now),
('BP-PUL', 'Disc brake pad', 'डिस्क ब्रेक पॅड', 2, 'Bajaj Genuine', 'Pulsar 150, Pulsar 180', 'set', '68138100', 18, 380, 225, 5, 1, 'A3', 8, 3, 1, @now, @now),
('CP-SPL', 'Clutch plate set', 'क्लच प्लेट सेट', 8, 'Hero Genuine', 'Splendor, Passion', 'set', '87141090', 18, 650, 390, 5, 3, 'U1', 6, 2, 1, @now, @now),
('CC-SPL', 'Clutch cable', 'क्लच केबल', 7, 'Hero Genuine', 'Splendor, Passion', 'pcs', '87141090', 18, 180, 100, 5, 1, 'A4', 10, 3, 1, @now, @now),
('AC-ACT', 'Accelerator cable', 'ॲक्सिलरेटर केबल', 7, 'Honda Genuine', 'Activa 5G, Activa 6G', 'pcs', '87141090', 18, 170, 95, 5, 1, 'A4', 8, 3, 1, @now, @now),
('BC-FR-SPL', 'Front brake cable', 'पुढील ब्रेक केबल', 7, 'Hero Genuine', 'Splendor', 'pcs', '87141090', 18, 160, 90, 5, 1, 'A4', 8, 3, 1, @now, @now),
('CSK-SPL', 'Chain sprocket kit', 'चेन स्प्रॉकेट किट', 8, 'Rolon', 'Splendor, Passion', 'kit', '87141090', 18, 1150, 700, 6, 2, 'G2', 4, 2, 1, @now, @now),
('CSK-PUL150', 'Chain sprocket kit', 'चेन स्प्रॉकेट किट', 8, 'Rolon', 'Pulsar 150', 'kit', '87141090', 18, 1650, 1010, 6, 2, 'G2', 3, 1, 1, @now, @now),
('AF-ACT', 'Air filter', 'एअर फिल्टर', 6, 'Honda Genuine', 'Activa 5G, Activa 6G', 'pcs', '84213100', 18, 220, 130, 5, 3, 'U2', 10, 4, 1, @now, @now),
('AF-SPL', 'Air filter', 'एअर फिल्टर', 6, 'Hero Genuine', 'Splendor, Passion', 'pcs', '84213100', 18, 190, 110, 5, 3, 'U2', 10, 4, 1, @now, @now),
('OF-PUL', 'Oil filter', 'ऑइल फिल्टर', 6, 'Bajaj Genuine', 'Pulsar 150, Pulsar 180', 'pcs', '84212300', 18, 120, 68, 5, 3, 'U2', 12, 4, 1, @now, @now),
('HB-1235', 'Headlight bulb 12V 35/35W', 'हेडलाइट बल्ब 12V 35/35W', 3, 'Philips', 'All bikes', 'pcs', '85392190', 18, 110, 62, 5, 1, 'A1', 20, 6, 1, @now, @now),
('IB-1210', 'Indicator bulb 12V 10W', 'इंडिकेटर बल्ब 12V 10W', 3, 'Philips', 'All bikes', 'pcs', '85392190', 18, 25, 13, 5, 1, 'A1', 50, 15, 1, @now, @now),
('BAT-12V5', 'Battery 12V 5Ah', 'बॅटरी 12V 5Ah', 3, 'Exide', 'Splendor, Activa, Jupiter', 'pcs', '85071000', 18, 1850, 1150, 3, 2, 'G3', 3, 2, 1, @now, @now),
('BRG-6301', 'Wheel bearing 6301', 'व्हील बेअरिंग 6301', 10, 'SKF', 'Most bikes', 'pcs', '84821011', 18, 140, 80, 5, 3, 'U1', 16, 6, 1, @now, @now),
('MIR-PAIR', 'Rear view mirror (pair)', 'आरसे (जोडी)', 9, 'Minda', 'Universal', 'pair', '70091090', 18, 240, 140, 5, 2, 'G4', 6, 2, 1, @now, @now),
('HORN-12V', 'Horn 12V', 'हॉर्न 12V', 3, 'Roots', 'Universal', 'pcs', '85123010', 18, 280, 165, 5, 2, 'G3', 5, 2, 1, @now, @now),
('FOS-SPL', 'Front fork oil seal (pair)', 'फ्रंट फोर्क ऑइल सील (जोडी)', 10, 'Hero Genuine', 'Splendor, Passion', 'pair', '40169320', 18, 160, 90, 5, 3, 'U1', 8, 3, 1, @now, @now),
('CARB-KIT', 'Carburettor repair kit', 'कार्बोरेटर दुरुस्ती किट', 1, 'Ucal', 'Splendor, Passion', 'kit', '84099990', 18, 350, 205, 5, 3, 'U1', 5, 2, 1, @now, @now),
('BF-DOT3', 'Brake fluid DOT3 (100 ml)', 'ब्रेक फ्लुइड DOT3 (100 मिली)', 5, 'Bosch', 'Disc brake bikes', 'btl', '38190010', 18, 90, 50, 5, 1, 'A2', 12, 4, 1, @now, @now),
('CL-SPRAY', 'Chain lube spray (150 ml)', 'चेन ल्यूब स्प्रे (150 मिली)', 5, 'Motul', 'All bikes', 'btl', '34031900', 18, 250, 150, 5, 1, 'A2', 2, 3, 1, @now, @now),
('GASK-SIL', 'Silencer gasket', 'सायलेन्सर गॅस्केट', 1, 'Local', 'Splendor, Passion', 'pcs', '84099990', 18, 40, 20, 0, 1, 'A3', 30, 10, 1, @now, @now),
('PK-SPL', 'Piston kit', 'पिस्टन किट', 1, 'Hero Genuine', 'Splendor', 'kit', '84099990', 18, 1800, 1100, 4, 3, 'U1', 2, 1, 1, @now, @now),
('BELT-ACT', 'Drive belt', 'ड्राइव्ह बेल्ट', 8, 'Honda Genuine', 'Activa 5G, Activa 6G', 'pcs', '40103999', 18, 780, 470, 5, 2, 'G2', 0, 2, 1, @now, @now);

-- Weighted-average cost starts at the net purchase cost
UPDATE parts SET avg_cost = ROUND(last_purchase_price * (1 - last_purchase_disc_pct / 100), 4);

-- Opening stock movements so the ledger balance equals current_stock
INSERT INTO stock_movements (part_id, qty, balance_after, mtype, ref_type, ref_id, unit_cost, note, user_id, created_at, updated_at)
SELECT id, current_stock, current_stock, 'opening', 'part', id, avg_cost, 'Opening stock', 1, @now, @now
FROM parts WHERE current_stock > 0;

-- ------------------------------------------------------------------ suppliers (demo)
INSERT INTO suppliers (name, phone, gstin, state_code, address, opening_balance, active, created_at, updated_at) VALUES
('Shree Auto Spares (Demo)', '9000000101', '27AAAAA1111A1Z1', '27', 'Pune, Maharashtra', 0, 1, @now, @now),
('Om Sai Tyres (Demo)', '9000000102', '27AAAAA2222B1Z2', '27', 'Kolhapur, Maharashtra', 4500, 1, @now, @now),
('Deccan Lubricants (Demo)', '9000000103', '29AAAAA3333C1Z3', '29', 'Belagavi, Karnataka', 0, 1, @now, @now);

-- ------------------------------------------------------------------ customers and bikes (demo)
INSERT INTO customers (id, name, phone, alt_phone, address, gstin, state_code, language, is_trusted, credit_limit, opening_balance, created_at, updated_at) VALUES
(1, 'Rahul Jadhav (Demo)', '9000000001', NULL, 'Shivaji Nagar', NULL, '27', 'mr', 1, 5000, 0, @now, @now),
(2, 'Sneha Kulkarni (Demo)', '9000000002', NULL, 'Station Road', NULL, '27', 'en', 0, 0, 0, @now, @now),
(3, 'Amit Shinde (Demo)', '9000000003', NULL, 'Market Yard', NULL, '27', 'mr', 0, 0, 350, @now, @now),
(4, 'Deccan Couriers (Demo)', '9000000004', NULL, 'Belagavi, Karnataka', '29AAAAA4444D1Z4', '29', 'en', 1, 0, 0, @now, @now);

INSERT INTO vehicles (customer_id, reg_no, make, model, year, last_odometer, created_at, updated_at) VALUES
(1, 'MH12AB1234', 'Hero', 'Splendor Plus', 2019, 41250, @now, @now),
(1, 'MH12CD5678', 'Honda', 'Activa 6G', 2021, 18400, @now, @now),
(2, 'MH14EF9012', 'Bajaj', 'Pulsar 150', 2018, 52300, @now, @now),
(3, 'MH09GH3456', 'Hero', 'Passion Pro', 2017, 63800, @now, @now),
(4, 'KA22JK7890', 'TVS', 'XL100', 2022, 22100, @now, @now);
