using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Windows.Devices.Enumeration;

namespace DeviceHelper;

// Mirrors original Node.js vendor.ts behaviour: open fresh handle per query (no persistent
// handles), txId = 0x1f, 40 ms sleep, battery at resp[10].
sealed class RazerProvider : IDeviceProvider
{
    record RazerIface(string Path, string DevId, string Name);

    // All Razer HID interface paths reported by the watcher
    readonly ConcurrentDictionary<string, RazerIface>  _ifaces     = new(StringComparer.OrdinalIgnoreCase);
    // Current device states (devId → state)
    readonly ConcurrentDictionary<string, DeviceState> _devices    = new(StringComparer.Ordinal);
    // Last path that successfully returned battery for a given devId (mirrors Node.js razerPath cache)
    readonly ConcurrentDictionary<string, string>      _cachedPath = new(StringComparer.Ordinal);

    DeviceWatcher? _watcher;
    Timer?         _pollTimer;
    Action?        _onChanged;

    static readonly Regex PidRe = new(@"PID_([0-9A-Fa-f]{4})", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    string? GetDevId(string path)
    {
        if (!path.Contains("VID_1532", StringComparison.OrdinalIgnoreCase)) return null;
        var m = PidRe.Match(path);
        return m.Success ? $"hid:1532:{m.Groups[1].Value.ToLowerInvariant()}" : null;
    }

    public void Start(Action onChanged, Action onInitialized)
    {
        _onChanged = onChanged;

        const string selector =
            "System.Devices.InterfaceClassGuid:=\"{4D1E55B2-F16F-11CF-88CB-001111000030}\"";
        _watcher = DeviceInformation.CreateWatcher(selector, null, DeviceInformationKind.DeviceInterface);
        _watcher.Added += (_, info) =>
        {
            var devId = GetDevId(info.Id);
            if (devId == null) return;
            var name = info.Name.Length > 0 ? info.Name : $"Razer Device ({devId})";
            _ifaces[info.Id] = new RazerIface(info.Id, devId, name);
        };
        _watcher.Removed += (sender, upd) =>
        {
            if (!_ifaces.TryRemove(upd.Id, out var rp)) return;
            _cachedPath.TryRemove(rp.DevId, out _);
            if (!_ifaces.Values.Any(i => i.DevId == rp.DevId))
            {
                _devices.TryRemove(rp.DevId, out _);
                _onChanged?.Invoke();
            }
        };
        _watcher.EnumerationCompleted += (_, _) =>
        {
            onInitialized();
            ThreadPool.QueueUserWorkItem(_ => Poll(null));
        };
        _watcher.Start();

        _pollTimer = new Timer(Poll, null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
    }

    void Poll(object? _)
    {
        var byDevId = _ifaces.Values.GroupBy(i => i.DevId).ToList();
        bool changed = false;

        foreach (var group in byDevId)
        {
            var devId  = group.Key;
            var ifaces = group.ToList();

            // Try cached path first (mirrors Node.js razerPath caching)
            if (_cachedPath.TryGetValue(devId, out var cached))
                ifaces = ifaces.OrderBy(i => i.Path == cached ? 0 : 1).ToList();

            bool hit = false;
            foreach (var iface in ifaces)
            {
                var battRaw = TryQuery(iface.Path, 0x80);
                if (battRaw == null) continue;

                _cachedPath[devId] = iface.Path;

                var chgRaw   = TryQuery(iface.Path, 0x84);
                var battery  = Math.Clamp((int)Math.Round(battRaw.Value * 100.0 / 255.0), 0, 100);
                var charging = chgRaw == null ? null : chgRaw.Value != 0 ? "charging" : "discharging";

                var next = new DeviceState(devId, iface.Name, devId, true, battery, charging);
                if (!_devices.TryGetValue(devId, out var prev)
                    || !prev.Online || prev.Battery != battery || prev.Charging != charging)
                {
                    _devices[devId] = next;
                    changed = true;
                }
                hit = true;
                break;
            }

            if (!hit)
            {
                if (_devices.TryGetValue(devId, out var prev) && prev.Online)
                {
                    // All interface queries failed — device is physically gone but Removed event
                    // didn't fire yet (or won't). Mark offline so UI reflects actual state.
                    _devices[devId] = prev with { Online = false, Battery = null, Charging = null };
                    changed = true;
                }
                // Do not register a new device that hasn't responded to battery queries —
                // wired USB mice expose HID interfaces but don't implement the Razer battery
                // protocol, causing a spurious online→offline flicker on startup.
            }
        }

        if (changed) _onChanged?.Invoke();
    }

    int? TryQuery(string path, byte commandId)
    {
        // Mirror hidapi open_device: try GENERIC_READ|WRITE first, then fall back to
        // zero-access (desiredAccess=0). The kernel HID driver services HidD_SetFeature/
        // GetFeature IOCTLs without checking the handle's access mask, so zero-access handles
        // work even when Synapse holds MI_00 with an exclusive write lock.
        var handle = HidHelper.Open(path);
        if (handle == IntPtr.Zero)
        {
            handle = HidHelper.OpenZeroAccess(path);
            if (handle == IntPtr.Zero)
            {
                Console.Error.WriteLine($"[Razer] open failed [{Marshal.GetLastWin32Error()}]: {path}");
                return null;
            }
        }
        try { return QueryHandle(handle, commandId); }
        finally { Win32.CloseHandle(handle); }
    }

    static byte[] BuildReport(byte commandId, byte txId)
    {
        var b = new byte[91];
        b[0] = 0x00; // report id
        b[2] = txId;
        b[6] = 0x02; // data_size
        b[7] = 0x07; // command_class
        b[8] = commandId;
        byte crc = 0;
        for (int i = 3; i <= 88; i++) crc ^= b[i];
        b[89] = crc;
        return b;
    }

    // Exactly mirrors queryRazer(): txId=0x1f, sleep 40ms, value at resp[10]
    static int? QueryHandle(IntPtr handle, byte commandId)
    {
        const byte txId   = 0x1f;
        var        report = BuildReport(commandId, txId);

        if (!HidHelper.SetFeature(handle, report)) return null;

        Thread.Sleep(40);

        var resp = new byte[91];
        resp[0] = 0x00;
        if (!HidHelper.GetFeature(handle, resp)) return null;

        if (resp[1] == 0x02 && resp[7] == 0x07 && resp[8] == commandId)
            return resp[10];
        return null;
    }

    public void Stop()
    {
        _pollTimer?.Dispose();
        try { _watcher?.Stop(); } catch { }
    }

    public IReadOnlyList<DeviceState> GetDevices() =>
        _devices.Values.ToList();
}
