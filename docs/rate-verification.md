# Rate verification (#14)

The six real rates in `@tax/core` checked against official sources on 2026-10-16 (decision D4: real rates,
labelled and dated, "For demonstration, not tax advice"). To re-check, run `node scripts/verify-rates.mjs`
the week of the demo. It reads every production version of `@tax/core`, compares `seed/rates.jsonl` with
the pinned version, and fetches the live pages below.

| Rate | Value | Effective from | Provision | Evidence |
|---|---|---|---|---|
| GST, Canada | 5% ✔ | 2008-01-01 ✔ | ETA s.165(1) ✔ | CRA [GST/HST calculator](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html); CRA [GST/HST statistics tables](https://www.canada.ca/en/revenue-agency/programs/about-canada-revenue-agency-cra/income-statistics-gst-hst-statistics/gst-hst-statistics/gst-hst-statistics-tables-2017-2021-calendar-years.html), rate history: "Beginning January 1, 2008 … GST 5%" |
| HST, Ontario | 13% ✔ | 2010-07-01 ✔ | ETA s.165(2) in 2.0.0 ✔ (1.0.0 cites s.165(1), see #23) | Same two CRA pages: "Beginning July 1, 2010 … Ontario 13%" (n/a before) |
| QST, Québec | 9.975% ✔ | 2013-01-01 ✔ | AQST s.16 ✔ | Revenu Québec [Calculating the taxes](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/collecting-gst-and-qst/calculating-the-taxes/); [Tables of GST and QST rates](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/basic-rules-for-applying-the-gsthst-and-qst/tables-of-gst-and-qst-rates/): "January 1, 2013 – present 9.975%" |
| PST, BC (software) | 7% ✔ | 2013-04-01 ✔ | **✘ cites the whole Act; should be PSTA s.105(1)** | BC [TIM Part 4](https://www2.gov.bc.ca/gov/content/taxes/tim/pst/parts/pt-4): "Subsection 105(1) … tax at the rate of 7% of the purchase price of the Part 4 software"; [TIM PST](https://www2.gov.bc.ca/gov/content/taxes/tim/pst): "On April 1, 2013, British Columbia re-implemented the provincial sales tax" |
| Sales tax, NY (state) | 4% ✔ | 2005-06-01 ✔ | NY Tax Law §1105 ✔ | NY DTF [rates bulletin](https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/sales_tax_rates_additional_sales_taxes_and_fees.htm): "state rate (currently 4%)"; [Notice N-05-8](https://tax.ny.gov/pdf/notices/n05_8.pdf): "As of June 1, 2005, the state sales and use tax rate is decreased to 4%" |
| Sales tax, WA (state) | 6.5% ✔ | **✘ 1983-07-01; should be 1983-03-01** | RCW 82.08.020 ✔ | WA DOR [Retail sales tax](https://dor.wa.gov/taxes-rates/retail-sales-tax): "The state tax rate is 6.5%"; DOR [Chart 4](https://dor.wa.gov/sites/default/files/2022-03/chart_4.pdf), 1983: "State rate increased from 5.4% to 6.5% in 36 counties, effective 3/1/83 (remains at 5.4% in 3 border counties)"; 1985: border-county rate "disallowed by the Court, effective 1/1/85" |

The N-05-8 notice and DOR Chart 4 are PDFs, checked by hand; the script checks the HTML pages.

## Errata sent to the ontology agent

1. **`rate-ST-WA` effectiveFrom** is 1983-07-01. DOR says 6.5% took effect 1983-03-01; 7/1/83 is the date of
   that year's B&O, utility and gasoline changes, not the sales tax. Defensible value: 1983-03-01, noting
   in the comment that three border counties stayed at 5.4% until 1985-01-01.
2. **`rate-PST-BC` imposedBy** is `bc_provincial_sales_tax` ("Provincial Sales Tax Act (BC)"), the whole Act.
   The 7% tax on software is imposed by PSTA s.105(1).
3. **`rate-QST-QC-2027`** (the hypothetical rate in scripted `@tax/core` 1.1.0) carries Revenu Québec's real
   `sourceUrl` and `verifiedOn 2026-10-16`. Both are optional in the TaxRate shape. A made-up rate shouldn't
   claim it was verified against an official page.

The registry rated the HST citation fix (a data-value change) as major, so errata 1 and 2 together mean one
more major of `@tax/core` (3.0.0). The alternative is to leave them as documented errata. That's the user's call.
Neither changes any number in the October position: both dates are long before October 2026.

## Scope note: US rates are state-only

`rate-ST-NY` (4%) and `rate-ST-WA` (6.5%) are the **state** rates, and both are correct as such. A seller
actually collects the combined state + local rate for the customer's location. Examples: New York City
8.875% (4% state, 4.5% city, 0.375% MCTD) and Seattle over 10%. Both official pages say so. The demo's NY and
WA lines therefore show the state portion only and understate what Maplewood would actually collect.
Either label those lines "state portion" in the agent's output, or model local rates. That's a scope
decision for the user.

## Still open in #14

- QST Q4 2026 due date: 2027-01-31 is a Sunday; roll-forward to Monday 2027-02-01 not yet confirmed.
- Re-run `scripts/verify-rates.mjs` and re-check the threshold URLs on #6 the week of the demo.
