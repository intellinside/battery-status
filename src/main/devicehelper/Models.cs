using System.Text.Json.Serialization;

namespace DeviceHelper;

sealed class DeviceDto
{
    [JsonPropertyName("id")]       public string  Id       { get; init; } = "";
    [JsonPropertyName("name")]     public string  Name     { get; init; } = "";
    [JsonPropertyName("address")]  public string  Address  { get; init; } = "";
    [JsonPropertyName("online")]   public bool    Online   { get; init; }
    [JsonPropertyName("battery")]  public int?    Battery  { get; init; }
    [JsonPropertyName("charging")] public string? Charging { get; init; }
}

sealed class DeviceMessage
{
    [JsonPropertyName("type")]    public string     Type    { get; init; } = "";
    [JsonPropertyName("devices")] public DeviceDto[] Devices { get; init; } = [];
}

[JsonSerializable(typeof(DeviceMessage))]
[JsonSerializable(typeof(DeviceDto[]))]
partial class AppJsonContext : JsonSerializerContext { }

record DeviceState(
    string  Id,
    string  Name,
    string  Address,
    bool    Online,
    int?    Battery,
    string? Charging);
