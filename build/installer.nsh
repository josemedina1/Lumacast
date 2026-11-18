; Evita que una instancia anterior conserve el bloqueo y vuelva a mostrar su interfaz.
!macro customInit
  Push $R0
  legacy_running_check:
    nsProcess::_FindProcess /NOUNLOAD "TSG Pantalla.exe"
    Pop $R0
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "La version anterior (TSG Pantalla) sigue abierta. Cierrala desde su boton X, tambien si esta minimizada, y pulsa Reintentar para instalar LumaCast. No abras el acceso directo anterior." /SD IDCANCEL IDRETRY legacy_running_check
      Pop $R0
      Quit
    ${EndIf}
  Pop $R0
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "TSG Pantalla Receptor"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LumaCast Receptor"
!macroend

!macro customInstall
  Delete "$DESKTOP\TSG Pantalla.lnk"
  Delete "$SMPROGRAMS\TSG Pantalla.lnk"
!macroend
