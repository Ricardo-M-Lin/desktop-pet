Option Explicit

Dim shell, fso, root, url, request, index
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:8190"

Function ServiceReady()
  On Error Resume Next
  Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
  request.SetTimeouts 250, 250, 500, 500
  request.Open "GET", url & "/system_stats", False
  request.Send
  ServiceReady = (Err.Number = 0 And request.Status = 200)
  Err.Clear
  On Error GoTo 0
End Function

If Not ServiceReady() Then
  shell.Run Chr(34) & root & "\启动 MiniMax H3.cmd" & Chr(34), 0, False
  For index = 1 To 60
    WScript.Sleep 1000
    If ServiceReady() Then Exit For
  Next
End If

shell.Run url, 1, False
