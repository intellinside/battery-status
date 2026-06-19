# Enumerates paired Bluetooth devices and their battery level + charging state.
# Emits a compact JSON array: [{ id, name, address, online, battery, charging }]
# battery is $null when the device does not report a level.
# charging is $null when the device does not report a power state.
#
# Notes on the approach (both matter for correctness AND speed):
#  * Battery can live on a PnP node other than the BTHENUM\DEV_ device node - e.g. the
#    Handsfree "Hands-Free AG" node ({0000111E...}, whose Class is System) for classic audio
#    devices, or the BTHLE node for LE devices. So we look across node types.
#  * Get-PnpDevice -PresentOnly (all classes) is very slow, and Get-PnpDeviceProperty is
#    ~1.7s per call. We therefore enumerate via a fast CIM filter and batch the battery
#    reads through a single pipeline over only the node types that can carry a level.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$batteryKey = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'  # DEVPKEY_Bluetooth_Battery

# Matches the 12-hex Bluetooth address in both `DEV_<addr>\` and `&0&<addr>_C...` forms,
# but NOT the hyphen-bounded tail of the Bluetooth base UUID (`...-00805F9B34FB`).
$addrRe = '[_&]([0-9A-Fa-f]{12})(?:_|\\|$)'

# Fast enumeration of every Bluetooth PnP entity (any class).
$entities = Get-CimInstance Win32_PnPEntity -Filter "PNPDeviceID LIKE 'BTH%'" -ErrorAction SilentlyContinue

# Node types that may expose the battery key: LE device/battery-service nodes and the
# classic Handsfree AG node. Read them all in one batched pipeline.
$candidates = $entities | Where-Object {
  $_.PNPDeviceID -match 'BTHLE(DEVICE)?\\' -or
  $_.PNPDeviceID -match 'DEV_[0-9A-Fa-f]{12}' -or
  $_.PNPDeviceID -match '0000111E' -or
  $_.PNPDeviceID -match '0000180F'
}

$batteryByAddress = @{}
$candidates |
  Get-PnpDeviceProperty -KeyName $batteryKey -ErrorAction SilentlyContinue |
  Where-Object { $_.Data -ne $null -and $_.Data -ne '' } |
  ForEach-Object {
    if ($_.InstanceId -match $addrRe) {
      $addr = $Matches[1].ToUpper()
      if (-not $batteryByAddress.ContainsKey($addr)) {
        try { $batteryByAddress[$addr] = [int]$_.Data } catch { }
      }
    }
  }

# DEVPKEY_Bluetooth_BatteryStatus: 1=discharging, 2=charging, 3=full/maintained
$batteryStateKey = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 3'
$chargingByAddress = @{}
$candidates |
  Get-PnpDeviceProperty -KeyName $batteryStateKey -ErrorAction SilentlyContinue |
  Where-Object { $_.Data -ne $null -and $_.Data -ne '' } |
  ForEach-Object {
    if ($_.InstanceId -match $addrRe) {
      $addr = $Matches[1].ToUpper()
      if (-not $chargingByAddress.ContainsKey($addr)) {
        try {
          $val = [int]$_.Data
          if ($val -eq 2) { $chargingByAddress[$addr] = 'charging' }
          elseif ($val -eq 1) { $chargingByAddress[$addr] = 'discharging' }
        } catch { }
      }
    }
  }

# PnP Status='OK' is unreliable for connection state on Windows 10/11 — both BTHENUM\DEV_
# (classic BT) and BTHLE\DEV_ (BLE) nodes persist even when the device is merely bonded.
# Use the Windows Runtime APIs which track actual radio link state for both protocols.
$onlineAddrs = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  [void][Windows.Devices.Bluetooth.BluetoothDevice,             Windows.Devices.Bluetooth,   ContentType=WindowsRuntime]
  [void][Windows.Devices.Bluetooth.BluetoothLEDevice,           Windows.Devices.Bluetooth,   ContentType=WindowsRuntime]
  [void][Windows.Devices.Enumeration.DeviceInformation,         Windows.Devices.Enumeration, ContentType=WindowsRuntime]
  [void][Windows.Devices.Enumeration.DeviceInformationCollection, Windows.Devices.Enumeration, ContentType=WindowsRuntime]

  $connected   = [Windows.Devices.Bluetooth.BluetoothConnectionStatus]::Connected
  $btSelector  = [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromConnectionStatus($connected)
  $bleSelector = [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromConnectionStatus($connected)

  $asTask  = $asTaskGeneric.MakeGenericMethod([Windows.Devices.Enumeration.DeviceInformationCollection])
  # Start both queries concurrently before waiting for either.
  $btTask  = $asTask.Invoke($null, @([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($btSelector)))
  $bleTask = $asTask.Invoke($null, @([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($bleSelector)))
  [void]$btTask.Wait(5000)
  [void]$bleTask.Wait(5000)

  $macRe = '-([0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2})$'
  foreach ($dev in @($btTask.Result) + @($bleTask.Result)) {
    # ID format: "Bluetooth[LE]#Bluetooth[LE]<adapter>-<device>" with colon-separated MACs
    if ($dev.Id -match $macRe) {
      [void]$onlineAddrs.Add(($Matches[1] -replace ':', '').ToUpper())
    }
  }
} catch { }

# Group every entity by Bluetooth address to build the device list.
$map = @{}
foreach ($e in $entities) {
  if ($e.PNPDeviceID -notmatch $addrRe) { continue }
  $addr = $Matches[1].ToUpper()

  if (-not $map.ContainsKey($addr)) {
    $map[$addr] = [PSCustomObject]@{
      id      = $addr
      devName = $null   # preferred name, from the DEV_ node
      altName = $null   # cleaned service-name fallback
      address = $addr
      online  = $onlineAddrs.Contains($addr)
    }
  }
  $entry = $map[$addr]

  if ($e.PNPDeviceID -match '\\DEV_' -and $e.Name) {
    $entry.devName = $e.Name
  }
  elseif (-not $entry.altName -and $e.Name) {
    $entry.altName = ($e.Name -replace '^LE_', '' -replace '\s+(Hands-Free( AG)?|Avrcp Transport|AG)$', '').Trim()
  }
}

$result = @()
foreach ($entry in $map.Values) {
  if ($entry.devName) { $name = $entry.devName }
  elseif ($entry.altName) { $name = $entry.altName }
  else { $name = $entry.address }

  $battery = $null
  if ($batteryByAddress.ContainsKey($entry.address)) { $battery = $batteryByAddress[$entry.address] }

  $charging = $null
  if ($chargingByAddress.ContainsKey($entry.address)) { $charging = $chargingByAddress[$entry.address] }

  $result += [PSCustomObject]@{
    id       = $entry.id
    name     = $name
    address  = $entry.address
    online   = $entry.online
    battery  = $battery
    charging = $charging
  }
}

# Always emit a JSON array (ConvertTo-Json collapses single items to an object).
if ($result.Count -eq 0) {
  '[]'
}
else {
  ConvertTo-Json -InputObject $result -Compress -Depth 4
}
