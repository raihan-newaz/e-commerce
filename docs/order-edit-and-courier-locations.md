# Order editing and courier locations

## Order details and editing

The details page reads staff from `/api/auth/users`, retains the current assignee
when it is absent from the active list, and displays the stored checkout IP. Older
orders can recover an IP from their linked risk history. Missing IPs are explicitly
shown as not captured; an administrator's current IP is never substituted.

Editing supports customer/address fields, products and variants, item names,
quantities, unit prices, delivery fees, discounts, advance payments, notes, priority,
and assignment. Saves run in a transaction with row locking, revision checks from
the editor, authoritative product validation, stock deltas and total recalculation.
Unchanged item lines retain their IDs. Cancelled/returned orders do not reserve
stock again. Recorded collections and external consignment IDs are retained.

Booked order edits flag the order for courier review. Monetary amendments mark a
settlement discrepancy; they do not update an external courier automatically.
Pending or uncertain booking attempts must be resolved before editing, and trashed
orders must be restored. Status transitions keep their existing workflow.

## Locations

Only enabled couriers with their required credentials and pickup store configured
appear in delivery-area controls and dispatch choices. This readiness check does
not prove that remote credentials are valid; upstream errors remain visible.

Catalog synchronization and order address matching share one bounded in-process
queue. Identical work shares a promise, failures have a cooldown, and explicit
refresh can retry. Matching after order creation is scheduled after the commit.
Stored location catalogs remain usable when a refresh fails. Empty upstream data
does not erase a previously valid catalog. Browser/server reads are cached and
concurrent identical reads are shared.

This queue is per server process, not a distributed durable worker. Catalogs persist
in the database; missing order matches can be scheduled again when the details page
loads or through manual matching after a restart.

## Verification

Local browser checks use mocked APIs and cover staff/IP display, courier readiness,
product/variant editing, quantity controls, totals, and desktop/mobile/dark layouts.
Transaction mocks cover stock rollback, restocking, delivered totals, stale saves,
and retained courier bookings. No production orders or shipments are created.
Live database persistence, courier credentials, and production deployment require
a reachable configured environment and remain unverified locally.
