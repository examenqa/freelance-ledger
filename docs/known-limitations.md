# Freelance Ledger prerelease limitations

The source snapshot is based on desktop version 0.3.0-rc.1. Its visible header and
window title now read **Freelance Ledger by Examen QA**, including the isolated
review title with its review marker. This display-only change is absent from the
installed build used as the import baseline. Package version, application ID,
installer/executable names, icon, installation behavior, data paths and settings
filenames are retained. No rebuild, installation or active-data workflow was run
for this publication step.

## Reporting differences

- Analytics paid payouts use actual payment dates. Some existing summaries and
  reports use scheduled dates or work periods. Those totals can legitimately
  belong to different months; a missing actual date stays undated in Analytics.
- Analytics hours use work-period start month. Existing report filters can use
  the report's chosen work-period scope; they are not a daily allocation of a
  week that crosses a month boundary.
- Pending incoming work is an estimate, separate from received income. Legacy
  screens can include broader incoming scopes. Read their labels and source
  records before comparing them with Analytics receipts.
- Legacy presentation/calculation paths may coerce unavailable values to zero.
  Analytics preserves unavailable/partial amounts. Missing history has not been
  backfilled to make the screens agree.
- GST reports are tax views. Their base, GST and combined totals must not be
  mistaken for received revenue or accounting profit.

These legacy reporting behaviors remain separate follow-up work. The import
does not change them or rewrite historical records. See the
[Analytics reporting contract](reporting.md) for its explicit scopes.

## Verification coverage

The full suite passes with 174 tests using synthetic records, VM fixtures and
temporary storage. It covers financial preservation, validation, reporting,
exports, workflow/recovery boundaries and Analytics contributor/filter behavior.
Required runtime assets are included. The unused captured historical aggregate
fixture and private acceptance evidence are excluded.

Prior desktop review exercised representative restored, maximized, minimum-size,
empty/incomplete and simulated-scale states. These are not every metric/filter,
keyboard, physical DPI, multi-monitor or hardware-rendering permutation. The
public display-title change has syntax, scope and full-suite checks, but no new
packaged or visual acceptance claim.

Three Chromium accessibility text-selection diagnostics occurred with forced
renderer accessibility and UI Automation text inspection. A confirmation without
those two conditions did not reproduce them. The cause was not isolated, and
full screen-reader compatibility remains unverified. No accessibility engine or
dependency fix is included here.

Analytics has View data tables rather than a new export action. Existing PDF/XLSX
logic has automated coverage; complete physical printing and native spreadsheet
application testing are not claimed. This is application verification, not a
financial audit, bank reconciliation or comprehensive security review.

The existing lockfile includes upstream deprecation notices. No dependency
updates, vulnerability remediation, code signing or new release packaging are
part of this source import. Future binary distributors must retain the project
license and the dependency notices required by their distribution.
