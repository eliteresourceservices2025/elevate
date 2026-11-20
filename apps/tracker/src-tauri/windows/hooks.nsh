; ELEVATE Tracker App: extra steps for Tauri's NSIS uninstaller.
;
; Uninstalling always removes this computer's saved sign-in (Windows Credential Manager). The local queue and history are removed only
; when the person ticks Tauri's "Delete the application data" box (unchecked by default); deleting them loses only activity that was
; not yet sent, and never touches hours in ELEVATE. Nothing here runs during an update, so an update never signs the person out.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; The app saves its token as user "device", service "ELEVATE Tracker App"; Windows lists that target as shown here.
    nsExec::Exec 'cmd.exe /c cmdkey /delete:"LegacyGeneric:target=device.ELEVATE Tracker App"'
    Pop $0
  ${EndIf}
!macroend
