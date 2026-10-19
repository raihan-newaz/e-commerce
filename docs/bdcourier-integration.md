# BD Courier fraud checker integration

Reference checked from the authenticated Developer/API page at `https://app.courier.com.bd/api` on 2026-10-19.

## Provider API

- Production base URL: `https://api.bdcourier.com`
- Authentication: `Authorization: Bearer YOUR_API_KEY`
- Content type for requests with a body: `application/json`
- Current check: `POST /courier-check`, body `{"phone":"017xxxxxxxx"}`. Phone is required. The service chooses free or paid usage according to the account plan.
- Legacy check: `POST /old/courier-check`, same body. It returns the courier breakdown under `courierData` instead of `data` and omits CarryBee. The app uses the current endpoint.
- Connection: `GET /check-connection`.
- Plan and usage: `GET /my-plan`.

Example current check response:

```json
{
  "status": "success",
  "data": {
    "pathao": { "name": "Pathao", "total_parcel": 150, "success_parcel": 120, "cancelled_parcel": 30, "success_ratio": 80 },
    "steadfast": { "name": "SteadFast", "total_parcel": 200, "success_parcel": 175, "cancelled_parcel": 25, "success_ratio": 87.5 },
    "summary": { "total_parcel": 620, "success_parcel": 530, "cancelled_parcel": 90, "success_ratio": 85.48 }
  },
  "reports": [{ "id": "abc123", "name": "John Doe", "details": "Fraud reported by merchant", "created_at": "2024-01-01T00:00:00.000000Z", "courierName": "SteadFast" }]
}
```

The documented current breakdown includes Pathao, Steadfast, ParcelDex, CourrierFast, RedX, PaperFly and CarryBee. Each courier can include its name/logo plus total, successful and cancelled parcel counts and success ratio. A successful response may have no matching history; error-shaped responses include `status: "error"` and a message. The connection response includes connection/authentication state, user ID and timestamps. Plan data includes subscription state/name/type/status, renewal/expiry information, price/frequency, API calls, limits and remaining free/paid calls. The legacy endpoint excludes CarryBee.

## App behavior

- A Super Admin enables BD Courier and saves an API key in **Settings → Couriers → BD Courier Fraud Checker**. Keys use the existing encrypted courier-credential storage and are masked in config responses.
- Staff explicitly start a check from an order details page. The server obtains the phone from that order, normalizes it to a Bangladeshi mobile number, and sends only `phone` to the fixed HTTPS provider endpoint. No arbitrary phone or base URL is accepted.
- Connection and plan checks are manual from settings. No bulk, background or automatic customer scans run.
- Results show total courier history, per-courier outcomes and merchant fraud reports. Results are informational and do not update the order, fraud flags, status, dispatch eligibility or existing risk review.
- Provider timeouts, authentication failures and exhausted limits are reported; provider keys and phone numbers are not returned in the UI response except the existing order phone already displayed by the app.

## Source

- Official in-app API documentation: <https://app.courier.com.bd/api>
- Provider API host: <https://api.bdcourier.com>
- Account, plan and terms: <https://bdcourier.com/>
