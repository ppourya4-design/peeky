; Peeky — per-user, one-click installer. Run with /S it installs without showing anything (that is how updates arrive).
Unicode true
!define NAME "Peeky"
!define EXE "Peeky.exe"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Peeky"
!define RUN "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${NAME}"
OutFile "..\dist\Peeky-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Peeky"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "..\src-tauri\icons\icon.ico"
UninstallIcon "..\src-tauri\icons\icon.ico"
ShowInstDetails nevershow
AutoCloseWindow true
Caption "${NAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${NAME}"
VIAddVersionKey "FileDescription" "${NAME} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MIT License"
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  ; close whatever copy is running, under its current or its earlier name
  nsExec::Exec 'taskkill /F /T /IM "${EXE}"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "Qazi Island.exe"'
  Pop $0
  Sleep 800
  ; earlier versions (called Qazi Island) are replaced; their settings and pins are taken over by the app itself
  RMDir /r "$LOCALAPPDATA\Programs\qazi-island"
  RMDir /r "$LOCALAPPDATA\Programs\Qazi Island"
  Delete "$SMPROGRAMS\Qazi Island.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\d0c3e6a1-886d-5c4f-9c9e-ecc7654a4d1f"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\QaziIsland"
  DeleteRegValue HKCU "${RUN}" "Qazi Island"

  SetOutPath "$INSTDIR"
  File "/oname=${EXE}" "..\src-tauri\target\release\peeky.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\${NAME}.lnk" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "raminturne"
  WriteRegStr HKCU "${UNKEY}" "URLInfoAbout" "https://github.com/raminturne/peeky"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  Exec '"$INSTDIR\${EXE}"'
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /T /IM "${EXE}"'
  Pop $0
  Sleep 600
  Delete "$SMPROGRAMS\${NAME}.lnk"
  DeleteRegValue HKCU "${RUN}" "${NAME}"
  DeleteRegKey HKCU "${UNKEY}"
  RMDir /r "$INSTDIR"
SectionEnd