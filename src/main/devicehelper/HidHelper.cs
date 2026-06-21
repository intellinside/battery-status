using System.Runtime.InteropServices;

namespace DeviceHelper;

static class HidHelper
{
    internal static IntPtr Open(string path)
    {
        var h = Win32.CreateFile(path,
            Win32.GENERIC_READ | Win32.GENERIC_WRITE,
            Win32.FILE_SHARE_READ | Win32.FILE_SHARE_WRITE,
            IntPtr.Zero, Win32.OPEN_EXISTING, Win32.FILE_FLAG_OVERLAPPED, IntPtr.Zero);
        return h == Win32.INVALID_HANDLE_VALUE ? IntPtr.Zero : h;
    }

    // Zero-access open — mirrors hidapi open_device(path, open_rw=FALSE).
    // desiredAccess=0 bypasses sharing checks entirely; HidD_SetFeature/GetFeature use
    // DeviceIoControl (IOCTL_HID_SET/GET_FEATURE) which the kernel services without
    // validating the file handle's access mask, so feature reports work on these handles.
    internal static IntPtr OpenZeroAccess(string path)
    {
        var h = Win32.CreateFile(path,
            0,
            Win32.FILE_SHARE_READ | Win32.FILE_SHARE_WRITE,
            IntPtr.Zero, Win32.OPEN_EXISTING, Win32.FILE_FLAG_OVERLAPPED, IntPtr.Zero);
        return h == Win32.INVALID_HANDLE_VALUE ? IntPtr.Zero : h;
    }

    internal static unsafe bool SetFeature(IntPtr handle, byte[] report)
    {
        fixed (byte* ptr = report)
            return Win32.HidD_SetFeatureReport(handle, ptr, (uint)report.Length);
    }

    internal static unsafe bool GetFeature(IntPtr handle, byte[] report)
    {
        fixed (byte* ptr = report)
            return Win32.HidD_GetFeatureReport(handle, ptr, (uint)report.Length);
    }

    // Overlapped read with timeout. Returns true on success; bytesRead = actual bytes transferred.
    internal static unsafe bool ReadTimeout(IntPtr handle, byte[] buffer, int timeoutMs, out int bytesRead)
    {
        bytesRead = 0;
        var evt = Win32.CreateEvent(IntPtr.Zero, true, false, IntPtr.Zero);
        if (evt == IntPtr.Zero) return false;
        try
        {
            var  ov        = new WinOverlapped { hEvent = evt };
            uint immediate = 0;
            fixed (byte* ptr = buffer)
            {
                if (Win32.ReadFile(handle, ptr, (uint)buffer.Length, &immediate, &ov))
                {
                    bytesRead = (int)immediate;
                    return true;
                }
                if (Marshal.GetLastWin32Error() != Win32.ERROR_IO_PENDING)
                    return false;
                if (Win32.WaitForSingleObject(evt, (uint)timeoutMs) != Win32.WAIT_OBJECT_0)
                {
                    Win32.CancelIo(handle);
                    return false;
                }
                uint transferred = 0;
                if (!Win32.GetOverlappedResult(handle, &ov, &transferred, false))
                    return false;
                bytesRead = (int)transferred;
            }
            return true;
        }
        finally { Win32.CloseHandle(evt); }
    }
}
