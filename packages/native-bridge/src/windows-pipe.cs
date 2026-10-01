// This helper runs under Windows PowerShell's .NET Framework. It keeps named-pipe
// security in the OS while the Node host owns all browser protocol/routing logic.
using System;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Collections.Concurrent;
using System.Threading;

public static class AgentNativePipe {
    static readonly object OutputLock = new object();
    static readonly Stream Output = Console.OpenStandardOutput();
    static readonly ConcurrentDictionary<int, NamedPipeServerStream> Clients = new ConcurrentDictionary<int, NamedPipeServerStream>();
    static int NextId;
    static string Name;

    // Private relay frames: uint32 length, byte event, int32 client ID, bytes.
    static void Send(byte kind, int id, byte[] data, int count) {
        lock (OutputLock) {
            var header = new byte[9];
            Buffer.BlockCopy(BitConverter.GetBytes(count + 5), 0, header, 0, 4);
            header[4] = kind;
            Buffer.BlockCopy(BitConverter.GetBytes(id), 0, header, 5, 4);
            Output.Write(header, 0, header.Length);
            if (count > 0) Output.Write(data, 0, count);
            Output.Flush();
        }
    }
    static NamedPipeServerStream Create() {
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
        return new NamedPipeServerStream(Name, PipeDirection.InOut, 16, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security);
    }
    static void Accept(object initial) {
        var pipe = (NamedPipeServerStream)initial;
        for (;;) {
            int id = 0;
            try {
                pipe.WaitForConnection();
                id = Interlocked.Increment(ref NextId);
                Clients[id] = pipe;
                Send(1, id, null, 0);
                var buffer = new byte[65536];
                int count;
                while ((count = pipe.Read(buffer, 0, buffer.Length)) > 0) Send(2, id, buffer, count);
            } catch (IOException) { } catch (ObjectDisposedException) { }
            finally {
                NamedPipeServerStream removed;
                if (id != 0) { Clients.TryRemove(id, out removed); Send(3, id, null, 0); }
                pipe.Dispose();
            }
            try { pipe = Create(); }
            catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.Exit(1); }
        }
    }
    static bool ReadAll(Stream input, byte[] data) {
        int offset = 0;
        while (offset < data.Length) {
            int count = input.Read(data, offset, data.Length - offset);
            if (count == 0) return false;
            offset += count;
        }
        return true;
    }
    public static void Run(string name) {
        Name = name;
        // Create all instances with the same protected ACL before announcing ready.
        var pipes = new NamedPipeServerStream[16];
        for (int i = 0; i < pipes.Length; i++) pipes[i] = Create();
        foreach (var pipe in pipes) new Thread(Accept) { IsBackground = true }.Start(pipe);
        Send(4, 0, null, 0);
        var input = Console.OpenStandardInput();
        var header = new byte[4];
        while (ReadAll(input, header)) {
            int size = BitConverter.ToInt32(header, 0);
            if (size < 5 || size > 65541) throw new IOException("Invalid relay frame.");
            var message = new byte[size];
            if (!ReadAll(input, message)) break;
            int id = BitConverter.ToInt32(message, 1);
            NamedPipeServerStream pipe;
            if (!Clients.TryGetValue(id, out pipe)) continue;
            try {
                if (message[0] == 3) pipe.Dispose();
                else if (message[0] == 2) { pipe.Write(message, 5, size - 5); pipe.Flush(); }
            } catch (IOException) { pipe.Dispose(); } catch (ObjectDisposedException) { }
        }
        // A killed Node host closes stdin: no orphan relay/pipe survives it.
        Environment.Exit(0);
    }
}
