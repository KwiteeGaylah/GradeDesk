; Installer page order and wording.
;
; electron-builder's template has no installer welcome page: it inserts
; MUI_UNPAGE_WELCOME for the uninstaller only, then drops the installer
; straight onto the licence page. That skips the sidebar art entirely, since
; MUI_WELCOMEFINISHPAGE_BITMAP is only drawn on a welcome or finish page.
;
; The template does insert a "customWelcomePage" macro if one is defined, so
; that is the hook used here. The licence page is also relabelled: it holds a
; page about the program, not terms anyone is being asked to agree to.

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "GradeDesk"
  !define MUI_WELCOMEPAGE_TEXT "Offline grade recorder for William V.S. Tubman University.$\r$\n$\r$\nGradeDesk does the grade sheet you already do in Excel, without the formulas. You type each student's raw marks and it handles the transmutation table, the class standing, the weights, the final grade and the letter, then exports the sheet you submit.$\r$\n$\r$\nEverything stays on this computer, and no internet connection is needed at any point.$\r$\n$\r$\nClick Next to read a little more about the program."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; The licence page carries build/about.txt, which is information rather than
; terms, so the stock "License Agreement / accept the terms" wording is wrong.
!define MUI_PAGE_HEADER_TEXT "About GradeDesk"
!define MUI_PAGE_HEADER_SUBTEXT "What it does, where your data lives, and how it was checked."
!define MUI_LICENSEPAGE_TEXT_TOP "A little about the program before you install it."
!define MUI_LICENSEPAGE_TEXT_BOTTOM "Click I Agree to continue installing GradeDesk."
!define MUI_LICENSEPAGE_BUTTON "I Agree"

!define MUI_FINISHPAGE_TITLE "GradeDesk is installed"
!define MUI_FINISHPAGE_TEXT "GradeDesk is ready to use. You will find it on your desktop and in the Start menu.$\r$\n$\r$\nThe first time you open it, a short setup will ask for your name and your first course."
