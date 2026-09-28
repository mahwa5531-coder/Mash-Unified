[CmdletBinding()]
param(
    [string]$Title = "Select Workspace Folder"
)

$code = @"
using System;
using System.Runtime.InteropServices;

public class NativeFolderPicker {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [ComImport]
    [Guid("D57C72BE-A45F-4A08-8F7E-E56B2545E1AC")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes();
        void SetFileTypeIndex();
        void GetFileTypeIndex();
        void Advise();
        void Unadvise();
        void SetOptions(uint fos);
        void GetOptions(out uint fos);
        void SetDefaultFolder(object psi);
        void SetFolder(object psi);
        void GetFolder(out object ppsi);
        void GetCurrentSelection(out object ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem {
        void BindToHandler();
        void GetParent();
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes();
        void Compare();
    }

    [ComImport]
    [Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    [ClassInterface(ClassInterfaceType.None)]
    public class FileOpenDialogRCW {}

    public static string PickFolder(string title) {
        try {
            var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
            // FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40
            dialog.SetOptions(0x20 | 0x40);
            if (!string.IsNullOrEmpty(title)) {
                dialog.SetTitle(title);
            }
            IntPtr owner = GetForegroundWindow();
            int hr = dialog.Show(owner);
            if (hr == 0) {
                IShellItem item;
                dialog.GetResult(out item);
                string path;
                item.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
                return path;
            }
        } catch {
        }
        return null;
    }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'NativeFolderPicker').Type) {
    Add-Type -TypeDefinition $code -Language CSharp
}

$selected = [NativeFolderPicker]::PickFolder($Title)
if ($selected) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $selected
}
