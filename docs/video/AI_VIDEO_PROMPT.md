# Prompt for an AI video tool

Copy everything between the two rules into the tool, and attach the seven
screenshots from `docs/images/`. Written for tools that accept a long brief
plus reference images: Runway, Pika, Synthesia, HeyGen, Descript, InVideo,
Google Vids, Canva. Guidance for the two main kinds of tool is at the bottom.

---

You are producing a 6 minute 30 second software tutorial video.

**Product:** GradeDesk — an offline Windows desktop app for recording student
grades at William V.S. Tubman University in Liberia.

**Audience:** university instructors who currently keep grades in Excel
spreadsheets. Many are not confident with computers beyond Excel and email.
Some speak English as a second language.

**Tone:** calm, plain, practical. Not a sales advert. No hype, no exclamation
marks, no "revolutionary" or "game-changing". The right register is a competent
colleague explaining something useful over a cup of tea. Confident, unhurried,
never patronising.

**Voice:** one narrator. A warm, clear adult voice at about 150 words per
minute, which is slower than a typical advert. Neutral or West African English
accent, whichever the tool does more naturally. No music under the narration.
If you must use music, put a quiet instrumental bed under the opening 15
seconds and the closing 15 seconds only, and nowhere else.

**Visual style:** clean and literal. The screenshots ARE the video — this is a
screen tutorial, not an illustrated concept piece. Do not generate imaginary
user interfaces, invented app screens, stock footage of students in
classrooms, or people pointing at laptops. Every frame should be either one of
the supplied screenshots, a slow push-in on part of one, or a simple text card
in the app's colours.

**Colours for text cards and any graphics:**
- Deep green `#0f6b4f` (the app's brand colour) for headings and accents
- Near-black `#12181f` for body text
- White `#ffffff` or very light grey `#f4f6f8` for backgrounds
- Keep it flat. No gradients, no drop shadows, no 3D, no glassmorphism.

**Motion:** slow and minimal. Push-ins of 3 to 5 percent over 4 to 6 seconds.
Cross-dissolves of about 0.4 seconds between scenes. Never a spin, a bounce, a
zoom whoosh, or a page curl. The subject is a grade sheet, and the motion
should feel like one.

**Captions:** burn in open captions in a plain sans-serif at the bottom of the
frame, high contrast, matching the narration word for word. Many viewers will
watch on a phone in a noisy room.

**Aspect ratio:** 16:9, 1920×1080.

### Reference images

Seven screenshots are attached. Use them as the actual footage:

1. `setup-wizard.png` — the four-step welcome dialog
2. `grade-entry.png` — the main screen, typing marks with worked columns
3. `attendance.png` — the P/E/A register
4. `roster.png` — the class list
5. `assessments.png` — assessment setup and the policy picker
6. `review-issues.png` — the pre-export check
7. `guide.png` — the built-in guide

### Scene-by-scene

**Scene 1 (0:00–0:40) — the problem.** A cluttered Excel grade sheet full of
formulas, scrolling slowly right. Then a single cell showing an error, held for
two seconds. Narration: *"If you teach at Tubman University, you already know
this sheet. Raw scores on the left. A transmutation lookup for every one of
them. Class standing, term total, final grade, letter. And every semester you
rebuild it, or you copy last semester's and hope nothing shifted. It works,
until one formula points at the wrong row, and then it quietly gives you a
wrong letter grade for one student, and you may not catch it."*

**Scene 2 (0:40–1:10) — what it is.** `grade-entry.png`, still, then a slow
push-in on the score column. Narration: *"GradeDesk is that same sheet, with
the formulas already built in and hidden. You type the marks. It does the
lookups, the averages, the weights, the final grade and the letter. It runs on
your own computer, offline. Nothing is uploaded anywhere, and it does not need
internet at any point."*

**Scene 3 (1:10–2:00) — installing.** A Windows installer wizard: a welcome
page with a green sidebar panel, an information page, a location page, a
progress bar, a finish page. Narration: *"Installing takes about a minute. Copy
the setup file onto the computer, from a flash drive is fine, and double-click
it. Windows may show a blue 'Windows protected your PC' box, because the file
is not signed with a paid certificate. Click 'More info', then 'Run anyway'.
That box appears for any program without a commercial signature. After that,
click through the wizard and it installs for you alone, so you do not need an
administrator password."*

**Scene 4 (2:00–3:00) — first run.** `setup-wizard.png`, pushing in gently on
the four numbered steps. Narration: *"The first time it opens, it walks you
through four things. Name your semester. Add a course, with its code, section,
and which transmutation table it uses — fifty, sixty or seventy percent. Add
your assessments: your quizzes, your assignments, attendance. Then your class
list. You can paste the whole list straight from a spreadsheet or an email: the
student ID first, then a tab, then the name. You only do this once per course."*

**Scene 5 (3:00–4:00) — typing marks.** `grade-entry.png`. If the tool can
animate typing, show numbers appearing one row at a time down the score column,
with the shaded columns to the right updating. Otherwise push in slowly on the
score column, then cut to a push-in on the worked columns. Narration: *"Now the
part you actually spend time on. Choose the assessment from the dropdown, type
a mark, press Enter, and it drops to the next student, the same way it does in
Excel. The shaded columns work themselves out as you go: the transmuted score,
the class standing, the term total, the final grade, the letter. There is no
save button. Every mark is written to disk the moment you leave the cell, so if
the power goes, nothing you have typed is lost."*

**Scene 6 (4:00–4:45) — attendance.** `attendance.png`. Push in on the green
"Record attendance" button, then across the grid of P, E and A marks.
Narration: *"Attendance scores itself. Click 'Record attendance' and give it
the date of the class. Then click down the column: P for present, E for
excused, A for absent. Click again to change your mind. Everyone starts from
the full points; a P counts in full, an E counts half, an A counts nothing, and
the points are shared out over the classes you actually marked. That last part
matters — it divides by the classes you have marked so far, not the whole term,
so the score is fair in the middle of the semester, not just at the end."*

**Scene 7 (4:45–5:30) — the check.** `review-issues.png`. Highlight two or
three list rows in turn with a soft rounded box in the brand green. Narration:
*"Before you hand anything in, click 'Review issues'. This is the part a
spreadsheet will not do for you. It tells you if a score is above its maximum,
which usually means a typing slip. It tells you which students have no exam
mark yet, because a missing exam gives the letter I no matter how good the rest
of the term was. And it tells you where blanks are quietly counting as fifty.
None of these stop you exporting. They just make sure nothing surprises you
after you have submitted."*

**Scene 8 (5:30–6:05) — exporting.** A save dialog, then an Excel sheet with
coloured header bands scrolling slowly. Narration: *"When you are ready,
export. You get an Excel file laid out the way the sheet is normally laid out,
with the same colour bands, ready to open and submit. There is a summary sheet
as well, and attendance exports on its own if you need it. The file names carry
the course and the date, so you are not left with three files called 'grades'
and no idea which is which."*

**Scene 9 (6:05–6:30) — your data.** A file being copied to a USB drive, then
the app's home screen, then fade to the app icon on a plain white background.
Narration: *"Everything you type lives in one file on your own computer. Not in
the cloud, not on anyone's server. Use 'Back up' to copy that one file to a
flash drive at the end of each week, and if the computer is ever lost,
'Restore' puts everything back exactly as it was. That is the whole program.
Type your marks, and let it do the arithmetic."*

### Hard constraints

Do not change any of these, and do not let a rewrite soften them:

- Never say the software is certified, official, or approved by the university.
  It is not.
- Never say data is encrypted or "secure". Say it stays on the user's own
  computer and is never sent anywhere, which is what is true.
- Never invent statistics. The only accuracy claim permitted is: checked
  against one completed semester of 167 students across 6 course sections,
  where every final grade and letter matched.
- Never show real student names. The names in the screenshots are invented and
  must stay that way.
- A blank assessment counts as 50. A blank exam gives the letter I. These are
  two different rules and must not be merged into one sentence.
- The exam is always worth 40 and cannot be changed.
- The final grade is truncated to two decimals and never rounded up.
- Do not generate fictional app screens. Use the supplied screenshots.

---

## Which tool, and what to expect

**Avatar and slide tools (Synthesia, HeyGen, Canva, InVideo, Google Vids)**
handle this brief best, because the video is mostly narration over
screenshots. Paste the brief, upload the seven images, pick one voice, and turn
off any stock-footage suggestion feature — it will otherwise drop in
classroom clips that have nothing to do with the app. If the tool insists on a
presenter avatar, put it in a small corner circle, or leave it out.

**Generative video tools (Runway, Pika, Sora)** will fight this brief. They are
built to invent footage, and invented footage of a grade-recording app will
show interfaces that do not exist, with misspelled labels. If you use one, use
it only for Scene 1's spreadsheet imagery, and assemble the rest from the real
screenshots in an ordinary editor.

**The honest recommendation:** record Scenes 3 to 8 yourself with OBS Studio,
which is free, while clicking through the real app. Ten minutes of screen
recording gives you footage no generator can match, because it is the actual
software doing the actual thing. Then use an AI tool for the voiceover and
captions only. `SCRIPT.md` in this folder is already timed for that.

## A shot list for recording it yourself

If you take the OBS route, capture these, in this order. Set the app window to
1920×1080 before you start, and use invented student names.

1. The installer, start to finish, including the SmartScreen warning.
2. First launch: the four-step wizard, filling in each step for real.
3. Grade entry: pick an assessment, type eight marks with Enter between them.
4. Grade entry: the search box, and the sort dropdown changing the order.
5. Attendance: click Record attendance, add a date, then click twelve cells so
   they cycle through P, E and A.
6. Review issues: open it with two or three real warnings showing.
7. Export: the save dialog, then the file opening in Excel, scrolled slowly.
8. Manage → Back up, saving to a flash drive.
9. The Guide screen, scrolled from top to bottom.

Record each as its own file, named for the scene. Do not edit while recording;
trimming afterwards is far easier than getting a clean single take.
