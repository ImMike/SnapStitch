; Included by electron-builder's NSIS installer (see "build" in package.json).
; Uninstalling also removes what the app registered for the current user:
; the native messaging host (setup.js) and the start-with-Windows entry.
; Not when the uninstaller runs as part of installing a newer version.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.snapstitch.desktop"
    DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.snapstitch.desktop"
    DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.snapstitch.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.snapstitch.desktop"
    RMDir /r "$LOCALAPPDATA\SnapStitch"
  ${endIf}
!macroend
