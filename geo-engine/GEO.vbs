' Visibility Engine launcher.
'
' Why this file exists: running node directly opens a black console window that
' has to stay on screen for as long as you work. This launcher runs the same
' thing with no window at all, and waits for a signal file so a failure is
' reported instead of vanishing silently.
'
' Kept ASCII on purpose: a .vbs file is read as ANSI by Windows Script Host, so
' Hebrew here would come out as garbage. The program itself is in Hebrew; only
' these rare failure messages are not.

Option Explicit

Dim sh, fso, here, dataDir, urlFile, errFile, logFile, chkFile, i, title

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

title = "Visibility Engine"
here  = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here

dataDir = fso.BuildPath(here, "data")
If Not fso.FolderExists(dataDir) Then fso.CreateFolder dataDir

urlFile = fso.BuildPath(dataDir, "app-url.txt")
errFile = fso.BuildPath(dataDir, "app-error.txt")
logFile = fso.BuildPath(dataDir, "app-log.txt")
chkFile = fso.BuildPath(dataDir, "node-check.txt")

On Error Resume Next
If fso.FileExists(urlFile) Then fso.DeleteFile urlFile, True
If fso.FileExists(errFile) Then fso.DeleteFile errFile, True
On Error GoTo 0

' Hidden and synchronous, so no console flashes on screen.
sh.Run "cmd /c where node > """ & chkFile & """ 2>&1", 0, True
If InStr(LCase(ReadAllSafe(chkFile)), "node.exe") = 0 Then
  MsgBox "Node.js is not installed on this computer." & vbCrLf & vbCrLf & _
         "Run RUN-ME.bat in the project folder first.", 16, title
  WScript.Quit 1
End If

If Not fso.FolderExists(fso.BuildPath(here, "node_modules")) Then
  MsgBox "The libraries are missing." & vbCrLf & vbCrLf & _
         "Run RUN-ME.bat in the project folder first.", 16, title
  WScript.Quit 1
End If

' 0 = no window, False = do not wait for it to finish
sh.Run "cmd /c node src\app.js > """ & logFile & """ 2>&1", 0, False

' Wait for the signal. The program opens its own window as soon as it is ready.
For i = 1 To 120
  If fso.FileExists(urlFile) Then WScript.Quit 0
  If fso.FileExists(errFile) Then
    MsgBox "The program did not start:" & vbCrLf & vbCrLf & ReadAllSafe(errFile) & vbCrLf & vbCrLf & _
           "Full details:" & vbCrLf & logFile, 16, title
    WScript.Quit 1
  End If
  WScript.Sleep 250
Next

MsgBox "The program did not respond within 30 seconds." & vbCrLf & vbCrLf & _
       "What happened is written in:" & vbCrLf & logFile & vbCrLf & vbCrLf & _
       "You can also run GEO.bat to watch it start.", 48, title
WScript.Quit 1

Function ReadAllSafe(p)
  Dim f, t
  t = ""
  On Error Resume Next
  Set f = fso.OpenTextFile(p, 1)
  t = f.ReadAll()
  f.Close
  On Error GoTo 0
  ReadAllSafe = t
End Function
