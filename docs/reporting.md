# Freelance Ledger reporting definitions

Analytics reports saved financial history and recorded work. It does not repair
records, refresh financial exchange rates, reconcile payouts, or save data while
filtering and rendering. The title update in this source snapshot changes display
text only.

| Metric | Stored source | Inclusion and date basis |
| --- | --- | --- |
| Net money received | `incomingPayments.netUsd`, `netInr` | Received records; receipt `paymentDate`. An absent legacy received flag is inferred with disclosure. Pending work estimates are separate. |
| Hours worked | `timeEntries.hours` | Valid finite positive hours with a real, ordered work period; group the whole period by `weekStart` month. Weeks crossing months are not split. |
| Recorded expenses | `expenses.amountUsd`, `amountInr` | Expense base grouped by `expenseDate`; saved GST is shown separately and excluded from this card. |
| Employee payouts marked paid | `payouts.totalUsd`, `totalInr` | Boolean `paid: true`; actual `paidDate`. A scheduled date never replaces a missing actual payment date. |

Strict numeric/calendar validation distinguishes missing or invalid values from
genuine zero. Partial totals show known subtotals and exceptions. USD and INR
completeness are independent; no current exchange rate is applied to history.
Saved pay rates, FX and paid snapshots are preserved.

Overall and employee payout totals count each saved parent once. Contract/client
views use only saved allocation portions that reconcile with their parent,
independently in each currency at the application's two-decimal precision.
Matching client filters count matching portions only. Parents are never added to
their lines. Unresolved allocations stay visible without an invented balance.

Archived entities remain included in historical reporting. Orphaned or ambiguous
identities stay visible. Client reporting follows the contract's **current**
client association; the application cannot reconstruct a prior association that
was not saved. Duplicate identities, overlapping work and ambiguous payment
groups can produce exceptions rather than an assumed value.

## Scopes and filters

- Cards and breakdowns use Selected month or All time. The default month is the
  actual runtime current month.
- The monthly trend always covers twelve months ending at the selected month.
- Commitments are explicitly all-period pending incoming estimates and saved
  pending payouts. They are not certified invoice balances or received money.
- Valid undated monetary values can contribute to All time. Undated/invalid-date
  buckets explain their absence from monthly charts.
- Employee filters cannot attribute receipts or general expenses to an employee;
  those panels are disabled. Client/contract filters cannot allocate general
  expenses; that panel is disabled too.

View data exposes chart values and exact source/allocation contributors,
including saved amounts, counted contributions, statuses and warnings. Source
indexes identify positions in the loaded dataset. Tables are keyboard reachable,
and full labels are available even when chart labels are shortened.

No profit/margin metric is claimed. Received money, employee payouts, expense
base, GST, deductions, unpaid work and agency-retained amounts are distinct
concepts with different dates and historical completeness.
