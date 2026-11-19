-- The shop asked (19 Nov 2026) for bills, receipts and messages to show 8669116229 instead of 8956252573.
-- Only changes the number if it is still the old one.
UPDATE settings SET svalue = '8669116229', updated_at = NOW() WHERE skey = 'shop_phone' AND svalue = '8956252573';
