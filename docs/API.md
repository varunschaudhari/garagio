# Garage Manager API

Base URL `https://<domain>/api` (or `https://<domain>/api/index.php?r=/path` where mod_rewrite is off).
JSON in, JSON out. Times are Asia/Kolkata. Money is calculated only on the server.

**Auth** – `POST /auth/login` returns a JWT (30 days). Send it as `Authorization: Bearer <token>` **and**
`X-Auth-Token: <token>`. Tokens die when the password changes or the user is deactivated. Users who must
change their password can only call `/auth/*` until they do.

**Errors** – `{"error": "message", "code": "snake_case", "fields": {...}}` with 400 / 401 / 403 / 404 / 409 / 422 / 429.
`fields` maps input names to codes such as `required`, `invalid_phone`, `out_of_range`; line errors use
`items.<n>`. Lists accept `?q=&page=&per_page=` and return `{items, total}`.

**Cost fields** (`last_purchase_price`, `last_purchase_disc_pct`, `avg_cost`, `unit_cost`, `net_cost`,
`stock_value`, `margin`…) are removed from every response for front desk and mechanics.

Roles: **O** owner · **I** inventory manager · **D** front desk · **M** mechanic (own jobs only).

## Auth & settings
| Method & path | Roles | Notes |
|---|---|---|
| `GET /public/info` | public | shop name, min app version |
| `POST /auth/login` | public | `{username, password}`; 5 failures → 10 min lock (429) |
| `GET /auth/me` | all | user + `can_see_cost` |
| `POST /auth/password` | all | `{current_password, new_password}` → new token |
| `POST /auth/push-token` · `POST /auth/language` | all | |
| `GET /settings` / `PUT /settings` | all / O | |
| `GET/POST /locations`, `PUT /locations/{id}` | all / O I | |
| `GET/POST /categories`, `PUT /categories/{id}` | all / O I | |
| `GET/POST /labour-rates`, `PUT /labour-rates/{id}` | all / O | |
| `GET/POST /users`, `PUT /users/{id}` | O | `reset_password`, `active`, `role` |
| `GET /users/mechanics` | all | |

## Inventory
| Method & path | Roles | Notes |
|---|---|---|
| `GET /parts` | all | `q, category, location, rack, low, in_stock, all, sort` |
| `GET /parts/{id}` · `GET /parts/by-code/{code}` | all | QR code = part no. |
| `POST /parts` · `PUT /parts/{id}` | O I | `opening_stock`, `opening_cost`; stock is never typed |
| `GET /parts/{id}/ledger` | all | movements with `balance_after`, `balanced` flag |
| `POST /parts/{id}/adjust` | O I | `{qty (±), reason}` – audited |
| `POST /parts/import` | O I | `{rows:[…]}` upsert by part no. |
| `GET /parts/labels` | all | HTML QR sheet; `mode=part|rack, location, rack, ids, copies` |
| `POST /stock-counts` · `GET /stock-counts[/{id}]` | O I | `{location_id, lines:[{part_id, counted}]}` |
| `GET /reorder` | O I | low stock + unavailable lines (30 days), by last supplier |
| `GET /search?q=` | all | command palette |

## Suppliers & purchases
| Method & path | Roles | Notes |
|---|---|---|
| `GET/POST /suppliers`, `GET/PUT /suppliers/{id}` | O I | balance = payable |
| `GET /suppliers/{id}/ledger` · `POST /suppliers/{id}/payments` | O I | |
| `POST /purchases/preview` · `GET/POST /purchases` · `GET /purchases/{id}` | O I | ex-GST prices; inline `new_part`; credit/cash/upi/bank |

## Customers, jobs, estimates, requests
| Method & path | Roles | Notes |
|---|---|---|
| `GET /lookup?q=` | O D | phone or bike number |
| `GET/POST /customers`, `GET/PUT /customers/{id}` | O D | `opening_balance` owner only |
| `PUT /customers/{id}/credit` | O | `{is_trusted, credit_limit}` – audited |
| `GET /customers/{id}/ledger` · `POST /customers/{id}/payments` | O D | oldest bill first |
| `POST /customers/{id}/vehicles` · `PUT /vehicles/{id}` · `GET /vehicles/{id}/history` | O D (M history) | |
| `GET /jobs` | O D M I | `active, board, status, q, mechanic` |
| `POST /jobs` | O D | ids or quick-create `customer` + `vehicle` |
| `GET/PUT /jobs/{id}` | all / O D M | mechanic: `inspection_notes` only |
| `POST /jobs/{id}/status` | O D M | in_progress needs an approved estimate; delivered needs a final bill |
| `POST /jobs/{id}/labour` · `DELETE /jobs/{id}/labour/{lid}` | O D M | mechanic: rate list only |
| `POST /jobs/{id}/photos` (multipart `photo`) · `GET/DELETE /jobs/{id}/photos/{pid}` | O D M | max 4 |
| `POST /jobs/{id}/return` | O I | `{job_part_id, qty}` |
| `POST /jobs/{id}/whatsapp` | O D | `{template: "ready"}` → `{url, text}` |
| `POST /jobs/{id}/estimates` · `GET /estimates/{id}` | O D | parts at selling price, labour editable |
| `POST /estimates/{id}/send` | O D | → `{link, url (wa.me), text}` |
| `POST /estimates/{id}/approve-call` | O D | `{note}` |
| `GET /e/{token}` · `POST /e/{token}/approve` · `POST /e/{token}/call` | public | bilingual HTML page |
| `GET/POST /requests` · `GET /requests/{id}` | all / O D M | queue `status=open` oldest first; `tab=approvals`; `mine` |
| `POST /requests/{id}/items/{iid}/approve` · `/reject` · `/issue` · `/unavailable` · `/link` | O I | `issue {qty}` partial allowed |
| `POST /requests/{id}/issue-all` · `POST /requests/{id}/cancel` | O I / O D M | |
| `GET /notifications` · `POST /notifications/read` | all | `{ids}` or `{all:true}` |

## Billing
| Method & path | Roles | Notes |
|---|---|---|
| `POST /invoices/preview` | O D | |
| `GET/POST /invoices`, `GET/PUT/DELETE /invoices/{id}` | O D | draft; discounts (`disc_pct`, `bill_disc_pct`, `discounts`) owner only |
| `POST /invoices/{id}/finalize` | O D | `{payments:[{mode, amount, reference}]}`; credit only for trusted customers within limit |
| `POST /invoices/{id}/payments` | O D | |
| `POST /invoices/{id}/cancel` | O | `{reason}` – stock back, job reopens |
| `GET /invoices/{id}/html?lang=` | O D | bilingual A4 tax invoice |
| `GET /invoices/{id}/receipt?lang=&width=58\|80` | O D | thermal receipt in one language; width defaults to the `receipt_width` setting |
| `POST /invoices/{id}/whatsapp` | O D | |

## Owner tools
| Method & path | Roles | Notes |
|---|---|---|
| `GET /dashboard` | all | role-aware; `money` block for owner |
| `GET /mechanics/daily?date=` · `GET /mechanics/summary` | O | |
| `POST /mechanics/{id}/payments` · `GET /mechanics/{id}/payments` · `DELETE /mechanics/payments/{pid}` | O | `kind: daily|advance` |
| `GET /reports/{sales,purchases,stock,profit,dues,payables,gst,mechanics}` | O (I: stock, purchases, payables) | `from, to, format=csv` |
| `GET /messages/due` · `POST /messages/log` | O D | service + payment reminders with wa.me links |
| `GET /backups` · `POST /backups` · `GET /backups/latest` | O | gzipped SQL dumps |
| `GET /admin/health` | O | server, config, cron and data checks: `{status, checks:[{key, status: ok / warn / fail, value}]}` |
| `GET /admin/go-live` · `POST /admin/go-live` | O | counts of trial data; reset `{confirm: "RESET", password, parts: keep / zero / delete, contacts: demo / all / keep}` – backup first, audited |
