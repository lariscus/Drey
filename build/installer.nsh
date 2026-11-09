; NSIS additions for the Drey installer (electron-builder `nsis.include`).
;
; Uninstall removes Drey Service's start with Windows (req-165, ADR-0092):
; the per-user `Run` value `DreyService` the service writes while
; Settings -> Background service -> Start with Windows is on. Without it an
; uninstalled Drey would leave a log-in entry pointing at a wscript
; launcher whose binary is gone. A missing value is ignored.

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DreyService"
!macroend
