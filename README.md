# Freelance Ledger by Examen QA

Track client work, payments, employee payouts, and expenses in one Windows desktop app.

Freelance Ledger is built for freelancers and small agencies that need to connect the hours they record with the money they receive and pay out. Financial data is stored locally, and the Analytics tab helps you explore it by month, client, contract, or employee where that breakdown is supported.

**Status:** Prerelease (`0.3.0-rc.1`). Source code is available here; a downloadable Windows installer has not been published yet.

## What you can do

- **Manage clients and contracts:** Organize work sources, clients, contracts, employees, and rates.
- **Track weekly work:** Record hours, review entered weeks and gaps, and pick up where you left off.
- **Review incoming payments:** Sort and filter the payment queue, select related entries, and record receipts and deductions.
- **Manage employee payouts:** Review scheduled payments and record paid dates and transaction references.
- **Track expenses and GST:** Group expenses by type and prepare GST RCM reports.
- **Explore your numbers:** View receipts, hours, expenses, and paid payouts with monthly trends, All-time totals, supported filters, and exact-record View data tables.
- **Export and back up:** Generate PDF and Excel reports from supported record views, and import or export your application data as JSON.

USD amounts and saved INR references are shown separately. Analytics identifies missing or incomplete values rather than treating them as zero.

## Get started

You will need **Windows**, **Git**, and **Node.js 24 with npm**.

Run these commands in PowerShell:

```powershell
git clone https://github.com/examenqa/freelance-ledger.git
cd freelance-ledger
npm ci
```

### Try it with separate data

For a first look, launch an empty review profile:

```powershell
$ledgerReviewName = ".review-" + [guid]::NewGuid().ToString()
$ledgerReviewRoot = Join-Path (Get-Location).Path $ledgerReviewName
npm start -- "--review-root=$ledgerReviewRoot"
```

This keeps the trial's data and profile in a separate folder inside the checkout and blocks external network requests in review mode. Use synthetic records to explore the app.

For a normal development launch:

```powershell
npm start
```

**Already have the app installed?** A normal development launch may use the same local profile and data. Back up your current data before opening it with development code, or use the separate review profile above.

## Your first workflow

1. Open **Setup** to add work sources, clients, contracts, employees, and rates.
2. Enter hours in **Weekly Work** and use its progress view to review earlier periods.
3. Record receipts in **Incoming**, employee payments in **Payouts**, and costs in **Expenses**.
4. Open **Analytics** for trends and breakdowns, or **Records** to review history and generate reports.

## Understanding the reports

Analytics keeps received money, worked hours, expense base, and employee payouts separate. Pending incoming work is shown as an estimate, and pending payouts are shown as commitments.

Monthly grouping depends on the metric: receipt date for money received, work-period start for hours, expense date for expenses, and actual paid date for employee payouts. Net receipts are not a calculation of accounting profit.

See the [reporting definitions](docs/reporting.md) for currency handling, filters, date rules, and incomplete values. Analytics offers View data tables; exports are available from supported Records views.

## Development

Run the test suite:

```powershell
npm test
```

Tests use synthetic records and disposable storage.

Build a Windows installer:

```powershell
npm run dist
```

Build output is written to `dist/`. Generated executables and installers currently use the legacy name **ExamenQA Payment Tracker**; the application header and window title use **Freelance Ledger by Examen QA**.

## Project status and feedback

This is prerelease software. See [known limitations](docs/known-limitations.md) for reporting differences, accessibility, and platform coverage. Custom logo uploads and editable app titles are planned enhancements.

Bug reports, feature suggestions, and contributions are welcome. [Open an issue](https://github.com/examenqa/freelance-ledger/issues) with the app version, steps to reproduce the problem, and what you expected to happen. Use synthetic examples and keep real financial records, credentials, and private screenshots out of public reports.

## License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for bundled components.
