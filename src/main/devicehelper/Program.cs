using System.Text;
using DeviceHelper;

Console.OutputEncoding = Encoding.UTF8;
Console.Error.WriteLine("[devicehelper] starting");

var manager = new DeviceManager(
    new BluetoothProvider(),
    new RazerProvider(),
    new DualSenseProvider()
);
manager.Start();

string? line;
while ((line = Console.ReadLine()) != null)
{
    var cmd = line.Trim();
    if (cmd == "quit") break;
    if (cmd == "refresh") manager.EmitNow();
}

manager.Stop();
Console.Error.WriteLine("[devicehelper] stopped");
