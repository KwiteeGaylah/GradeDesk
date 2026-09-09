# GradeDesk — Context for Claude Code

Read this first. It is the orientation for the whole project: what it is, why it
exists, what was already figured out, and the specific things that are easy to get
wrong. The formal spec is `GradeDesk_PRD.md`; this document is the working memory
behind it.

---

## 1. What you are building

A **desktop application** that replaces the manual Excel workflow instructors use to
produce university grade records. The instructor enters raw assessment scores; the app
transmutes, averages, weights, and produces final grades, letter grades, and an
export in the university's familiar format.

It is **offline, single-user, single-machine**. No server, no accounts, no cloud in v1.
Data lives on the instructor's computer and must survive restarts.

The first and only user for v1 is a university instructor at William V.S. Tubman
University (WVSTU) in Liberia. The author of the spec is himself one. The realities
that shaped every decision: unreliable power, poor connectivity, low-spec Windows
laptops. That is why it is offline-first and light.

**What it is not:** not an LMS, not a student information system, not a web app, not a
gradebook-as-a-service. It does one boring thing extremely well.

---

## 2. Why it exists (the real problem)

Instructors turn raw marks into the required grade record entirely by hand in Excel.
Every raw score must be looked up in a university transmutation table, averaged into a
"class standing" figure, combined with an exam score into a term total, then merged
across two terms into a final grade and letter. Across dozens of students and a dozen
assessments, this is slow and error-prone. The real grade files already contain small
inconsistencies that exist only because it is done by hand.

The product's promise is narrow and concrete: **stop doing your grade sheet manually,
and get numbers that match what you'd have computed, exactly.**

---

## 3. How the grading model was verified (trust this)

Do not treat the grading rules as assumptions. They were reverse-engineered from the
instructor's real workbook and then **proven**:

- The transmutation logic was found to be a lookup table (VLOOKUP), not a formula. The
  three policy tables (50%, 60%, 70%) were transcribed and unit-checked against the
  source PDF.
- The full grade engine was rebuilt from raw scores and run against the instructor's
  actual semester file: **114 students across 6 course sections. Every final grade and
  letter matched exactly. Zero mismatches.**

This is your correctness bar. The app's engine, fed the same raw scores, must
reproduce those same final grades. Build that comparison in as an automated test early;
it is the single most valuable check in the project.

---

## 4. The grading model, exactly (memorize this)

### Term structure
Two terms: midterm term and final term. Each is scored out of 100 on its own, then
combined.

### Transmutation (the core, most error-prone part)
- A raw score is converted to a 50–100 value via a **lookup table**, selected by the
  assessment's point-maximum (a column) and the course's policy (50/60/70).
- **Matching is approximate / snap-down**, identical to Excel `VLOOKUP(..., TRUE)`: for
  a raw score not listed, use the value of the **nearest lower** listed score. Getting
  this wrong drifts grades by a point and silently breaks the verification. Do not use
  exact-match lookup.
- A **blank** score transmutes to **50** (the value at raw 0) and still counts in the
  average. It is not skipped.
- Load the tables from `transmutation_tables.json`. Do not hard-code them, and do not
  copy the partial table embedded in the mockup.

> **Correction (post-review, now resolved).** An earlier build of the JSON had three
> mis-transcribed 70% columns (30, 35, 40) and two bad 60% columns (30, 40). All are now
> fixed. The 70% columns were corrected from the instructor's authoritative workbook
> table and the JSON reproduces every real grade with zero mismatches. The two 60%
> columns were re-transcribed from the source PDF and now pass all structural checks
> (start at 50, reach 100 at max, monotonic), and cross-check correctly against the 50%
> and 70% columns (50% ≥ 60% ≥ 70% at every raw). **All three policies are now
> usable.** Note the distinction: the 70% policy is *grade-verified* against 114 real
> students; the 50% and 60% policies are *structurally verified* (transcribed from the
> source PDF and sanity-checked) but not grade-verified, since the real dataset uses
> only 70%.

### Class standing
Equal-weight **average** of the transmuted assessment scores in a term, times 0.6.
There are **no per-assessment weights**. Every assessment counts equally. This is why
adding or removing an assessment needs no reweighting — it just changes what is
averaged.
```
class_standing = average(transmuted assessment scores) × 0.60
```

### Exam and term total
The major exam is transmuted like any assessment, then weighted 40%:
```
term_total = class_standing + (transmuted_exam × 0.40)
```
The exam maximum is **always 40** and is **fixed** (not configurable like other
assessments).

### Final grade
```
final_grade = (midterm_total × 0.40) + (final_total × 0.60)
```
Displayed and exported to **two decimals, no rounding** (e.g. `82.18`). The displayed
value is the exact computed value. This was a deliberate decision — do not round.

### Letter grade
`A ≥ 90`, `B ≥ 80`, `C ≥ 70`, `D ≥ 60`, else `F`.
- `I` (Incomplete): if the **midterm exam or final exam raw score is blank**, regardless
  of everything else.
- `NG` (No Grade): if the final grade cannot be computed at all.

### Attendance (a normal assessment with an auto-computed raw score)
Marks per session: `P` = present (full), `E` = excused (half), anything else = 0. A
blank cell means the session was not taken for that student and is excluded.
```
attendance_raw = points × (count_P + 0.5 × count_E) ÷ count_of_marked_sessions
```
The denominator is **sessions actually marked so far**, not the planned total. The
resulting raw score then transmutes and averages like any other assessment. Attendance
`points` is configurable but must be a supported table max (default 10).

Full pseudocode for all of the above is in **Appendix A of the PRD** — implement from
there, it is the source of truth for the math.

---

## 5. Supported point-maximums (a real constraint, not cosmetic)

An assessment's max must be a column the active policy's table actually has:
- 50% and 60%: `5, 10, 15, 20, 25, 30, 35, 40, 45, 50`
- 70%: `5, 10, 15, 25, 30, 35, 40, 45, 50` (**no 20-point column**)

The UI must offer only supported maxes for the active policy, and warn if switching
policy would strand an existing assessment's max. An instructor should not be able to
set a 15-point task to "100 points" — validate against real columns, while still
allowing a deliberate override.

---

## 6. The central interaction (get this right and the app is 80% there)

Everything is done **across the whole class list, one assessment at a time.** Never
per-student. The instructor picks a course, picks an assessment (e.g. "Quiz 1"), sees
the full roster with one editable column, and types scores straight down like an Excel
column (Enter/Tab advances). Computed columns (transmuted, class standing, term total,
final grade, letter) update live and are read-only.

This mirrors how they already work in Excel and is the whole reason the tool feels
natural. The mockup shows exactly this — study `GradeDesk_Mockup.html`.

---

## 7. Decisions already locked (do not relitigate)

| Decision | Ruling |
|---|---|
| Rounding | None. Two decimals on the final grade. |
| Exam maximum | Always 40, fixed, not configurable. |
| Class-standing weighting | Equal-weight average. No per-assessment weights. |
| Attendance marks | P (full), E (half), else 0; blank excluded from denominator. |
| Attendance denominator | Sessions marked so far, not planned total. |
| Transmutation source | Lookup table from JSON, snap-down match, blank = 50. |
| Platform | Windows desktop, offline. |
| Roster input | Typed grid. No Excel import in v1. |

---

## 8. Still open (minor, won't block building)

- Confirm the transmutation **policy is always course-wide**, never mixed within a
  course. (Assume course-wide.)
- Confirm blank-non-exam-assessment-counts-as-50 is intended policy, not a spreadsheet
  artifact. (Behave as if intended; it matches the verified result.)

Neither changes the engine. Proceed.

---

## 9. Build guidance

- **Tech choice is yours, but honor the constraints:** offline, Windows, low-spec,
  installs and runs without internet, data persists locally, no browser storage
  gimmicks that lose data. A desktop stack (e.g. Electron/Tauri + a local store, or a
  native toolkit) is fine; pick what ships a reliable Windows app you can hand someone
  as a file.
- **Separate the engine from the UI.** The grade engine (transmute → average →
  weight → letter) should be pure, testable functions with no UI dependencies. The UI
  calls it. This makes the verification test trivial and keeps the math auditable.
- **Load `transmutation_tables.json` as data.** One module owns lookups. Snap-down
  match lives in exactly one place.
- **Wire the verification test first.** If you can get the instructor's real file
  (114 students, 6 sections) as fixtures, assert the engine reproduces every final
  grade. If not available yet, at least unit-test the worked examples in the PRD
  (e.g. 70% table: 10-pt raw 8 → 80, raw 5 → 64, raw 0 → 50, raw 10 → 100).
- **Two exports:** full grade record (WVSTU-like layout) and a summary (ID, name, final
  grade, letter). Both as Excel, openable and submittable without extra formatting.
- **Autosave and never lose data.** This is a trust product; a lost semester of grades
  kills it.

---

## 10. Traps specific to this project

1. **Exact-match lookup instead of snap-down.** The commonest way to silently break
   grades. Use nearest-lower.
2. **Copying the mockup's fake columns.** `class_standing` and `term_total` in the
   mockup JS are faked for display and labelled as such. The inline `T70` table there is
   a partial subset. Neither is a data or logic source. Use the PRD pseudocode and the
   JSON.
3. **Rounding "to be helpful."** Do not. Two decimals, exact.
4. **Treating the exam as configurable.** It is fixed at 40.
5. **Adding per-assessment weights.** There are none. It is a flat average.
6. **Offering unsupported maxes** (e.g. a 20-pt assessment under the 70% policy). The
   70% table has no 20 column.
7. **Blank handling.** Blank assessment → transmutes to 50 and counts. Blank **exam** →
   whole letter becomes `I`. These are different rules; keep them straight.

---

## 11. File map

```
docs/
  CONTEXT_FOR_CLAUDE_CODE.md   ← this file, read first
  GradeDesk_PRD.md             ← full spec; Appendix A = math pseudocode, Appendix B = data model
  GradeDesk_Mockup.html        ← visual/interaction reference ONLY (open in a browser)
data/
  transmutation_tables.json    ← the three lookup tables; load as data, do not hard-code
```

Recommended reading order for a fresh agent: this file → PRD sections 3–5 (the model) →
Appendix A (pseudocode) → open the mockup → PRD section 5 (functional requirements) →
start with the pure grade engine and its test.

---

## 12. One-paragraph summary (if you read nothing else)

Build an offline Windows app that lets an instructor type raw scores across a class
list, then computes grades exactly the way their Excel sheet does. The math is verified
against 114 real students and must stay that way: transmute each raw score via a
**snap-down lookup** in `transmutation_tables.json` (blank → 50), average the transmuted
class-standing scores × 0.6, add transmuted exam × 0.4 for each term total, combine
midterm × 0.4 + final × 0.6, show the final grade to **two decimals with no rounding**,
and map to A/B/C/D/F with I for a blank exam. Exam is fixed at 40; assessments are a
flat equal-weight average and are add/remove/configurable within supported table maxes.
Attendance is a normal assessment whose raw score is auto-computed from P/E session
marks. Keep the engine pure and tested, keep data safe and local, and export the two
familiar sheets.
