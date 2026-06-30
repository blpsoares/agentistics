; Tauri NSIS installer hooks
; The desktop app spawns `agentop.exe` as a sidecar process. Tauri's NSIS
; installer kills the main app (Agentistics.exe) but does NOT know about the
; sidecar, so if agentop.exe is still running the installer fails with
; "Error opening file for writing: ...\agentop.exe". Kill it before installing
; (and before uninstalling) so the file is never locked.

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM agentop.exe /T'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM agentop.exe /T'
!macroend
