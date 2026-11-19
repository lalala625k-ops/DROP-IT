Unicode true
Name "@LABEL@"
OutFile "@INSTALLER@"
InstallDir "$LOCALAPPDATA\Drop-it"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show
AutoCloseWindow true
Icon "@ICON@"
UninstallIcon "@ICON@"
VIProductVersion "0.1.1.0"
VIAddVersionKey "ProductName" "DROP-IT"
VIAddVersionKey "FileDescription" "DROP-IT Setup"
VIAddVersionKey "FileVersion" "@VERSION@"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 lalala625k-ops. MIT License."
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles
Var NoAutoRun
Var NoShortcuts
Var NoRegistry
Var Parameters
Var PowerShell
Var RuntimeExit

Function .onInit
  SetShellVarContext current
  StrCpy $NoAutoRun "0"
  StrCpy $NoShortcuts "0"
  StrCpy $NoRegistry "0"
  ${GetParameters} $Parameters
  ClearErrors
  ${GetOptions} $Parameters "/NOAUTORUN" $0
  ${IfNot} ${Errors}
    StrCpy $NoAutoRun "1"
  ${EndIf}
  ClearErrors
  ${GetOptions} $Parameters "/NOSHORTCUTS" $0
  ${IfNot} ${Errors}
    StrCpy $NoShortcuts "1"
  ${EndIf}
  ClearErrors
  ${GetOptions} $Parameters "/NOREGISTRY" $0
  ${IfNot} ${Errors}
    StrCpy $NoRegistry "1"
    ; Isolated installations must not own or replace shared shortcuts.
    StrCpy $NoShortcuts "1"
  ${EndIf}
  StrCpy $PowerShell "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${RunningX64}
    StrCpy $PowerShell "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
FunctionEnd

Function RuntimePreflight
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\runtime"
  File "@PORTABLE_ROOT@\bootstrap\Ensure-Runtime.ps1"
  File "@PORTABLE_ROOT@\bootstrap\RuntimeCommon.ps1"
  File "@PORTABLE_ROOT@\bootstrap\RuntimeStatus.ps1"
  File "@PORTABLE_ROOT@\bootstrap\RuntimeProgress.ps1"
runtime_retry:
  DetailPrint "Preparing Windows runtime components... / 正在准备运行组件..."
  nsExec::ExecToLog '"$PowerShell" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\runtime\Ensure-Runtime.ps1" -Quiet -NonInteractive'
  Pop $RuntimeExit
  StrCmp $RuntimeExit "0" runtime_ready
  StrCmp $RuntimeExit "3010" runtime_reboot
  IfSilent runtime_failed
  MessageBox MB_RETRYCANCEL|MB_ICONSTOP "运行组件准备失败，请检查网络后重试。$\r$\nRuntime setup failed (code $RuntimeExit). Check your connection and retry.$\r$\n日志 / Log: %LOCALAPPDATA%\DropIt\bootstrap\logs\runtime-setup.log" IDRETRY runtime_retry
runtime_failed:
  SetErrorLevel 1
  Quit
runtime_reboot:
  IfSilent +2
  MessageBox MB_OK|MB_ICONINFORMATION "请重启 Windows 后重新运行此安装包。$\r$\nRestart Windows, then run this installer again."
  SetErrorLevel 3010
  Quit
runtime_ready:
  DetailPrint "Runtime components are ready. / 运行组件已就绪。"
FunctionEnd

Section "Install"
  Call RuntimePreflight
  SetOutPath "$INSTDIR"
  SetOverwrite on
  ClearErrors
  File "@PORTABLE_ROOT@\DropIt.exe"
  File "@PORTABLE_ROOT@\pinboard-service.exe"
  File "@PORTABLE_ROOT@\使用说明.txt"
  IfErrors install_failed
  SetOutPath "$INSTDIR\bootstrap"
  File "@PORTABLE_ROOT@\bootstrap\Ensure-Runtime.ps1"
  File "@PORTABLE_ROOT@\bootstrap\RuntimeCommon.ps1"
  File "@PORTABLE_ROOT@\bootstrap\RuntimeStatus.ps1"
  File "@PORTABLE_ROOT@\bootstrap\RuntimeProgress.ps1"
  IfErrors install_failed
  SetOutPath "$INSTDIR\Files\Template"
  SetOverwrite off
  File "@PORTABLE_ROOT@\Files\Template\Template一.drop"
  SetOverwrite on
  CreateDirectory "$INSTDIR\Files\Save"
  CreateDirectory "$INSTDIR\Files\Temporary"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  IfErrors install_failed
  WriteINIStr "$INSTDIR\install-state.ini" "Integration" "Registry" "0"
  WriteINIStr "$INSTDIR\install-state.ini" "Integration" "Shortcuts" "0"
  StrCmp $NoShortcuts "1" no_shortcuts
  CreateShortCut "$DESKTOP\Drop-it.lnk" "$INSTDIR\DropIt.exe"
  CreateShortCut "$SMPROGRAMS\Drop-it.lnk" "$INSTDIR\DropIt.exe"
  WriteINIStr "$INSTDIR\install-state.ini" "Integration" "Shortcuts" "1"
no_shortcuts:
  StrCmp $NoRegistry "1" install_done
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Drop-it" "DisplayName" "@LABEL@"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Drop-it" "DisplayVersion" "@VERSION@"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Drop-it" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Drop-it" "DisplayIcon" "$INSTDIR\DropIt.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Drop-it" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Drop-it" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Drop-it" "NoRepair" 1
  WriteINIStr "$INSTDIR\install-state.ini" "Integration" "Registry" "1"
  Goto install_done
install_failed:
  IfSilent +2
  MessageBox MB_OK|MB_ICONSTOP "安装文件写入失败，请关闭已运行的 DROP-IT 后重试。$\r$\nInstallation failed. Close DROP-IT and retry."
  SetErrorLevel 1
  Quit
install_done:
  SetOutPath "$INSTDIR"
SectionEnd

Function .onInstSuccess
  IfSilent no_autorun
  StrCmp $NoAutoRun "1" no_autorun
  Exec '"$INSTDIR\DropIt.exe"'
no_autorun:
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  ; A newer installation may now own the shared shortcuts and registry key.
  ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Drop-it" "InstallLocation"
  StrCmp $1 "$INSTDIR" 0 no_registry_remove
  ReadINIStr $0 "$INSTDIR\install-state.ini" "Integration" "Shortcuts"
  StrCmp $0 "1" 0 no_shortcut_remove
  Delete "$DESKTOP\Drop-it.lnk"
  Delete "$SMPROGRAMS\Drop-it.lnk"
no_shortcut_remove:
  ReadINIStr $0 "$INSTDIR\install-state.ini" "Integration" "Registry"
  StrCmp $0 "1" 0 no_registry_remove
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Drop-it"
no_registry_remove:
  Delete "$INSTDIR\DropIt.exe"
  Delete "$INSTDIR\pinboard-service.exe"
  Delete "$INSTDIR\使用说明.txt"
  Delete "$INSTDIR\bootstrap\Ensure-Runtime.ps1"
  Delete "$INSTDIR\bootstrap\RuntimeCommon.ps1"
  Delete "$INSTDIR\bootstrap\RuntimeStatus.ps1"
  Delete "$INSTDIR\bootstrap\RuntimeProgress.ps1"
  RMDir "$INSTDIR\bootstrap"
  Delete "$INSTDIR\install-state.ini"
  Delete "$INSTDIR\Uninstall.exe"
  ; Files contains user boards and recovery. Shared runtimes also stay installed.
  RMDir "$INSTDIR"
SectionEnd
