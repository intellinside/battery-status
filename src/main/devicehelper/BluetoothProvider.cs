using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Windows.Devices.Bluetooth;
using Windows.Devices.Enumeration;

namespace DeviceHelper;

// WinRT DeviceWatcher (null properties) + CM_Get_DevNode_Property for battery +
// BluetoothDevice.ConnectionStatusChanged for online state.
sealed class BluetoothProvider : IDeviceProvider
{
    record BtState(string Name, bool Online, int? Battery, string? Charging);

    // Key: 12-char uppercase hex MAC (no colons)
    readonly ConcurrentDictionary<string, BtState> _devices   = new(StringComparer.Ordinal);
    // Key: PnP instance ID → hex MAC (for battery reads via cfgmgr32)
    readonly ConcurrentDictionary<string, string>  _instToHex = new(StringComparer.OrdinalIgnoreCase);

    DeviceWatcher? _aepWatcher;
    DeviceWatcher? _aepLeWatcher;
    DeviceWatcher? _pnpWatcher;
    Action?        _onChanged;
    Action?        _onInitialized;
    int            _enumDone;   // reaches 3 when all three watchers finish initial enumeration
    Timer?         _battTimer;

    // DEVPKEY_Bluetooth_Battery = {104EA319-6EE2-4701-BD47-8DDBF425BBE5} pid=2
    static readonly Guid BtBattGuid = new("104EA319-6EE2-4701-BD47-8DDBF425BBE5");

    // Requested via AEP watcher — gives connectivity state in DeviceInformation.Properties.
    static readonly string[] AepProperties = ["System.Devices.Aep.IsConnected"];

    // Extracts 12-char hex MAC from AEP device IDs:
    // "Bluetooth#BluetoothAA:BB:CC:DD:EE:FF-11:22:33:44:55:66"
    static string? AepToHex(string id)
    {
        var dash = id.LastIndexOf('-');
        if (dash < 0) return null;
        var hex = id[(dash + 1)..].Replace(":", "").ToUpperInvariant();
        return hex.Length == 12 ? hex : null;
    }

    // Extracts 12-char hex MAC from PnP instance IDs:
    // "BTHENUM\DEV_AABBCCDDEEFF\..." or "BTHLE\...\AABBCCDDEEFF"
    static readonly Regex HexAddrRe = new(@"[_&]([0-9A-Fa-f]{12})(?:[_\\#]|$)", RegexOptions.Compiled);
    static string? InstanceToHex(string id)
    {
        var m = HexAddrRe.Match(id);
        return m.Success ? m.Groups[1].Value.ToUpperInvariant() : null;
    }

    // Read DEVPKEY_Bluetooth_Battery via cfgmgr32.
    // Windows BT AEP does not expose battery level as a WinRT property, so P/Invoke is still needed.
    static int? ReadBattery(string instanceId)
    {
        uint cr = Win32.CM_Locate_DevNode(out uint devInst, instanceId, 0 /*CM_LOCATE_DEVNODE_NORMAL*/);
        if (cr != 0) return null;
        unsafe
        {
            var  key      = new Win32.DevPropKey { Fmtid = BtBattGuid, Pid = 2 };
            uint propType = 0;
            byte valByte  = 0;
            uint size     = 1;
            cr = Win32.CM_Get_DevNode_Property(devInst, &key, &propType, &valByte, &size, 0);
            return cr == 0 ? (int)valByte : null;
        }
    }

    static bool IsConnected(IReadOnlyDictionary<string, object?> props) =>
        props.TryGetValue("System.Devices.Aep.IsConnected", out var v) && v is true;

    public void Start(Action onChanged, Action onInitialized)
    {
        _onChanged     = onChanged;
        _onInitialized = onInitialized;

        // Classic BT AEP watcher: paired Classic Bluetooth devices with connectivity property.
        // DeviceWatcher.Updated fires when IsConnected changes → reactive online/offline tracking.
        var aepSelector = BluetoothDevice.GetDeviceSelectorFromPairingState(true);
        _aepWatcher = DeviceInformation.CreateWatcher(aepSelector, AepProperties, DeviceInformationKind.AssociationEndpoint);
        _aepWatcher.Added   += (_, info) => AepAdded(info);
        _aepWatcher.Updated += (_, upd)  => AepUpdated(upd);
        _aepWatcher.Removed += (_, upd)  => AepRemoved(upd);
        _aepWatcher.EnumerationCompleted += (_, _) => CheckDone();
        _aepWatcher.Start();

        // BLE AEP watcher: paired Bluetooth Low Energy devices (keyboards, some headsets).
        var aepLeSelector = BluetoothLEDevice.GetDeviceSelectorFromPairingState(true);
        _aepLeWatcher = DeviceInformation.CreateWatcher(aepLeSelector, AepProperties, DeviceInformationKind.AssociationEndpoint);
        _aepLeWatcher.Added   += (_, info) => AepAdded(info);
        _aepLeWatcher.Updated += (_, upd)  => AepUpdated(upd);
        _aepLeWatcher.Removed += (_, upd)  => AepRemoved(upd);
        _aepLeWatcher.EnumerationCompleted += (_, _) => CheckDone();
        _aepLeWatcher.Start();

        // PnP watcher: collects BTH/BTHLE device instance IDs for cfgmgr32 battery reads.
        const string pnpSelector = "System.Devices.DeviceInstanceId:~~\"BTH\"";
        _pnpWatcher = DeviceInformation.CreateWatcher(pnpSelector, null, DeviceInformationKind.Device);
        _pnpWatcher.Added   += (_, info) => PnpAdded(info);
        _pnpWatcher.Removed += (_, upd)  => PnpRemoved(upd);
        _pnpWatcher.EnumerationCompleted += (_, _) => CheckDone();
        _pnpWatcher.Start();

        // Periodic battery re-poll (60 s interval, first tick at 10 s)
        _battTimer = new Timer(PollBattery, null,
            TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(60));
    }

    void CheckDone()
    {
        if (Interlocked.Increment(ref _enumDone) >= 3)
            _onInitialized?.Invoke();
    }

    void AepAdded(DeviceInformation info)
    {
        var hex = AepToHex(info.Id);
        if (hex == null) return;
        var name   = info.Name.Length > 0 ? info.Name : hex;
        var online = IsConnected(info.Properties);
        _devices.AddOrUpdate(hex,
            _ => new BtState(name, online, null, null),
            (_, s) => s with { Name = name, Online = online });
        _onChanged?.Invoke();
    }

    void AepUpdated(DeviceInformationUpdate upd)
    {
        var hex = AepToHex(upd.Id);
        if (hex == null) return;
        if (!upd.Properties.TryGetValue("System.Devices.Aep.IsConnected", out var v)) return;
        var online = v is true;
        _devices.AddOrUpdate(hex,
            _ => new BtState(hex, online, null, null),
            (_, s) => s with { Online = online });
        _onChanged?.Invoke();
    }

    void AepRemoved(DeviceInformationUpdate upd)
    {
        var hex = AepToHex(upd.Id);
        if (hex != null) _devices.TryRemove(hex, out _);
        _onChanged?.Invoke();
    }

    void PnpAdded(DeviceInformation info)
    {
        var hex = InstanceToHex(info.Id);
        if (hex == null) return;
        _instToHex[info.Id] = hex;

        var battery = ReadBattery(info.Id);
        if (battery == null) return;
        _devices.AddOrUpdate(hex,
            _ => new BtState(hex, false, battery, null),
            (_, s) => s with { Battery = battery });
        _onChanged?.Invoke();
    }

    void PnpRemoved(DeviceInformationUpdate upd)
    {
        _instToHex.TryRemove(upd.Id, out _);
    }

    void PollBattery(object? _)
    {
        bool changed = false;
        foreach (var (instanceId, hex) in _instToHex.ToArray())
        {
            var battery = ReadBattery(instanceId);
            if (battery == null) continue;
            _devices.AddOrUpdate(hex,
                _ => new BtState(hex, false, battery, null),
                (_, s) =>
                {
                    if (s.Battery == battery) return s;
                    changed = true;
                    return s with { Battery = battery };
                });
        }
        if (changed) _onChanged?.Invoke();
    }

    public void Stop()
    {
        _battTimer?.Dispose();
        try { _aepWatcher?.Stop();   } catch { }
        try { _aepLeWatcher?.Stop(); } catch { }
        try { _pnpWatcher?.Stop();   } catch { }
    }

    public IReadOnlyList<DeviceState> GetDevices() =>
        _devices.Select(kvp => new DeviceState(
            kvp.Key, kvp.Value.Name, kvp.Key,
            kvp.Value.Online, kvp.Value.Battery, kvp.Value.Charging)).ToList();
}
