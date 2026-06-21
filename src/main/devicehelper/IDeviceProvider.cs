namespace DeviceHelper;

interface IDeviceProvider
{
    void Start(Action onChanged, Action onInitialized);
    void Stop();
    IReadOnlyList<DeviceState> GetDevices();
}
