param(
  [string]$WidgetHandle = '0',
  [string]$LauncherHandle = '0',
  [ValidateSet('auto', 'code', 'kimi')]
  [string]$HostMode = 'auto',
  [int]$PollMs = 100
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class KimiHostNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)]
  public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
  public static IntPtr FindMainWindow(uint processId, string expectedTitle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      uint windowProcessId;
      GetWindowThreadProcessId(hWnd, out windowProcessId);
      if (windowProcessId != processId || !IsWindowVisible(hWnd)) return true;
      var title = new StringBuilder(512);
      GetWindowText(hWnd, title, title.Capacity);
      if (title.ToString() != expectedTitle) return true;
      found = hWnd;
      return false;
    }, IntPtr.Zero);
    return found;
  }
}
'@

$widget = [IntPtr]::new([Convert]::ToInt64($WidgetHandle))
$launcher = [IntPtr]::new([Convert]::ToInt64($LauncherHandle))
$allNames = @('Kimi Code', 'Kimi')
$names = switch ($HostMode) {
  'code' { @('Kimi Code') }
  'kimi' { @('Kimi') }
  default { $allNames }
}
$currentHost = [IntPtr]::Zero

while ($true) {
  $foreground = [KimiHostNative]::GetForegroundWindow()
  $allProcesses = @(Get-Process -Name $allNames -ErrorAction SilentlyContinue)
  $candidates = @($allProcesses | Where-Object {
    $names -contains $_.ProcessName
  } | ForEach-Object {
    $mainWindow = [KimiHostNative]::FindMainWindow([uint32]$_.Id, $_.ProcessName)
    if ($mainWindow -ne [IntPtr]::Zero) {
      [PSCustomObject]@{ ProcessName = $_.ProcessName; MainWindowHandle = $mainWindow }
    }
  })
  $selected = $null

  if ($HostMode -eq 'auto') {
    $selected = $candidates | Where-Object { $_.MainWindowHandle -eq $foreground -and -not [KimiHostNative]::IsIconic($_.MainWindowHandle) } | Select-Object -First 1
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
    [Console]::WriteLine((@{ found = $false; visible = $false; hostProcessCount = $allProcesses.Count } | ConvertTo-Json -Compress))
  } else {
    $hostHandle = [IntPtr]$selected.MainWindowHandle
    if ($hostHandle -ne $currentHost) {
      $currentHost = $hostHandle
      foreach ($ownedWindow in @($widget, $launcher)) {
        if ($ownedWindow -ne [IntPtr]::Zero) {
          [void][KimiHostNative]::SetWindowLongPtr($ownedWindow, -8, $hostHandle)
          $script:ownerError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        }
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
        hostProcessCount = $allProcesses.Count
        processName = $selected.ProcessName
        handle = $hostHandle.ToInt64().ToString()
        widget = $widget.ToInt64().ToString()
        launcher = $launcher.ToInt64().ToString()
        ownerHandle = [KimiHostNative]::GetWindow($widget, 4).ToInt64().ToString()
        launcherOwnerHandle = [KimiHostNative]::GetWindow($launcher, 4).ToInt64().ToString()
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
