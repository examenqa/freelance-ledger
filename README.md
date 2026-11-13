# Freelance Ledger

A local-first Windows desktop finance tracker for freelancers and small agencies.

The visible application name is **Freelance Ledger by Examen QA**. This is a
reviewed source snapshot of the plain JavaScript/Electron desktop application,
based on **0.3.0-rc.1**. It includes a small header/window-title update that is
absent from the currently installed build. No installer or release binary is
published with this import.

The existing application ID, package/executable/installer identity, storage
locations and settings filenames remain unchanged. A normal development launch
can therefore use the same profile as an existing installation. The isolated
review command below is preferable when evaluating the source with synthetic data.

## Desktop application features

- Client and contract management
- Weekly work and hours tracking
- Incoming payment queues and recorded receipts
- Employee payouts and payment history
- Expense tracking and GST RCM reports
- USD/INR references and local PDF/XLSX reporting
- Analytics for receipts, hours, expenses, and employee payouts

Analytics runs locally with native SVG charts, shared filters, exact-record
drill-down and keyboard-accessible View data tables. It separates received
money, recorded work, expense base and paid employee payouts. Pending incoming
estimates and pending payouts are separate commitments. See the
[reporting definitions](docs/reporting.md).

## Setup and tests

Use Windows and Node.js 24. The import was checked with Node **24.13.1** and npm
**11.8.0**. Install the locked development dependencies in the cloned checkout:

```powershell
git clone https://github.com/examenqa/freelance-ledger.git
cd freelance-ledger
npm ci
npm test
```

The full existing suite contains **174 tests** and uses built-in Node tooling,
synthetic records, VM mocks and disposable test directories. Tests do not launch
Electron or read the active application data. A few storage tests can leave
synthetic temporary directories behind.

For an isolated, empty development review, use a new directory inside this
checkout. The generated directory is ignored by Git:

```powershell
$ledgerReviewRoot = Join-Path (Get-Location).Path (".review-" + [guid]::NewGuid().ToString())
npm start -- "--review-root=$ledgerReviewRoot"
```

Review mode redirects profile, session and data paths to that disposable
directory and blocks external network requests. Keep any reviewed data
synthetic. It is an application review safeguard, not an OS security sandbox.
`npm start` without the review argument is a normal launch; back up current data
before using development code with an existing profile.

## Windows packaging

```powershell
npm run dist
```

This is the existing electron-builder Windows NSIS packaging command. It writes
generated files to `dist/`; it does not install the application. There is no
`npm run build` script. The lockfile and build configuration are retained from
the desktop release, including its legacy executable/installer names and icon.
Packaging and interactive application checks were not repeated for the public
title change; no rebuild or installation was requested for this import.

## Prerelease limits

- Saved USD and INR values are reported independently; missing values remain
  unavailable. INR is a saved historical reference, not a bank reconciliation.
- Client attribution follows current contract/client associations. Historical
  client ownership is not stored as a separate snapshot.
- Overview, Records, GST reports and Analytics have different legacy scopes;
  their totals are not interchangeable. Analytics does not claim accounting
  profit or margin and has no separate export action.
- Windows layout and keyboard checks are representative. Chromium accessibility
  text-selection diagnostics were observed during forced accessibility
  inspection; they did not recur in a narrower confirmation. Full screen-reader,
  physical DPI, multi-monitor and printing coverage is incomplete.
- The dependency tree is retained as reviewed. Setup may emit upstream
  deprecation warnings; no dependency upgrade or security certification is
  implied by a passing test suite.

See [known reporting and verification limits](docs/known-limitations.md).
Custom logo uploads and user-editable titles are future enhancements; this
snapshot adds no such controls.

## Data privacy

Financial records, settings, backups, private review evidence, credentials, and screenshots containing real records must stay outside this public repository. Examples and test fixtures must use synthetic data.

This import contains an explicitly reviewed file selection and the new
repository's existing history. It does not include the private development Git
history, captured financial aggregate fixtures, machine acceptance records,
profiles, backups, review screenshots/logs, installers, dependencies or build
outputs. Test records are synthetic; one ambiguous test reference was replaced
with an explicit synthetic token.

Ignore rules are a safeguard, not a privacy audit. Review the actual staged files
and commit contents before publishing examples or test changes.

## License

[MIT](LICENSE). The repository owner confirmed permission to publish the source
and bundled logo/icon under this license. Third-party dependencies retain their
own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
