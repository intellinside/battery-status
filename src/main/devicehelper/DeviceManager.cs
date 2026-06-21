using System.Text.Json;

namespace DeviceHelper;

// Merges all providers, debounced stdout emit.
sealed class DeviceManager(params IDeviceProvider[] providers)
{
    readonly IDeviceProvider[] _providers = providers;
    int                        _initializedCount;
    CancellationTokenSource?   _debounceCts;
    readonly object            _debounceLock = new();

    public void Start()
    {
        foreach (var p in _providers)
            p.Start(OnChanged, OnProviderInitialized);
    }

    void OnProviderInitialized()
    {
        if (Interlocked.Increment(ref _initializedCount) >= _providers.Length)
            Emit("snapshot");
    }

    void OnChanged()
    {
        if (_initializedCount < _providers.Length) return;
        lock (_debounceLock)
        {
            _debounceCts?.Cancel();
            _debounceCts = new CancellationTokenSource();
            var tok = _debounceCts.Token;
            Task.Delay(150, tok).ContinueWith(t =>
            {
                if (!t.IsCanceled) Emit("update");
            }, TaskScheduler.Default);
        }
    }

    public void EmitNow() => Emit("update");

    void Emit(string type)
    {
        var all    = _providers.SelectMany(p => p.GetDevices()).ToList();
        var merged = Merge(all);
        var dtos   = merged.Select(d => new DeviceDto
        {
            Id       = d.Id,
            Name     = d.Name,
            Address  = d.Address,
            Online   = d.Online,
            Battery  = d.Battery,
            Charging = d.Charging
        }).ToArray();
        var json = JsonSerializer.Serialize(
            new DeviceMessage { Type = type, Devices = dtos },
            AppJsonContext.Default.DeviceMessage);
        Console.WriteLine(json);
    }

    // When the same device appears in multiple providers (e.g. DualSense via BT + HID),
    // merge by ID: HID battery/charging wins; BT name wins; online is OR.
    static List<DeviceState> Merge(List<DeviceState> all)
    {
        var byId = new Dictionary<string, DeviceState>(StringComparer.Ordinal);
        foreach (var d in all)
        {
            if (!byId.TryGetValue(d.Id, out var existing))
                byId[d.Id] = d;
            else
                byId[d.Id] = existing with
                {
                    Battery  = d.Battery  ?? existing.Battery,
                    Charging = d.Charging ?? existing.Charging,
                    Online   = d.Online || existing.Online,
                    Name     = existing.Name.Length > 0 ? existing.Name : d.Name
                };
        }
        return [.. byId.Values];
    }

    public void Stop()
    {
        lock (_debounceLock) _debounceCts?.Cancel();
        foreach (var p in _providers) p.Stop();
    }
}
