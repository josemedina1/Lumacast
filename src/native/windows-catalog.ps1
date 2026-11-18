$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Read-Window($element) {
  try {
    $current = $element.Current
    if ($current.ControlType -ne [System.Windows.Automation.ControlType]::Window -or !$current.NativeWindowHandle -or !$current.Name) { return $null }
    $pattern = $null
    if (!$element.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$pattern)) { return $null }
    $handle = ([long]$current.NativeWindowHandle -band 0xffffffff).ToString([System.Globalization.CultureInfo]::InvariantCulture)
    return @{ hwnd=$handle; pid=$current.ProcessId; name=$current.Name; minimized=($pattern.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) }
  } catch { return $null }
}
while ($null -ne ($line = [Console]::ReadLine())) {
  $requestId = 0
  try {
    if ($line.Length -gt 2048) { throw 'Petición no válida.' }
    $request = ConvertFrom-Json $line
    $requestId = $request.id
    if ($request.cmd -eq 'list') {
      $windows = New-Object 'System.Collections.Generic.List[object]'
      $children = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
      foreach ($element in $children) { $item=Read-Window $element; if ($null -ne $item) { $windows.Add($item) } }
      $result = @($windows.ToArray())
    } elseif ($request.cmd -eq 'restore') {
      if ([string]$request.hwnd -notmatch '^\d{1,12}$') { throw 'Ventana no válida.' }
      $element = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([long]$request.hwnd))
      $current = Read-Window $element
      if ($null -eq $current -or $current.pid -ne $request.pid) { throw 'La ventana seleccionada ya no está disponible.' }
      if ($current.minimized) {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
        $pattern.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
        for ($attempt=0; $attempt -lt 40 -and $pattern.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized; $attempt++) { Start-Sleep -Milliseconds 25 }
        if ($pattern.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) { throw 'Windows no permitió restaurar esta ventana. Restáurala manualmente e intenta de nuevo.' }
      }
      $result = @{restored=$current.minimized}
    } else { throw 'Operación no válida.' }
    $reply = @{id=$requestId;result=$result}
  } catch { $reply = @{id=$requestId;error=$_.Exception.Message} }
  [Console]::WriteLine((ConvertTo-Json -InputObject $reply -Depth 6 -Compress))
}
