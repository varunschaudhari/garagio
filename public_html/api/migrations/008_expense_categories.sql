-- Expense categories the owner can change (Settings / cash book), starting with the shop's own list.
CREATE TABLE expense_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name_en VARCHAR(80) NOT NULL,
  name_mr VARCHAR(80) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NULL,
  updated_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO expense_categories (id, name_en, name_mr, sort_order, active, created_at, updated_at) VALUES
(1, 'Tea', 'चहा', 1, 1, NOW(), NOW()),
(2, 'Snacks', 'नाश्ता', 2, 1, NOW(), NOW()),
(3, 'Water', 'पाणी', 3, 1, NOW(), NOW()),
(4, 'Tools', 'हत्यारे', 4, 1, NOW(), NOW()),
(5, 'Machinery', 'मशिनरी', 5, 1, NOW(), NOW()),
(6, 'Racks', 'रॅक', 6, 1, NOW(), NOW()),
(7, 'Rent', 'भाडे', 7, 1, NOW(), NOW()),
(8, 'Electricity', 'वीज बिल', 8, 1, NOW(), NOW()),
(9, 'Fuel', 'पेट्रोल / डिझेल', 9, 1, NOW(), NOW()),
(10, 'Staff salary', 'कर्मचारी पगार', 10, 1, NOW(), NOW()),
(11, 'Shop repairs', 'दुकान दुरुस्ती', 11, 1, NOW(), NOW()),
(12, 'Transport / courier', 'वाहतूक / कुरिअर', 12, 1, NOW(), NOW()),
(13, 'Other', 'इतर', 13, 1, NOW(), NOW());

ALTER TABLE expenses ADD COLUMN category_id INT NULL AFTER spent_on;

UPDATE expenses SET category_id = CASE category
  WHEN 'tea_snacks' THEN 1 WHEN 'tools' THEN 4 WHEN 'rent' THEN 7 WHEN 'electricity' THEN 8 WHEN 'fuel' THEN 9
  WHEN 'salary' THEN 10 WHEN 'repairs' THEN 11 WHEN 'transport' THEN 12 ELSE 13 END;

ALTER TABLE expenses MODIFY category_id INT NOT NULL, DROP COLUMN category,
  ADD CONSTRAINT fk_exp_category FOREIGN KEY (category_id) REFERENCES expense_categories(id);
