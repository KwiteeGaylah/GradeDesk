# GradeDesk

An offline Windows desktop application that turns raw assessment scores into a
WVSTU grade record. The instructor types scores across the class list, one
assessment at a time, and GradeDesk does the transmutation, averaging, weighting
and letter grades, then exports the familiar Excel sheets.

Built for a university instructor at William V.S. Tubman University in Liberia.
It runs with no internet connection, on low-spec hardware, and keeps every
grade on the instructor's own machine.

## The correctness bar

The grading model is not an approximation of the instructor's spreadsheet, it
reproduces it exactly. A standing automated test loads the real semester
workbook in `data/`, takes only the raw scores, and checks the result:

| Check | Result |
|---|---|
| Students verified | 167 across 6 sections |
| Final grades matching | 167 / 167 |
| Letter grades matching | 167 / 167 |
| Intermediate class standings and term totals | all matching |
| Mismatches | 0 |

The same 167 students are also driven through the whole application — stored in
the database, computed by the gradebook the screens use, exported to `.xlsx`,
and restored from a backup — and still come out identical.

If that test ever fails, the engine is wrong, not the test.

## Running it

```
npm install
npm test              # the full suite, including the verification gate
npm start             # run the app
npm run dist          # build the Windows installer into dist/
```

Development harnesses that drive the real application:

```
npm run smoke         # boot the app, fail on any renderer error
npm run uitest        # drive a full workflow and cross-check on-screen grades
npm run screenshot    # write a PNG of the seeded UI
npm run icon          # rasterise build/icon.svg to the installer PNG sizes
```

## How it is put together

```
src/engine/      pure calculation, no UI and no I/O
  transmutation.js   snap-down lookup, the one place matching lives
  grades.js          class standing, term totals, final grade, letters
  policy.js          which policies may be offered, point-value validation
src/data/        SQLite storage and the bridge to the engine
  schema.sql         the model from Appendix B of the PRD
  store.js           CRUD; every write commits immediately
  gradebook.js       joins stored data to the engine; issue review
  backup.js          whole-database export and restore
src/export/      Excel output in the WVSTU layout
src/renderer/    the UI: left rail, grade entry, attendance, roster, config
src/main.js      Electron main process, owns the database and all IPC
```

The engine has no dependencies of its own and never touches the UI or the
filesystem, which is what makes the verification test able to run the exact code
the application runs. A test asserts that separation stays true.

## The grading model

Each term is scored out of 100, then combined.

```
transmuted     = snap-down lookup by (policy, point maximum); blank -> 50
class_standing = average(transmuted class-standing scores) x 0.60
term_total     = class_standing + transmuted_exam x 0.40
final_grade    = midterm_total x 0.40 + final_total x 0.60
```

Letters are A from 90, B from 80, C from 70, D from 60, otherwise F. A blank
midterm or final exam makes the letter `I` regardless of the number. `NG` means
the grade could not be computed at all.

Points worth keeping straight, because they are the usual places this goes
wrong:

- **Lookup is snap-down, never exact.** A raw score not listed takes the value
  of the nearest lower listed score, exactly like Excel `VLOOKUP(..., TRUE)`.
- **A blank assessment counts.** It transmutes to 50 and stays in the average.
  A blank *exam* is a different rule: it forces the letter `I`.
- **Attendance is recorded in whole points.** The raw division can produce
  9.1666..., which is neither how the workbook records it nor readable in a
  cell, so it is rounded to the nearest point before transmutation.
- **The final grade is truncated to two decimals, never rounded.** 89.999 is
  shown and exported as 89.99, a B. The one concession is that a value sitting
  a single floating-point step below a hundredth is treated as that hundredth,
  because seven real students land on such values.
- **The exam is always out of 40** and is not configurable.
- **There are no per-assessment weights.** Class standing is a flat average, so
  adding or removing an assessment never needs reweighting.
- **Point values are restricted to real table columns.** The 70% table has no
  20-point column, so the UI does not offer one under that policy.

## Transmutation tables

`data/transmutation_tables.json` holds all three policies and is loaded as data;
nothing is hard-coded. Their standing differs and the application says so:

| Policy | Standing |
|---|---|
| 70% | Grade-verified against the real workbook. The default. |
| 60% | Transcribed from the university source, structurally checked. |
| 50% | Transcribed from the university source, structurally checked. |

Structural checking means every column starts at 50, reaches 100 at its
maximum, lists every raw score, and never dips. Those checks run over all three
policies in the test suite; they are what caught an earlier mis-transcription.
Choosing 50% or 60% in the app shows a note saying it has not been cross-checked
against a completed grade sheet.

## Data and safety

Everything lives in one SQLite file under the user's application data
directory. Writes commit as they happen with `synchronous=FULL`, so "autosave"
is not a timer that can lose the last thing typed. Tests kill a process outright
immediately after a score is entered and confirm the score survives and the
database still passes an integrity check.

Back up and restore from the left rail. The backup is a single JSON file, chosen
over copying the database so it survives a future schema change and can be read
by a human if it ever has to be. Restoring replaces everything and asks first.

## Scope

v1 does one thing well. There is no Excel import, no per-student screen, no
statistics dashboard, no cloud, and no multi-user access. Archived semesters
stay readable and exportable.
