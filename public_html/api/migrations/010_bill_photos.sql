-- A photo of the paper bill behind an expense or a purchase bill (one each, replaceable).
ALTER TABLE expenses ADD COLUMN photo VARCHAR(80) NULL AFTER note;
ALTER TABLE purchases ADD COLUMN photo VARCHAR(80) NULL AFTER notes;
