# Loan & EMI calculator

A small, static HTML/CSS/JavaScript calculator for monthly loan repayments, prepayments, EMI changes and interest-rate changes. No build step, framework or backend is needed.

## Try it

Open `index.html` in a modern browser. For consistent browser storage behavior, serve this folder locally:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765. Loan details and changes save to this browser automatically after a successful calculation. Storage may be unavailable in some file/private browsing contexts; the calculator still works and displays a notice if saving fails.

The app reads the original calculator's jStorage data on the same origin. Existing prepayments default to **Reduce tenure**. New data uses a separate versioned key, leaving the original data available if you switch back to the old branch. Reset replaces only this calculator's new saved state; it does not clear unrelated browser storage.

## Prepayment options

- **Reduce tenure:** keep the EMI and finish earlier.
- **Reduce EMI:** reduce the payment from the next installment while preserving the current scheduled payoff date. If an earlier prepayment shortened the term, that earlier payoff date is retained.

You can mix both options, edit or remove changes, and change the EMI or annual interest rate manually. Results refresh when loan fields change or a change is added, edited or removed.

## Calculation rules

- Amounts use integer minor units (two decimal places). Monthly interest and the regular EMI round to the nearest minor unit. The final scheduled installment settles the remaining principal and interest, including accumulated rounding differences.
- The first EMI date represents the first installment, with one full month of interest. Later installment dates retain its day where possible, clamping to the month's last day (January 31 → February 28 → March 31).
- Changes apply to the selected **calendar month**, not a prorated day. Rate and manual EMI changes apply before that month's interest/payment calculation; prepayments follow its regular EMI. Within each category, changes follow date order, with entry order breaking same-date ties. The last rate/EMI entered chronologically for that month takes effect.
- An interest-rate change keeps the EMI and recalculates tenure. A manual EMI change also recalculates tenure. Prepayment choices then apply to that revised term.
- Excess prepayments are capped at the balance needed to close the loan. Unused amounts and changes after payoff are reported rather than included in totals.
- “Interest saved” compares with the original loan without any changes. Increased cost is labeled “Extra interest”; it is not presented as a saving.
- An EMI that cannot cover monthly interest is rejected unless that month's prepayment closes the loan. Loans requiring more than 1,200 installments are rejected. There is no daily interest, fee, penalty, tax or lender-specific adjustment model.

## Code and verification

- `js/calculations.js`: pure calculation engine, usable in a browser or Node.js. Returned monetary values are integer minor units.
- `js/app.js`: form handling, rendering and device storage.
- `css/view.css`: responsive interface and print styles.

Run the regression tests with Node.js 20 or newer:

```sh
node --test tests/*.test.js
```

For a quick manual check, use 100,000 at 11% for 240 months starting January 31, 2026, and add 20,000 on February 20, 2026. Reduce tenure should finish in 138 installments; Reduce EMI should retain 240 installments and lower the EMI from 1,032.19 to 825.27 starting in March. Also try zero interest, a prepayment larger than the balance, editing/removing a change, and refreshing the page to check saving.

This is an estimate. Actual lender schedules can differ in payment timing, fees and rounding.
