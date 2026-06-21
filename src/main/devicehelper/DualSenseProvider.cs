using System.Collections.Concurrent;
using System.Text;
using System.Text.RegularExpressions;
using Windows.Devices.Enumeration;
using Windows.Devices.HumanInterfaceDevice;

namespace DeviceHelper;

// WinRT HID DeviceWatcher + Win32 overlapped input reports.
sealed class DualSenseProvider : IDeviceProvider
{
    static readonly HashSet<string> SupportedPids = ["0ce6", "0df2"];
    static readonly Regex PidRe = new(@"PID_([0-9A-Fa-f]{4})", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    record Entry(string InterfacePath, IntPtr Handle, DeviceState State, CancellationTokenSource Cts);
    readonly ConcurrentDictionary<string, Entry> _devices = new(StringComparer.Ordinal);

    DeviceWatcher? _watcher;
    Action?        _onChanged;
    Action?        _onInitialized;

    string? MatchDevice(string interfacePath)
    {
        if (!interfacePath.Contains("VID_054C", StringComparison.OrdinalIgnoreCase)) return null;
        var m = PidRe.Match(interfacePath);
        if (!m.Success) return null;
        var pid = m.Groups[1].Value.ToLowerInvariant();
        return SupportedPids.Contains(pid) ? pid : null;
    }

    // Read MAC from feature report 0x09 (bytes 1..6, reversed → uppercase hex, 12 chars)
    static string? ReadMac(IntPtr handle)
    {
        var buf = new byte[64];
        buf[0] = 0x09;
        if (!HidHelper.GetFeature(handle, buf) || buf.Length < 7) return null;
        var sb = new StringBuilder(12);
        for (int i = 6; i >= 1; i--) sb.Append(buf[i].ToString("X2"));
        var hex = sb.ToString();
        return hex.Length == 12 && hex.All(c => c is (>= '0' and <= '9') or (>= 'A' and <= 'F')) ? hex : null;
    }

    static string? DualSenseCharging(int nibble) => nibble switch
    {
        0x1 => "charging",
        0x0 => "discharging",
        _   => null   // 0x2=idle/full, others=unknown — let poller infer
    };

    public void Start(Action onChanged, Action onInitialized)
    {
        _onChanged     = onChanged;
        _onInitialized = onInitialized;

        // gamepad usage page 0x0001, usage 0x0005; filter VID/PID in code
        var selector = HidDevice.GetDeviceSelector(usagePage: 0x0001, usageId: 0x0005);
        _watcher = DeviceInformation.CreateWatcher(selector, null, DeviceInformationKind.DeviceInterface);
        _watcher.Added   += (_, info)   => DeviceAdded(info);
        _watcher.Removed += (_, update) => DeviceRemoved(update);
        _watcher.EnumerationCompleted += (_, _) => onInitialized();
        _watcher.Start();
    }

    void DeviceAdded(DeviceInformation info)
    {
        var pid = MatchDevice(info.Id);
        if (pid == null) return;

        var handle = HidHelper.Open(info.Id);
        if (handle == IntPtr.Zero) return;

        // Try to read MAC; use as device ID so USB and BT collapse to one record
        var mac   = ReadMac(handle);
        var devId = mac ?? $"hid:54c:{pid}";

        if (_devices.ContainsKey(devId)) { Win32.CloseHandle(handle); return; }

        var name  = info.Name.Length > 0 ? info.Name : "DualSense Wireless Controller";
        var cts   = new CancellationTokenSource();
        var state = new DeviceState(devId, name, mac ?? devId, true, null, null);
        _devices[devId] = new Entry(info.Id, handle, state, cts);

        var token = cts.Token;
        new Thread(() => ReadLoop(devId, handle, token))
        {
            IsBackground = true, Name = $"ds-{devId[..Math.Min(devId.Length, 8)]}"
        }.Start();

        _onChanged?.Invoke();
    }

    void RemoveDevice(string devId)
    {
        if (!_devices.TryRemove(devId, out var entry)) return;
        entry.Cts.Cancel();
        entry.Cts.Dispose();
        if (entry.Handle != IntPtr.Zero) Win32.CloseHandle(entry.Handle);
        _onChanged?.Invoke();
    }

    void ReadLoop(string devId, IntPtr handle, CancellationToken token)
    {
        // Windows BT HID driver can keep a device interface accessible even after physical
        // disconnect. Track consecutive read failures to detect this case.
        int failCount = 0;
        const int maxFails = 5; // ~12.5 s of failed reads → treat as disconnected

        while (!token.IsCancellationRequested)
        {
            if (!_devices.TryGetValue(devId, out var entry)) break;

            var buf = new byte[100];
            if (!HidHelper.ReadTimeout(handle, buf, timeoutMs: 2000, out int n))
            {
                if (token.IsCancellationRequested) break;
                if (++failCount >= maxFails)
                {
                    Console.Error.WriteLine($"[DS] {devId}: {maxFails} consecutive read failures, removing");
                    RemoveDevice(devId);
                    return;
                }
                Thread.Sleep(500);
                continue;
            }
            failCount = 0;

            int?    battery  = null;
            string? charging = null;
            try
            {
                // BT minimal mode: short 0x01 report (< 64 bytes) — request full reports
                if (buf[0] == 0x01 && n < 64)
                {
                    var feat05 = new byte[64]; feat05[0] = 0x05;
                    HidHelper.GetFeature(handle, feat05);
                    Thread.Sleep(100);
                    continue;
                }

                byte statusByte;
                if      (buf[0] == 0x01 && n > 53) statusByte = buf[53]; // USB full report
                else if (buf[0] == 0x31 && n > 54) statusByte = buf[54]; // BT full report
                else { Thread.Sleep(100); continue; }

                var level     = statusByte & 0x0F;
                var chgNibble = (statusByte >> 4) & 0x0F;
                battery  = Math.Min(level * 10 + 5, 100);
                charging = DualSenseCharging(chgNibble);
            }
            catch { Thread.Sleep(100); continue; }

            if (battery != null && (battery != entry.State.Battery || charging != entry.State.Charging))
            {
                _devices[devId] = entry with { State = entry.State with { Battery = battery, Charging = charging } };
                _onChanged?.Invoke();
            }

            // Throttle: re-read every 5 seconds
            if (!token.IsCancellationRequested)
                Thread.Sleep(4900);
        }
    }

    void DeviceRemoved(DeviceInformationUpdate update)
    {
        var toRemove = _devices.FirstOrDefault(kvp => kvp.Value.InterfacePath == update.Id);
        if (toRemove.Key == null) return;
        if (!_devices.TryRemove(toRemove.Key, out var entry)) return;
        entry.Cts.Cancel();
        if (entry.Handle != IntPtr.Zero) Win32.CloseHandle(entry.Handle);
        _onChanged?.Invoke();
    }

    public void Stop()
    {
        try { _watcher?.Stop(); } catch { }
        foreach (var entry in _devices.Values)
        {
            entry.Cts.Cancel();
            if (entry.Handle != IntPtr.Zero) Win32.CloseHandle(entry.Handle);
        }
        _devices.Clear();
    }

    public IReadOnlyList<DeviceState> GetDevices() =>
        _devices.Values.Select(e => e.State).ToList();
}
