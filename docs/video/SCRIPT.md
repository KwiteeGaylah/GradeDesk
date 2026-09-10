# GradeDesk — instructor walkthrough video

**Target length:** 6 minutes 30 seconds
**Audience:** WVSTU faculty who currently keep grades in Excel
**Voice:** one narrator, calm and plain. No music under the narration except
where marked. No camera, no presenter on screen.

Everything below is timed. The **On screen** column says exactly what the
viewer sees; the **Narration** column is the script to read, word for word.
Word counts assume roughly 150 words per minute, which is an unhurried pace
for a room where English is a second language for some listeners.

---

## Before you start

Screenshots referenced by filename live in `docs/images/`:

| File | Shows |
|---|---|
| `setup-wizard.png` | The four-step welcome dialog |
| `grade-entry.png` | Typing marks, with the worked columns beside them |
| `attendance.png` | The P/E/A register and the Record attendance button |
| `roster.png` | The class list |
| `assessments.png` | Assessment setup and the policy picker |
| `review-issues.png` | The pre-export check |
| `guide.png` | The built-in guide |

Two things the video must **not** do:

- Do not show real student names. Every screenshot in `docs/images/` already
  uses invented names. If new footage is recorded, use invented names too.
- Do not promise the software is approved by the university. It reproduces the
  university's published tables and was checked against one completed semester.
  That is the claim, and it is the only claim.

---

## Scene 1 — The problem (0:00 – 0:40)

| | |
|---|---|
| **On screen** | Open on a spreadsheet: a grade sheet with visible formulas in the formula bar, several columns of VLOOKUPs. Slowly scroll right so the viewer sees it keeps going. Then a single red cell where a formula has gone wrong (`#N/A` or a wrong letter grade). Hold on the error for two seconds. |
| **Narration** | "If you teach at Tubman University, you already know this sheet. Raw scores on the left. A transmutation lookup for every one of them. Class standing, term total, final grade, letter. And every semester you rebuild it, or you copy last semester's and hope nothing shifted. It works, until one formula points at the wrong row, and then it quietly gives you a wrong letter grade for one student, and you may not catch it." |
| **Note** | Do not name a colleague or a real course. Build the spreadsheet yourself for this shot. |

---

## Scene 2 — What GradeDesk is (0:40 – 1:10)

| | |
|---|---|
| **On screen** | Cut to `grade-entry.png`. Let it sit still for a beat, then push in slowly on the score column where the numbers are typed. |
| **Narration** | "GradeDesk is that same sheet, with the formulas already built in and hidden. You type the marks. It does the lookups, the averages, the weights, the final grade and the letter. It runs on your own computer, offline. Nothing is uploaded anywhere, and it does not need internet at any point." |

---

## Scene 3 — Installing (1:10 – 2:00)

| | |
|---|---|
| **On screen** | Screen recording of the actual installer: double-click `GradeDesk-Setup-1.0.0.exe` → welcome page with the green sidebar → the About page → install location → progress bar → finish. Speed up the progress bar to about 3 seconds. |
| **Narration** | "Installing takes about a minute. Copy the setup file onto the computer, from a flash drive is fine, and double-click it. Windows may show a blue 'Windows protected your PC' box, because the file is not signed with a paid certificate. Click 'More info', then 'Run anyway'. That box appears for any program without a commercial signature. After that, click through the wizard and it installs for you alone, so you do not need an administrator password." |
| **Note** | Show the SmartScreen box for real. Instructors will hit it, and a video that hides it will lose their trust the first time they see it. |

---

## Scene 4 — First run: the four steps (2:00 – 3:00)

| | |
|---|---|
| **On screen** | `setup-wizard.png`, then screen-record clicking through the four steps: naming the semester, adding a course, adding assessments, pasting a class list. |
| **Narration** | "The first time it opens, it walks you through four things. Name your semester. Add a course, with its code, section, and which transmutation table it uses — fifty, sixty or seventy percent. Add your assessments: your quizzes, your assignments, attendance. Then your class list. You can paste the whole list straight from a spreadsheet or an email: the student ID first, then a tab, then the name. You only do this once per course." |

---

## Scene 5 — Typing marks (3:00 – 4:00)

| | |
|---|---|
| **On screen** | Screen recording of grade entry. Pick an assessment from the dropdown. Type a mark, press Enter, type the next, press Enter — do at least six in a row at a natural speed so the rhythm is obvious. Then show the shaded columns updating on the right. |
| **Narration** | "Now the part you actually spend time on. Choose the assessment from the dropdown, type a mark, press Enter, and it drops to the next student, the same way it does in Excel. The shaded columns work themselves out as you go: the transmuted score, the class standing, the term total, the final grade, the letter. There is no save button. Every mark is written to disk the moment you leave the cell, so if the power goes, nothing you have typed is lost." |
| **Note** | Make sure the power-cut line is said over a shot of a mark being typed, not over a menu. It is the single most reassuring sentence in the video. |

---

## Scene 6 — Attendance (4:00 – 4:45)

| | |
|---|---|
| **On screen** | `attendance.png`, then screen-record: click **＋ Record attendance**, pick a date, then click cells so they cycle P → E → A → blank. Show the Raw and Transmuted columns changing as marks are clicked. |
| **Narration** | "Attendance scores itself. Click 'Record attendance' and give it the date of the class. Then click down the column: P for present, E for excused, A for absent. Click again to change your mind. Everyone starts from the full points; a P counts in full, an E counts half, an A counts nothing, and the points are shared out over the classes you actually marked. That last part matters — it divides by the classes you have marked so far, not the whole term, so the score is fair in the middle of the semester, not just at the end." |

---

## Scene 7 — The check before you export (4:45 – 5:30)

| | |
|---|---|
| **On screen** | `review-issues.png`. Highlight two or three rows in the list one at a time with a soft box or arrow. |
| **Narration** | "Before you hand anything in, click 'Review issues'. This is the part a spreadsheet will not do for you. It tells you if a score is above its maximum, which usually means a typing slip. It tells you which students have no exam mark yet, because a missing exam gives the letter I no matter how good the rest of the term was. And it tells you where blanks are quietly counting as fifty. None of these stop you exporting. They just make sure nothing surprises you after you have submitted." |

---

## Scene 8 — Exporting (5:30 – 6:05)

| | |
|---|---|
| **On screen** | Screen-record clicking **Export grade sheet**, the save dialog, then the file opening in Excel. Scroll the exported sheet so the viewer sees the coloured bands and that it looks like the familiar workbook. |
| **Narration** | "When you are ready, export. You get an Excel file laid out the way the sheet is normally laid out, with the same colour bands, ready to open and submit. There is a summary sheet as well, and attendance exports on its own if you need it. The file names carry the course and the date, so you are not left with three files called 'grades' and no idea which is which." |

---

## Scene 9 — Where your work lives (6:05 – 6:30)

| | |
|---|---|
| **On screen** | Show **Manage → Back up**, saving a `.db` file to a flash drive. End on the GradeDesk home screen, then fade to the app icon on a plain background. |
| **Narration** | "Everything you type lives in one file on your own computer. Not in the cloud, not on anyone's server. Use 'Back up' to copy that one file to a flash drive at the end of each week, and if the computer is ever lost, 'Restore' puts everything back exactly as it was. That is the whole program. Type your marks, and let it do the arithmetic." |
| **Note** | Optional last line if the video needs a call to action: "Ask [contact] for the setup file." Fill in the real contact before publishing. |

---

## Full narration, uninterrupted

For a voice tool that wants the script as one block, without the table
formatting. Total: about 890 words, roughly six minutes at an unhurried pace.

> If you teach at Tubman University, you already know this sheet. Raw scores on the left. A transmutation lookup for every one of them. Class standing, term total, final grade, letter. And every semester you rebuild it, or you copy last semester's and hope nothing shifted. It works, until one formula points at the wrong row, and then it quietly gives you a wrong letter grade for one student, and you may not catch it.
>
> GradeDesk is that same sheet, with the formulas already built in and hidden. You type the marks. It does the lookups, the averages, the weights, the final grade and the letter. It runs on your own computer, offline. Nothing is uploaded anywhere, and it does not need internet at any point.
>
> Installing takes about a minute. Copy the setup file onto the computer, from a flash drive is fine, and double-click it. Windows may show a blue "Windows protected your PC" box, because the file is not signed with a paid certificate. Click "More info", then "Run anyway". That box appears for any program without a commercial signature. After that, click through the wizard and it installs for you alone, so you do not need an administrator password.
>
> The first time it opens, it walks you through four things. Name your semester. Add a course, with its code, section, and which transmutation table it uses — fifty, sixty or seventy percent. Add your assessments: your quizzes, your assignments, attendance. Then your class list. You can paste the whole list straight from a spreadsheet or an email: the student ID first, then a tab, then the name. You only do this once per course.
>
> Now the part you actually spend time on. Choose the assessment from the dropdown, type a mark, press Enter, and it drops to the next student, the same way it does in Excel. The shaded columns work themselves out as you go: the transmuted score, the class standing, the term total, the final grade, the letter. There is no save button. Every mark is written to disk the moment you leave the cell, so if the power goes, nothing you have typed is lost.
>
> Attendance scores itself. Click "Record attendance" and give it the date of the class. Then click down the column: P for present, E for excused, A for absent. Click again to change your mind. Everyone starts from the full points; a P counts in full, an E counts half, an A counts nothing, and the points are shared out over the classes you actually marked. That last part matters — it divides by the classes you have marked so far, not the whole term, so the score is fair in the middle of the semester, not just at the end.
>
> Before you hand anything in, click "Review issues". This is the part a spreadsheet will not do for you. It tells you if a score is above its maximum, which usually means a typing slip. It tells you which students have no exam mark yet, because a missing exam gives the letter I no matter how good the rest of the term was. And it tells you where blanks are quietly counting as fifty. None of these stop you exporting. They just make sure nothing surprises you after you have submitted.
>
> When you are ready, export. You get an Excel file laid out the way the sheet is normally laid out, with the same colour bands, ready to open and submit. There is a summary sheet as well, and attendance exports on its own if you need it. The file names carry the course and the date, so you are not left with three files called "grades" and no idea which is which.
>
> Everything you type lives in one file on your own computer. Not in the cloud, not on anyone's server. Use "Back up" to copy that one file to a flash drive at the end of each week, and if the computer is ever lost, "Restore" puts everything back exactly as it was. That is the whole program. Type your marks, and let it do the arithmetic.

---

## Facts the video must not get wrong

If an AI tool rewrites any of this narration, check the result against this
list. These are the claims that have to stay exactly true.

| Claim | The truth |
|---|---|
| Where data lives | One file, `%APPDATA%\GradeDesk\gradedesk.db`, on the user's own machine. Never uploaded. |
| Internet | Never required, at any point, including install. |
| The lookup | Snaps **down** to the nearest listed value, never an exact match. Same as `VLOOKUP(..., TRUE)`. |
| Blank assessment | Counts as **50**, and stays in the average. |
| Blank exam | Forces the letter **I**, whatever the numbers say. This is a different rule from a blank assessment. |
| The exam | Always worth 40. Not configurable. |
| Weights | Class standing is 60% of the term, exam is 40%. Final grade is midterm 40% + final 60%. |
| Assessment points | Do **not** need to add up to anything. Three assessments at full marks give 60, and so do five. |
| Letters | A from 90, B from 80, C from 70, D from 60, otherwise F. |
| Final grade | Truncated to two decimals, never rounded up. 89.99 stays a B. |
| Attendance | `points × (P + half the E's) ÷ sessions marked`, rounded to a whole point. |
| Accuracy claim | Checked against one completed semester: 167 students across 6 sections, every final grade and letter matched. Say this, and nothing stronger. |
| Approval | It is **not** endorsed or approved by the university. Do not imply that it is. |
| Policies | Three tables: 50%, 60%, 70%. The 70% table is the one verified against real grades. |

---

## Things to avoid saying

- "Certified", "official", "approved by the university" — none are true.
- "Replaces Excel entirely" — it exports to Excel, it does not replace it.
- "Your data is secure" — say what is actually true: it stays on your computer
  and is never sent anywhere. Do not imply encryption, because there is none.
- "Never makes mistakes" — say it was checked against a real semester and
  matched. That is a stronger claim precisely because it is verifiable.
