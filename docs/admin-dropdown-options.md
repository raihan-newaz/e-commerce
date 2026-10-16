# Admin dropdown options

## Setup

Deploy the server, client and storefront together. Before starting the updated
server, generate the Prisma client, build, and install the additive settings table:

```powershell
cd server
npm exec prisma generate
npm run build
npm run admin:install-dropdowns
```

The installer uses `CREATE TABLE IF NOT EXISTS` and does not change existing data.
For a built container, run `node server/dist/scripts/installAdminDropdowns.js` with
its usual database environment. The server database must be reachable.

## Behavior

- Super administrators manage options at **Settings → Dropdown options**.
- 129 native selects use the shared adapter. The editor's own behavior
  picker is intentionally independent of the options it manages.
- Static choices are catalogued in source. Choices loaded from APIs are discovered
  when their existing page/form is opened, and retained with saved configuration.
- Labels, order, visibility and mapped choices persist in `AdminDropdownConfig`.
- Added choices map to an existing supported value. Their labels do not create a
  separate order state, payment provider, permission, or independently stored status.
  Multiple labels for one value share that value's deletion protection.
- Create linked entities (staff, products, accounts, suppliers, categories) using
  their existing management workflows. The adapter does not create database records.
- A current selection remains available even when hidden from new selections.
- Deletion records a display tombstone for a built-in option. Existing business
  enums and server workflows remain intact. In-use values cannot be removed or
  remapped through the settings API. Usage includes soft-deleted orders, linked
  records and persisted live JSON configuration; historical audit/revision logs are
  excluded. Matching values in another dropdown can also block deletion.
- Concurrent saves use a version check. Reload to resolve a conflict.
- When settings cannot load, existing dropdowns continue to use their original
  choices; the customization page reports the error.

## Other UI changes

- Orders load 20 rows per page. Assignment is inside the existing portalled row
  actions menu, and the former Fulfillment heading is now Status.
- Store settings → Hero carousel images has desktop/tablet (160–700px) and mobile
  (120–450px) height controls. Clear a number or reset it to use responsive sizing.
- Create Order and other admin forms share neutral inputs, borders, focus states
  and light/dark styling. Existing submission handlers remain in place.

## Verification limits

Browser checks use mocked APIs and do not create production orders. The local
MySQL server was unavailable during installation, so real database persistence
and production deployment still need verification against a running database.
