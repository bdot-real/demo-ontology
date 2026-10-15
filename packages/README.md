# Packages under CI

Mirrors of the onto packages whose changes go through PR review in this repo. Each directory holds an `onto.yaml` and its sources. A PR that touches one runs `.github/workflows/onto-check.yml`, which posts the registry's semantic diff and fails if the declared SemVer bump is too small.

`tax-indirect/` lands once `@tax/indirect` 1.0.0 is published (#6). The beat 5 branch `demo/bad-minor` and the beat 6 branch `demo/major` are built from the drafts in #8.
