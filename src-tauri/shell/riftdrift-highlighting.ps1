# RiftDrift command-line highlighting for interactive PowerShell sessions.
# The script is passed directly to PowerShell, so it does not modify the
# user's profile or depend on the machine's script execution policy.

try {
    Import-Module PSReadLine -ErrorAction Stop

    $escape = [char]0x1b
    Set-PSReadLineOption -Colors @{
        Default            = "$escape[38;2;238;231;242m"
        Command            = "$escape[38;2;94;234;212m"
        Parameter          = "$escape[38;2;255;209;102m"
        String             = "$escape[38;2;99;217;139m"
        Operator           = "$escape[38;2;192;132;252m"
        Variable           = "$escape[38;2;192;132;252m"
        Keyword            = "$escape[38;2;192;132;252m"
        Type               = "$escape[38;2;110;168;254m"
        Number             = "$escape[38;2;110;168;254m"
        Member             = "$escape[38;2;238;231;242m"
        Comment            = "$escape[38;2;105;114;125m"
        Error              = "$escape[38;2;255;107;107m"
        ContinuationPrompt = "$escape[38;2;216;145;255m"
        Emphasis           = "$escape[38;2;255;226;154m"
    }
} catch {
    # PowerShell remains usable when PSReadLine is unavailable or disabled.
}
