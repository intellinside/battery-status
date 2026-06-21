using System.Runtime.InteropServices;

namespace DeviceHelper;

[StructLayout(LayoutKind.Sequential)]
struct WinOverlapped
{
    public nuint  Internal;
    public nuint  InternalHigh;
    public uint   OffsetLow;
    public uint   OffsetHigh;
    public IntPtr hEvent;
}

static partial class Win32
{
    internal const uint GENERIC_READ       = 0x80000000;
    internal const uint GENERIC_WRITE      = 0x40000000;
    internal const uint FILE_SHARE_READ    = 0x00000001;
    internal const uint FILE_SHARE_WRITE   = 0x00000002;
    internal const uint OPEN_EXISTING      = 3;
    internal const uint FILE_FLAG_OVERLAPPED = 0x40000000;
    internal const uint WAIT_OBJECT_0      = 0;
    internal const int  ERROR_IO_PENDING   = 997;
    internal static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);

    [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW",
        StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
    internal static partial IntPtr CreateFile(
        string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition,
        uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool CloseHandle(IntPtr hObject);

    [LibraryImport("kernel32.dll", EntryPoint = "CreateEventW", SetLastError = true)]
    internal static partial IntPtr CreateEvent(
        IntPtr lpEventAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool bManualReset,
        [MarshalAs(UnmanagedType.Bool)] bool bInitialState,
        IntPtr lpName);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    internal static partial uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static unsafe partial bool ReadFile(
        IntPtr hFile, void* lpBuffer, uint nNumberOfBytesToRead,
        uint* lpNumberOfBytesRead, WinOverlapped* lpOverlapped);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static unsafe partial bool GetOverlappedResult(
        IntPtr hFile, WinOverlapped* lpOverlapped,
        uint* lpNumberOfBytesTransferred,
        [MarshalAs(UnmanagedType.Bool)] bool bWait);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool CancelIo(IntPtr hFile);

    [LibraryImport("hid.dll", EntryPoint = "HidD_SetFeature", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static unsafe partial bool HidD_SetFeatureReport(
        IntPtr HidDeviceObject, void* lpReportBuffer, uint ReportBufferLength);

    [LibraryImport("hid.dll", EntryPoint = "HidD_GetFeature", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static unsafe partial bool HidD_GetFeatureReport(
        IntPtr HidDeviceObject, void* lpReportBuffer, uint ReportBufferLength);

    // Configuration Manager — battery via CM_Get_DevNode_Property because Windows BT AEP
    // does not expose battery level as a WinRT property.
    [StructLayout(LayoutKind.Sequential)]
    internal struct DevPropKey { public Guid Fmtid; public uint Pid; }

    [LibraryImport("cfgmgr32.dll", EntryPoint = "CM_Locate_DevNodeW",
        StringMarshalling = StringMarshalling.Utf16)]
    internal static partial uint CM_Locate_DevNode(
        out uint pdnDevInst, string pDeviceID, uint ulFlags);

    [LibraryImport("cfgmgr32.dll", EntryPoint = "CM_Get_DevNode_PropertyW")]
    internal static unsafe partial uint CM_Get_DevNode_Property(
        uint dnDevInst, DevPropKey* PropertyKey, uint* PropertyType,
        byte* PropertyBuffer, uint* PropertyBufferSize, uint ulFlags);
}
