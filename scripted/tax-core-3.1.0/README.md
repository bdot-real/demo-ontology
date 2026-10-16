# Tax Core

Core tax concepts for modeling tax rates, authorities, and types.



- 6 classes and 8 properties
- Example data in `fixtures/examples.ttl`, competency questions in `tests/`

## 3.0.0

- `rate-PST-BC` is imposed by PSTA s.105(1) (`@legal/acts` `bc_psta_s105_1`, new in @legal/acts 1.2.0),
  not the whole Act. Requires `@legal/acts` ^1.2.
- `rate-ST-WA` took effect 1983-03-01, not 1983-07-01 (WA DOR Chart 4); three border counties stayed at
  5.4% until 1985-01-01.
- `rate-ST-NY` and `rate-ST-WA` are labelled as state rates only; local rates are not modelled.

## 2.0.0

- `rate-HST-ON` is imposed by ETA s.165(2) (`@legal/acts` `excise_tax_act_s165_2`, new in @legal/acts 1.1.0),
  not s.165(1). Requires `@legal/acts` ^1.1.

> Drafted by a local model (qwen3:30b-a3b) with the onto agent and validated with `onto test`. Review the
> modelling before publishing.
