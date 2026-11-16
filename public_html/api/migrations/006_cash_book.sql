-- Shop expenses and the end-of-day cash count (cash book).
CREATE TABLE expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  spent_on DATE NOT NULL,
  category VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  mode VARCHAR(10) NOT NULL DEFAULT 'cash',
  note VARCHAR(255) NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY ix_exp_date (spent_on),
  CONSTRAINT fk_exp_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cash_closes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  close_date DATE NOT NULL,
  opening DECIMAL(12,2) NOT NULL DEFAULT 0,
  cash_in DECIMAL(12,2) NOT NULL DEFAULT 0,
  cash_out DECIMAL(12,2) NOT NULL DEFAULT 0,
  expected DECIMAL(12,2) NOT NULL DEFAULT 0,
  counted DECIMAL(12,2) NOT NULL DEFAULT 0,
  difference DECIMAL(12,2) NOT NULL DEFAULT 0,
  taken_out DECIMAL(12,2) NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  user_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_close_date (close_date),
  CONSTRAINT fk_close_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
