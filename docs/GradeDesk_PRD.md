# GradeDesk — Product Requirements Document

**A desktop grade-recording and transmutation tool for university instructors**

| | |
|---|---|
| Author | Kwitee D. Gaylah |
| Status | v2.2 (verified) |
| Date | September 2026 |
| First users | WVSTU instructors |

> **Grading model verified against real data.** The complete grading logic in this document was tested against the author's actual semester workbook: 114 students across 6 course sections. Every final grade and letter grade was reproduced exactly from raw scores, with zero mismatches. The transmutation rule is confirmed: it is a lookup table, not a formula.

---

## 1. Overview

### 1.1 Problem

Every semester, instructors at William V.S. Tubman University (WVSTU) turn raw student marks into the university's required grade record by hand in Excel. Each raw score must be transmuted through a university lookup table, averaged into a class-standing figure, combined with a transmuted exam score into a term total, and finally merged across two terms into a final grade and letter. Across dozens of students and many assessments per course, this is slow, repetitive, and error-prone. Real grade files already contain small inconsistencies that exist only because the work is manual.

### 1.2 Product

GradeDesk is an offline desktop application that mirrors how instructors already grade in Excel but removes the manual transmutation and calculation. The instructor works down the class list entering one assessment at a time across all students, exactly as in a spreadsheet column. GradeDesk performs every calculation automatically using the verified WVSTU model, and exports results in a familiar Excel format so nothing about submission changes.

### 1.3 What GradeDesk is not

- Not a learning management system.
- Not a student information or school-management system.
- Not an online platform. It runs locally, offline, on the instructor's own computer.
- Not a replacement for the submission format. It produces that format.

### 1.4 Goals

- Cut the time and effort of producing a WVSTU grade record to a fraction of the Excel process.
- Reproduce WVSTU grades exactly, to the decimal, matching the instructor's current results.
- Let each instructor add or remove assessments per course and set each assessment's point value.
- Keep all data on the instructor's machine, saved between sessions, transferable later.
- Support multiple courses and multiple semesters, with past semesters archived and one active semester at a time.

### 1.5 Non-goals for v1

- No importing or auto-parsing of existing Excel files. The instructor types the roster into a table.
- No cloud sync, no accounts, no multi-user access. Single instructor, single machine.
- No per-student data-entry screens. All grade entry is done across the full class list.
- No department-level or administrator features.

---

## 2. Users and founder-market fit

The primary and only v1 user is a university instructor who currently produces WVSTU grade records in Excel. The author is himself such an instructor, giving a direct line to the exact workflow, the exact template, and a built-in first market: other instructors at the same university using the identical grading rules.

**Primary user story:** "As an instructor, I want to open my course, see my whole class list, enter one assessment's scores straight down the list, and have GradeDesk handle the transmutation, averaging, and letter grades, so I can produce my WVSTU grade sheet without building and maintaining Excel formulas."

---

## 3. Grading model (verified)

This section is the calculation contract. Every rule here was confirmed by reading the live formulas in the author's workbook and by rebuilding all 114 students' final grades from raw scores with a zero-mismatch result.

### 3.1 Term structure

The semester has two terms: the midterm term and the final term. Each term is scored out of 100 on its own, then the two are combined into the final grade.

### 3.2 Assessments and class standing

Each term contains a set of class-standing assessments (quizzes, assignments, attendance, class work, project, and so on) plus one major exam. The number and type of assessments varies by course and instructor, so they are fully configurable (see section 5).

Class standing is the **equal-weight average** of the transmuted assessment scores in that term, multiplied by 0.6. There are no per-assessment weights: every assessment in a term counts equally. Adding or removing an assessment simply changes what is averaged.

```
class_standing = average(transmuted assessment scores) × 0.60
```

Attendance is one such assessment. Its raw score is computed automatically from session marks (see 5.5) rather than typed, but it is otherwise a normal class-standing assessment: transmuted through the table and averaged equally with the others.

### 3.3 Exam and term total

The major exam (midterm exam or final exam) is transmuted through the table like any other score, then contributes 40% of the term:

```
term_total = class_standing + (transmuted_exam × 0.40)
```

Because class standing already includes its ×0.6 factor, a term total is on a 0–100 scale. The major exam is always out of 40 points. Unlike class-standing assessments, the exam maximum is fixed, not configurable.

### 3.4 Final grade

| Term | Weight in final grade |
|---|---|
| Midterm term total | 40% |
| Final term total | 60% |
| Final grade | 100% |

```
final_grade = (midterm_total × 0.40) + (final_total × 0.60)
```

### 3.5 Letter grade

| Final grade | Letter |
|---|:---:|
| 90 and above | A |
| 80 to 89.99 | B |
| 70 to 79.99 | C |
| 60 to 69.99 | D |
| Below 60 | F |

**Final grade display:** the final grade is shown and exported to two decimal places (e.g. 82.18). There is no rounding; the displayed value is the exact computed value.

**Special cases (from the live formula):**

- **I (Incomplete):** assigned when the midterm exam or the final exam raw score is blank, regardless of other scores.
- **NG (No Grade):** assigned when the final grade cannot be computed at all.

---

## 4. Transmutation (verified core)

Transmutation converts a raw score into a floor-to-100 value using a fixed university lookup table. It is not a formula. This was the single most important thing to get right, and it is now confirmed against the real workbook.

### 4.1 How the lookup works

- The university publishes transmutation tables at three policy levels: **50%, 60%, and 70%**. The author's workbook uses the 70% table throughout. All three ship with the product and are selectable.
- Each table has one column per assessment point-maximum. The instructor sets an assessment's maximum (for example 15 points), and that selects the column.
- The lookup uses **approximate (snap-down) matching**, exactly like Excel's `VLOOKUP` with `TRUE`. A raw score not listed exactly takes the value of the nearest lower score in the table. **This must be replicated precisely or a few grades will drift by a point.**
- A blank assessment score transmutes to 50 (the value at raw score 0). A blank is not skipped; it counts as 50 in the average.

### 4.2 Worked example (70% table)

An assignment out of 10, raw score 8, in the 70% policy: the 10-point column maps 8 to 80. A raw 5 maps to 64, a raw 0 to 50, a raw 10 to 100.

| Raw (out of 10) | 0 | 3 | 5 | 8 | 10 |
|---|:-:|:-:|:-:|:-:|:-:|
| Transmuted (70%) | 50 | 59 | 64 | 80 | 100 |

### 4.3 Supported point-maximums per policy

An assessment's maximum must be one the chosen table actually has a column for. The app offers only supported maximums, and warns if a policy change would strand an existing assessment's maximum.

| Policy | Supported maximums |
|---|---|
| 50% | 5, 10, 15, 20, 25, 30, 35, 40, 45, 50 |
| 60% | 5, 10, 15, 20, 25, 30, 35, 40, 45, 50 |
| 70% | 5, 10, 15, 25, 30, 35, 40, 45, 50 (no 20-point column) |

> **Implementation requirements for transmutation**
> 1. Ship all three tables (50/60/70) as exact data, transcribed and unit-tested against the source.
> 2. Snap-down (approximate) matching is mandatory, matching Excel `VLOOKUP TRUE`.
> 3. Blank score transmutes to 50 and is included in the average.
> 4. Restrict selectable maximums to those the active policy supports.
> 5. Verification gate: reproduce the author's real file exactly before release.

The full transmutation tables are provided as data alongside this document (`transmutation_tables.json`).

---

## 5. Functional requirements

### 5.1 Semester management

- The instructor creates a semester (e.g. "2026–2027 Semester 1") and marks it active.
- Exactly one semester is active at a time. New courses belong to the active semester.
- Creating and activating a new semester archives the previous one. Archived semesters stay fully readable and exportable.
- Any archived semester can be reopened to view or re-export.

### 5.2 Course and section management

- Within the active semester, the instructor creates courses with course code, course name, section, and instructor name.
- Each course sets its transmutation policy (50%, 60%, or 70%), defaulting to 70%.
- Optionally duplicate a course's structure (assessments and configuration) into a new course to avoid re-entry.

### 5.3 Roster entry (typed, Excel-like)

- The instructor types the class list into a grid: number, student ID, full name.
- Entry behaves like a spreadsheet: Enter or Tab advances, rows add in bulk, a plain pasted list is accepted when straightforward.
- No per-student form. The roster is one editable grid.

### 5.4 Configurable assessments (add / remove / set points)

This is a core requirement. Assessment structure differs by course and instructor, so it is fully editable.

- For each term, the instructor adds assessments, names them (Quiz 1, Assignment, Project, etc.), and removes any they don't need.
- Each class-standing assessment has a point-maximum chosen from the values the active policy supports (see 4.3). The exam maximum is fixed at 40.
- The app validates an assessment's point value against a real transmutation column and warns on an obvious mismatch (for example a 15-point task entered as 100), while still allowing an instructor to proceed for a deliberate reason.
- Each term has exactly one designated major exam, transmuted at 40% of the term. All other assessments are class standing, averaged equally.
- Changing the assessment set immediately and correctly changes the class-standing average; no manual reweighting is ever needed.
- Removing an assessment that already has entered scores warns the instructor first, since it changes computed grades.

### 5.5 Attendance and automatic scoring

Attendance is taken as a grid and scored automatically, replacing the manual attendance column.

- The instructor opens a session (a date) and marks the whole class across that session, the same across-the-list interaction used everywhere else.
- Marks: **P** = present (full credit), **E** = excused (half credit). Any other mark counts as zero. A blank means the session was not taken for that student and is excluded from the count.
- Attendance points are configurable, chosen from the maximums the active policy supports (for example 5, 10, 15 in the 70% policy). Default 10.
- Raw attendance score:

  ```
  points × (count of P + 0.5 × count of E) ÷ count of marked sessions
  ```

- The denominator is the number of sessions actually marked, not the total planned for the semester, so attendance is fair at any point in the term. This matches the instructor's current Excel formula exactly.
- The resulting raw score feeds the attendance assessment, is transmuted like any other, and enters the class-standing average equally. Attendance is not special-cased in the grade math.
- Sessions can be added and removed. Removing a session that has marks warns the instructor first, since it changes attendance scores.

### 5.6 Grade entry across the class list (central interaction)

This is the main screen and the reason the product exists.

- The instructor selects a course, then selects one assessment (e.g. "Quiz 1").
- GradeDesk shows the full class list with student names down the left and one entry column for that assessment.
- The instructor types raw scores straight down the list, Excel-style, never opening an individual student.
- Transmuted values, term totals, final grade, and letter grade update automatically in read-only columns as scores are entered.
- The instructor switches to the next assessment and repeats, always working across the whole class.
- A raw score above the assessment maximum is rejected or flagged at entry.

### 5.7 Validation and error review

Before export, GradeDesk surfaces issues Excel does not catch on its own:

- Raw score above an assessment's maximum.
- Missing exam scores that will force an "I", listed by student.
- Students with one or more blank assessment scores.
- Any final grade that cannot be computed ("NG").

### 5.8 Export

GradeDesk exports to Excel in a WVSTU-familiar format, producing two files:

1. **Full grade record:** every assessment, transmuted score, class standing, term total, final grade, and letter grade, laid out like the current WVSTU sheet.
2. **Summary sheet:** student ID, full name, final grade, and letter grade only.

- Exports open and submit without further formatting work.
- Archived semesters can be re-exported at any time.

### 5.9 Data persistence and transfer

- All data (semesters, courses, rosters, scores, configuration) persists locally between sessions automatically.
- The instructor can back up or transfer all data as a file, enabling a future move to another machine or a future synced version without loss.
- No internet connection is required for any feature.

---

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Platform | Desktop application for Windows, the environment WVSTU instructors already use. |
| Connectivity | Fully functional offline. No network dependency for any core feature. |
| Power / hardware | Runs on ordinary low-spec laptops. Light on memory and disk. |
| Accuracy | Reproduces the instructor's existing grade file exactly, to the decimal, before release. |
| Data safety | No silent data loss. Autosave. Data survives crashes and restarts. |
| Learnability | An instructor familiar with Excel grading is productive after one course setup, no manual needed. |
| Speed | Entering a class of 50 down one assessment feels as fast as typing an Excel column. |

---

## 7. MVP scope (v1)

The smallest build that fully replaces the current Excel workflow for one instructor:

1. Create and activate a semester; archive the previous one.
2. Create courses/sections under the active semester, each with a transmutation policy (default 70%).
3. Type the roster into an Excel-like grid.
4. Add, remove, and set the point value of assessments per term; designate the exam.
5. Take attendance as a session grid; auto-compute the attendance score (P full, E half), points configurable.
6. Enter raw scores across the full class list, one assessment at a time.
7. Automatic transmutation (snap-down), class-standing average, term totals, final grade, letter grade.
8. Pre-export validation / error review.
9. Export the full grade record and the summary sheet in WVSTU-familiar Excel format.
10. Local persistence and a backup/transfer file.

*Out of v1: Excel import/auto-detection, per-student screens, statistics dashboards, grade-change audit trail, multi-university rule packs beyond the three tables, any cloud or multi-user capability.*

### 7.1 Verification gate (release blocker)

> **Release blocker — already passed in prototype.** GradeDesk must reproduce the author's real completed semester file exactly, every final grade and every letter, from the same raw scores, before being shown to another instructor. This test has already been run against the verified engine: 114 students across 6 sections, zero mismatches. The shipping app must preserve that result as a standing automated test.

---

## 8. Roadmap beyond v1

### 8.1 v2 — instructor power features

- Copy a previous course's structure into a new course.
- Bulk score paste from Excel into an assessment column.
- Grade distribution and simple class statistics (A/B/C/D/F counts, highest, lowest, average).
- At-risk student flags.
- Grade-change history: "Quiz 2: 8 → 12, transmuted 65 → 80, final C → B" for integrity.
- PDF export in addition to Excel.

### 8.2 v3 — beyond one instructor

- Optional sync and backup so data moves across machines.
- Additional universities' transmutation and weighting policies as selectable rule packs, without changing the core.
- Department-level views, only after a single university is genuinely served.

### 8.3 Guardrail

The winnable position is a tool that does one boring thing perfectly for users reachable in person. Multi-university ambition stays in the architecture (configurable policies) but out of the pitch until a single university is genuinely served. Broadening the promise too early is the main risk.

---

## 9. Remaining questions (minor)

The grading engine is settled. These are small confirmations that affect edge formatting, not core calculation:

1. **Rounding: decided.** No rounding. The final grade is displayed and exported to two decimal places (e.g. 82.18), which is exactly the computed value and matches current practice. No rounding step exists that could shift a letter.
2. **Exam maximum: decided.** The major exam is always out of 40 points and is treated as a fixed exam maximum, not a configurable one.
3. **Policy per course vs per assessment.** The sample applies one policy (70%) to a whole course. Confirm the policy is always course-wide, never mixed within a course.
4. **Incomplete handling in the average.** Confirmed behavior: a blank non-exam assessment counts as 50 in the average, and a blank exam forces "I". Confirm this is the intended policy and not an artifact.

---

## Appendix A: Reference calculation (pseudocode)

```
function transmute(raw, max_points, policy_table):
    if raw is blank:
        return 50
    column = policy_table.column_for(max_points)   # e.g. the "10 Points" column
    # approximate / snap-down match: largest table score <= raw
    return column.value_at_or_below(raw)

function attendance_raw(session_marks, points):
    marked = [m for m in session_marks if m is not blank]
    if marked is empty:
        return blank                                # nothing taken yet
    credit = count(m == "P") + 0.5 * count(m == "E")
    return points * credit / len(marked)

function class_standing(assessments, policy_table):
    transmuted = [transmute(a.raw, a.max, policy_table) for a in assessments]
    return average(transmuted) * 0.60

function term_total(class_standing_assessments, exam_raw, policy_table):
    cs = class_standing(class_standing_assessments, policy_table)
    exam_t = transmute(exam_raw, 40, policy_table)
    return cs + exam_t * 0.40

function final_grade(midterm_total, final_total):
    return midterm_total * 0.40 + final_total * 0.60   # display to 2 decimals

function letter(final_grade, midterm_exam_raw, final_exam_raw):
    if midterm_exam_raw is blank or final_exam_raw is blank:
        return "I"
    if final_grade is blank:
        return "NG"
    if final_grade >= 90: return "A"
    if final_grade >= 80: return "B"
    if final_grade >= 70: return "C"
    if final_grade >= 60: return "D"
    return "F"
```

## Appendix B: Data model (suggested)

```
Semester { id, name, is_active, archived_at }
Course   { id, semester_id, code, name, section, instructor, policy(50|60|70) }
Student  { id, course_id, number, student_id, full_name }
Term     { id, course_id, kind(midterm|final) }
Assessment { id, term_id, name, max_points, kind(class_standing|exam|attendance), order }
Score    { student_id, assessment_id, raw_value }             # raw_value nullable (blank)
Session  { id, course_id, term_id, date, order }              # attendance sessions
Mark     { student_id, session_id, code("P"|"E"|other) }      # blank = not taken
```

Everything above the export layer is pure computation over this model. The transmutation tables are static reference data, not user data.
