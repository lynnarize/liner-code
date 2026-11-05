/*
  Liner Code's Windows installer, for NSIS 3 (brew install makensis). scripts/build-win.sh compiles it
  once the app is wrapped, with warnings as errors and in a UTF-8 locale (makensis crashes without one):
    makensis -WX -DVERSION=<x.y.z> -DARCH=<x64|arm64> -DAPPDIR=<the wrapped folder> -DICON=<.ico> -DOUTFILE=<setup .exe> <this file>
  It installs for you alone, so it never asks for an administrator: the app goes in
  %LOCALAPPDATA%\Programs\Liner Code, its shortcut in your Start menu, and an entry for removing it
  in Settings > Apps (HKCU). Run again, it puts the new version in place of the old one, quitting
  Liner Code first. The uninstaller leaves what's yours (%APPDATA%\Liner Code, ~\.liner-code) alone.
  The shortcut is the one the app writes itself (desktop/src/main.ts): the same name in the same
  folder, so there's only ever one. Stock NSIS can't give it the app's AppUserModelId, which
  notifications need, so the app (re)writes it with the id each time it opens, and the finish page
  opens it.
*/
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!macro Need DEFINE
  !ifndef ${DEFINE}
    !error "${DEFINE} isn't defined: scripts/build-win.sh passes it (see the top of this file)."
  !endif
!macroend
!insertmacro Need VERSION
!insertmacro Need ARCH
!insertmacro Need APPDIR
!insertmacro Need ICON
!insertmacro Need OUTFILE

!define NAME "Liner Code"
!define EXE "Liner Code.exe"
!define UNINSTALLER "Uninstall Liner Code.exe"
!define SHORTCUT "$SMPROGRAMS\Liner Code.lnk"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\app.liner.code"
; Windows wants four numbers in the setup's own version: 0.2.2 is 0.2.2.0 (and 0.3.0-beta.1 is 0.3.0.0).
!searchparse "${VERSION}" "" VMAJOR "." VMINOR "." VREST
!searchparse "${VREST}-" "" VPATCH "-"

!include MUI2.nsh
!include LogicLib.nsh
!include x64.nsh

Name "${NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${NAME}"
; An earlier install is upgraded where it is.
InstallDirRegKey HKCU "${UNINSTKEY}" "InstallLocation"
BrandingText "${NAME} ${VERSION}"
; A file that can't be written stops the install rather than leaving an app with pieces missing.
AllowSkipFiles off

Var Welcome

; ---------- Pages: welcome, the install, finish (with Run Liner Code); the uninstaller asks, then removes ----------

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "$Welcome$\r$\n$\r$\n$_CLICK"
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE WelcomeLeave
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT
!insertmacro MUI_PAGE_FINISH

!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ConfirmLeave
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${VMAJOR}.${VMINOR}.${VPATCH}.0"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName" "${NAME}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "CompanyName" "Liner"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription" "${NAME} Setup"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "LegalCopyright" "${U+00A9} 2026 Lin. MIT licence."

; ---------- Liner Code, open or not ----------

/*
  Pushes 1 while Liner Code runs, else 0. Windows won't open a running program for writing, and its
  engine and helpers run as Liner Code.exe too, so this install's copy reads as closed only once
  they've all gone. Installing also looks for a copy run from anywhere else, like an unzipped one:
  only one runs at a time, so one left open would take the new one's place when it opens.
*/
!macro LinerCodeOpen UN
Function ${UN}LinerCodeOpen
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $0 0
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    ClearErrors
    FileOpen $1 "$INSTDIR\${EXE}" a
    ${If} ${Errors}
      StrCpy $0 1
    ${Else}
      FileClose $1
    ${EndIf}
  ${EndIf}
  !if "${UN}" == ""
    ${If} $0 == 0
      ; Yours only: another account's Liner Code is no matter. One line per process, each starting
      ; with "Liner Code.exe" in quotes; nothing like it if there's none.
      ReadEnvStr $2 USERNAME
      nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ${EXE}" /FI "USERNAME eq $2" /FO CSV /NH'
      Pop $1
      Pop $1
      StrLen $2 $1
      ${For} $3 0 $2
        StrCpy $4 $1 16 $3
        ${If} $4 == '"${EXE}"'
          StrCpy $0 1
          ${ExitFor}
        ${EndIf}
      ${Next}
    ${EndIf}
  !endif
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd
!macroend
!insertmacro LinerCodeOpen ""
!insertmacro LinerCodeOpen "un."

/*
  Asks to quit Liner Code when it's open, and quits it the way closing its window does, so a
  session that's working asks you first. Leaves "ok" on the stack, or "open" if it's still running.
  Run quietly (/S), it quits it without asking, and gives up if it doesn't go.
*/
!macro CloseLinerCode UN
Function ${UN}CloseLinerCode
  Push $1
  Push $0
  Push $8
  Push $9
  StrCpy $1 "ok"
  Call ${UN}LinerCodeOpen
  Pop $0
  ${If} $0 == 1
  ${AndIfNot} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Liner Code is open. Press OK to quit it and go on, or Cancel to leave it open." /SD IDOK IDOK`
    StrCpy $1 "open"
  ${EndIf}
  ${If} $0 == 1
  ${AndIf} $1 == "ok"
    ${Do}
      ; taskkill without /F sends the window a close, as its close button does.
      ReadEnvStr $9 USERNAME
      nsExec::Exec '"$SYSDIR\taskkill.exe" /FI "USERNAME eq $9" /IM "${EXE}"'
      Pop $9
      ; Ten seconds for it to save and go.
      ${For} $8 1 20
        Sleep 500
        Call ${UN}LinerCodeOpen
        Pop $0
        ${If} $0 == 0
          ${ExitFor}
        ${EndIf}
      ${Next}
      ${If} $0 == 0
        ${ExitDo}
      ${EndIf}
      ${IfNot} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Liner Code is still open: it may be asking whether to stop a session that's working. Quit it (or end it in Task Manager), then press Retry." /SD IDCANCEL IDRETRY`
        StrCpy $1 "open"
        ${ExitDo}
      ${EndIf}
    ${Loop}
  ${EndIf}
  Pop $9
  Pop $8
  Pop $0
  Exch $1
FunctionEnd
!macroend
!insertmacro CloseLinerCode ""
!insertmacro CloseLinerCode "un."

/*
  What a Liner Code install is: Electron's files beside Liner Code.exe, and the app itself under
  resources. Patterns rather than a list, so an upgrade also clears files an older Electron had.
*/
!macro RemoveApp
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\version"
!macroend

; ---------- Installing ----------

Function .onInit
  ; The setup runs on any Windows; the app inside only on the one it was built for.
  !if "${ARCH}" == "arm64"
    ${IfNot} ${IsNativeARM64}
      MessageBox MB_OK|MB_ICONSTOP "This is Liner Code for Windows on Arm. Download the x64 setup for this PC." /SD IDOK
      Abort
    ${EndIf}
  !else
    ${If} ${IsNativeIA32}
      MessageBox MB_OK|MB_ICONSTOP "Liner Code needs 64-bit Windows." /SD IDOK
      Abort
    ${EndIf}
  !endif
  ReadRegStr $0 HKCU "${UNINSTKEY}" "DisplayVersion"
  ${If} $0 == ""
    StrCpy $Welcome "This installs Liner Code ${VERSION} for you alone, in your own folder, so it needs no administrator. It goes in the Start menu, and in Settings > Apps for removing it."
  ${ElseIf} $0 == "${VERSION}"
    StrCpy $Welcome "Liner Code ${VERSION} is installed already. This installs it again; your sessions and settings are kept."
  ${Else}
    StrCpy $Welcome "Liner Code $0 is installed. This puts ${VERSION} in its place; your sessions and settings are kept."
  ${EndIf}
FunctionEnd

; Open, it's asked to quit before anything changes; Cancel stays on the welcome page.
Function WelcomeLeave
  Call CloseLinerCode
  Pop $0
  ${If} $0 != "ok"
    Abort
  ${EndIf}
FunctionEnd

Section "-Liner Code" SecApp
  ; Again here, for a quiet install, or one opened again since the welcome page.
  Call CloseLinerCode
  Pop $0
  ${If} $0 != "ok"
    Abort "Liner Code is still open, so nothing was changed."
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    DetailPrint "Removing the version that was here"
    !insertmacro RemoveApp
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${APPDIR}/*"
  WriteUninstaller "$INSTDIR\${UNINSTALLER}"

  ; Straight in Programs, as the app writes it: one shortcut, whichever wrote it last.
  CreateShortcut "${SHORTCUT}" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "${NAME}"

  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "Liner"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER}"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER}" /S'
  SectionGetSize ${SecApp} $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

; ---------- Uninstalling ----------

Function un.ConfirmLeave
  Call un.CloseLinerCode
  Pop $0
  ${If} $0 != "ok"
    Abort
  ${EndIf}
FunctionEnd

Section "Uninstall"
  Call un.CloseLinerCode
  Pop $0
  ${If} $0 != "ok"
    Abort "Liner Code is still open, so it wasn't removed."
  ${EndIf}
  Delete "${SHORTCUT}"
  !insertmacro RemoveApp
  Delete "$INSTDIR\${UNINSTALLER}"
  ; Only if it's empty now: whatever else was put in the folder stays.
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
SectionEnd
