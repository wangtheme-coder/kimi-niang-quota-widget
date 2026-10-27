param(
  [string]$WidgetHandle = '0',
  [ValidateSet('auto', 'code', 'kimi')]
  [string]$HostMode = 'auto',
  [int]$PollMs = 100
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KimiHostNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)]
  public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
}
'@

$widget = [IntPtr]::new([Convert]::ToInt64($WidgetHandle))
$names = switch ($HostMode) {
  'code' { @('Kimi Code') }
  'kimi' { @('Kimi') }
  default { @('Kimi Code', 'Kimi') }
}
$currentHost = [IntPtr]::Zero

while ($true) {
  $foreground = [KimiHostNative]::GetForegroundWindow()
  $candidates = @(Get-Process -Name $names -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })
  $selected = $null

  if ($HostMode -eq 'auto') {
    $selected = $candidates | Where-Object { $_.MainWindowHandle -eq $foreground } | Select-Object -First 1
    if ($null -eq $selected -and $currentHost -ne [IntPtr]::Zero) {
      $selected = $candidates | Where-Object {
        $_.MainWindowHandle -eq $currentHost -and -not [KimiHostNative]::IsIconic($_.MainWindowHandle)
      } | Select-Object -First 1
    }
    if ($null -eq $selected) {
      $selected = $candidates | Where-Object { -not [KimiHostNative]::IsIconic($_.MainWindowHandle) } | Select-Object -First 1
    }
    if ($null -eq $selected -and $currentHost -ne [IntPtr]::Zero) {
      $selected = $candidates | Where-Object { $_.MainWindowHandle -eq $currentHost } | Select-Object -First 1
    }
  }
  if ($null -eq $selected) { $selected = $candidates | Select-Object -First 1 }

  if ($null -eq $selected) {
    $currentHost = [IntPtr]::Zero
    [Console]::WriteLine('{"found":false,"visible":false}')
  } else {
    $hostHandle = [IntPtr]$selected.MainWindowHandle
    if ($hostHandle -ne $currentHost) {
      $currentHost = $hostHandle
      if ($widget -ne [IntPtr]::Zero) {
        [void][KimiHostNative]::SetWindowLongPtr($widget, -8, $hostHandle)
        $script:ownerError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      }
    }
    $rect = New-Object KimiHostNative+RECT
    $hasBounds = [KimiHostNative]::GetWindowRect($hostHandle, [ref]$rect)
    $minimized = [KimiHostNative]::IsIconic($hostHandle)
    $owner = [KimiHostNative]::GetWindow($foreground, 4)
    $visible = -not $minimized
    if ($hasBounds) {
      $payload = @{
        found = $true
        visible = $visible
        minimized = $minimized
        processName = $selected.ProcessName
        handle = $hostHandle.ToInt64().ToString()
        widget = $widget.ToInt64().ToString()
        ownerHandle = [KimiHostNative]::GetWindow($widget, 4).ToInt64().ToString()
        ownerError = $script:ownerError
        foregroundHandle = $foreground.ToInt64().ToString()
        foregroundOwner = $owner.ToInt64().ToString()
        foreground = ($foreground -eq $hostHandle -or $foreground -eq $widget -or $owner -eq $hostHandle -or $owner -eq $widget)
        x = $rect.Left
        y = $rect.Top
        width = $rect.Right - $rect.Left
        height = $rect.Bottom - $rect.Top
      }
      [Console]::WriteLine(($payload | ConvertTo-Json -Compress))
    }
  }
  Start-Sleep -Milliseconds $PollMs
}
