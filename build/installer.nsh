; Installer and uninstaller page order and wording.
;
; electron-builder's template has no installer welcome page: it inserts
; MUI_UNPAGE_WELCOME for the uninstaller only, then drops the installer
; straight onto the licence page. That skips the sidebar art entirely, since
; MUI_WELCOMEFINISHPAGE_BITMAP is only drawn on a welcome or finish page.
;
; The template does insert a "customWelcomePage" macro if one is defined, so
; that is the hook used here. The licence page is also relabelled: it holds a
; page about the program, not terms anyone is being asked to agree to.

!include nsDialogs.nsh
!include LogicLib.nsh

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


; ------------------------------------------------------------------ uninstall
;
; Uninstalling removes the program but leaves the grades, which live in
; %APPDATA%\gradedesk\gradedesk.db. That default is deliberate: wiping grades
; on uninstall would destroy a term's marking on any reinstall or upgrade.
;
; The cost of that default is that someone who genuinely wants a clean slate
; has no way to get one except deleting files by hand. This page offers the
; choice, unticked, with the consequence spelled out rather than implied.
;
; Deliberately NOT using electron-builder's deleteAppDataOnUninstall option:
; that deletes unconditionally with no prompt. The checkbox drives the same
; final RMDir, but only when someone has actively asked for it.

; electron-builder runs makensis twice: once with -DBUILD_UNINSTALLER to
; produce the uninstaller, once without it for the installer itself. This
; file is included in the preamble of BOTH passes, so uninstaller-only code
; has to be guarded. Without the guard the installer pass sees "un." code
; with no WriteUninstaller and raises warning 6020, which -WX makes fatal.
!ifdef BUILD_UNINSTALLER

Var UnDataCheckbox
Var UnDeleteData

!macro customUnWelcomePage
  UninstPage custom un.WelcomePageShow un.WelcomePageLeave
!macroend

Function un.WelcomePageShow
  ; Default to keeping the grades. StrCpy here rather than relying on a zeroed
  ; variable, so a repeated back-and-forth through the page cannot leave a
  ; stale "1" behind from a previous visit.
  StrCpy $UnDeleteData "0"

  ; No MUI_HEADER_TEXT here: electron-builder includes this file in the
  ; script preamble, before the template does !include "MUI2.nsh", so MUI
  ; macros do not exist yet at this point. The page draws its own text.

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "This will remove GradeDesk from this computer.$\r$\n"
  Pop $0

  ${NSD_CreateLabel} 0 28u 100% 32u "Your grades are kept by default. They are stored separately from the program, so you can reinstall or upgrade without losing a term's marking."
  Pop $0

  ${NSD_CreateCheckbox} 0 64u 100% 12u "Also remove your grades"
  Pop $UnDataCheckbox
  ; Unticked. Anyone who wants the data gone has to say so.
  ${NSD_SetState} $UnDataCheckbox ${BST_UNCHECKED}

  ${NSD_CreateLabel} 14u 78u 100% 32u "Deletes every course, class list, mark and attendance record on this computer. This cannot be undone, and an uninstall is not the place to discover that. If you are not certain, cancel and make a backup first from the Manage menu."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function un.WelcomePageLeave
  StrCpy $UnDeleteData "0"
  ${NSD_GetState} $UnDataCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    ; Ask a second time, and make the default answer No. A single tick on a
    ; page someone is clicking through should not be enough to lose a semester.
    ;
    ; Written with named labels rather than a relative IDYES jump: the jump
    ; form works, but it depends on the exact instruction count between the
    ; MessageBox and the StrCpy, so inserting one line silently inverts it.
    ; /SD IDNO makes a silent uninstall keep the data too.
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 \
      "Delete every course, class list, mark and attendance record on this computer?$\r$\n$\r$\nThis cannot be undone." \
      /SD IDNO IDYES un_confirmDelete IDNO un_keepData
    un_confirmDelete:
      StrCpy $UnDeleteData "1"
      Goto un_leaveDone
    un_keepData:
      StrCpy $UnDeleteData "0"
    un_leaveDone:
  ${EndIf}
FunctionEnd

!macro customUnInstall
  ${If} $UnDeleteData == "1"
    DetailPrint "Removing grades and settings..."
    ; Electron always stores per-user app data, even for an all-users install.
    ${If} $installMode == "all"
      SetShellVarContext current
    ${EndIf}
    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    !endif
  ${Else}
    DetailPrint "Keeping your grades in $APPDATA\${APP_FILENAME}"
  ${EndIf}
!macroend


!endif ; BUILD_UNINSTALLER
