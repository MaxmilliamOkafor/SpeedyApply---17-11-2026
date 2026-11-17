# SpeedyApply 2.28.3 — patched

SpeedyApply 2.28.3 from the Chrome Web Store, with fixes carried over from the
LazyApply and Jobright Autofill logs. Load the
`Download SpeedyApply Job Application Autofill Tool` folder with
**chrome://extensions → Developer mode → Load unpacked**. The version shows as
2.28.3.2.

## 2.28.3.2

- **Workday Work Experience is checked entry by entry after filling**
  (`content-scripts/wd-sections.js`, the same check LazyApply uses). Workday's
  CV parser pre-fills entries, sometimes with the same job twice, e.g. entry 2
  as Meta with From 01/2023 and To 12/2022, which Workday refuses with "Must
  end after start date". Each entry is now compared with the profile job at the
  same place (entry 1 = first job, ...). Title, company, location, description,
  "I currently work here" and From / To are corrected where they differ. Values
  are set through the input's native setter, so Workday keeps them. Missing
  entries are added and extra ones deleted. Clicking "I currently work here" no
  longer unticks a box the parser had already ticked.
- **"Do you currently reside / live / are you based in X?" → Yes** when X is a
  European country (or "the EU"), the UK, the United States or Canada. This is
  checked before your saved answers (`saResideYes`, in `zj`).

## 2.28.3.1

All changes are in `content-scripts/content.js`. Each is marked with `[sa+]`,
or is a one-line change to the function named below.

- **Answers no longer match words hidden inside other words.** Saved answers and
  the built-in rules matched a keyword anywhere in the question, so "age" was
  found in "management" and "language", and "ai" in "maintain". A keyword now
  has to start a word (`Rj`). "require" still matches "required".
- **The built-in "over 18" rule asks about age only.** It answered "Yes" when two
  of age / year / 18 / birthday appeared, so "How many years of experience in
  project management?" got "Yes". It now needs real age wording: "18 years",
  "age of 18", "years of age", "over 18", "18 or older" and similar.
- **The profile is tidied as it loads (`saTidyProfile`, used by `Dl`).** This
  affects every ATS, not only Workday:
  - A current role has no end date. Several ATS fillers typed the end date and
    also ticked "I currently work here".
  - An end date before its start date is left out ("Must end after start
    date").
  - Each language is used once ("Duplicate language entries are not allowed").
  - Each website is used once, ignoring `https://`, `www.` and a trailing `/`.
- **Workday websites:** LinkedIn, GitHub and personal website links that were
  already typed into their own questions are not added to the Websites list
  again ("You can't add duplicate website URLs") (`mI`).

`_metadata/verified_contents.json` still holds the store's hashes. Chrome checks
them only for store installs, not for unpacked extensions.

## Tests

```bash
node tests/sa-plus.test.js
```
