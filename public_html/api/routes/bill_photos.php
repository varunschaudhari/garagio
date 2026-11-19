<?php
declare(strict_types=1);

/*
 * A photo of the paper bill behind an expense or a purchase bill (decision 26): one per record, taken with the
 * phone camera or chosen from the gallery, replaceable. Files live in storage/bills/<kind>/ (never served directly).
 */

const BILL_PHOTO_KINDS = [
    'expenses' => 'cash_book',
    'purchases' => 'purchases',
];

function bill_photo_dir(string $kind): string
{
    return API_DIR . '/storage/bills/' . $kind;
}

function bill_photo_record(string $kind, int $id): array
{
    return row("SELECT id, photo FROM `$kind` WHERE id = ?", [$id]) ?? not_found($kind === 'expenses' ? 'Expense' : 'Purchase bill');
}

foreach (BILL_PHOTO_KINDS as $kind => $perm) {
    route('POST', "/$kind/{id}/photo", function ($p) use ($kind) {
        $rec = bill_photo_record($kind, (int) $p['id']);
        $name = save_uploaded_image(bill_photo_dir($kind));
        update_row($kind, (int) $rec['id'], ['photo' => $name]);
        if ($rec['photo']) {
            @unlink(bill_photo_dir($kind) . '/' . $rec['photo']);
        }
        return ['ok' => true, 'photo' => $name];
    }, ['perm' => $perm]);

    route('GET', "/$kind/{id}/photo", function ($p) use ($kind) {
        $rec = bill_photo_record($kind, (int) $p['id']);
        if (!$rec['photo']) {
            not_found('Photo');
        }
        return image_response(bill_photo_dir($kind) . '/' . $rec['photo']);
    }, ['perm' => $perm]);

    route('DELETE', "/$kind/{id}/photo", function ($p) use ($kind) {
        $rec = bill_photo_record($kind, (int) $p['id']);
        if ($rec['photo']) {
            update_row($kind, (int) $rec['id'], ['photo' => null]);
            @unlink(bill_photo_dir($kind) . '/' . $rec['photo']);
        }
        return ['ok' => true, 'photo' => null];
    }, ['perm' => $perm]);
}
