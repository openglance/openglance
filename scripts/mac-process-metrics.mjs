import { execFileSync } from "node:child_process";

// proc_pid_rusage uses Mach absolute ticks on Apple Silicon, not nanoseconds.
const SNAPSHOT = `import ctypes as C,json,sys
fields=['user_time','system_time','pkg_idle_wkups','interrupt_wkups','pageins','wired_size','resident_size','phys_footprint','proc_start_abstime','proc_exit_abstime','child_user_time','child_system_time','child_pkg_idle_wkups','child_interrupt_wkups','child_pageins','child_elapsed_abstime','diskio_bytesread','diskio_byteswritten']
class U(C.Structure): _fields_=[('uuid',C.c_uint8*16)]+[(f,C.c_uint64) for f in fields]
class T(C.Structure): _fields_=[('numer',C.c_uint32),('denom',C.c_uint32)]
t=T();C.CDLL('/usr/lib/libSystem.B.dylib').mach_timebase_info(C.byref(t));factor=t.numer/t.denom/1e6
lib=C.CDLL('/usr/lib/libproc.dylib');result={}
for pid in json.loads(sys.argv[1]):
 u=U()
 if lib.proc_pid_rusage(pid,2,C.byref(u))==0:result[str(pid)]={'cpuMs':(u.user_time+u.system_time)*factor,'childCpuMs':(u.child_user_time+u.child_system_time)*factor,'interruptWakeups':u.interrupt_wkups,'diskWritten':u.diskio_byteswritten}
print(json.dumps(result))`;

export function isolatedAppPid(profile) {
  const rows = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n");
  const row = rows.find(line => line.includes(`--openglance-dev-user-data-dir=${profile}`) && /\.app\/Contents\/MacOS\/[^ ]+ --/.test(line));
  return row ? Number(row.trim().split(/\s+/)[0]) : 0;
}

export function macProcessSnapshot(rootPid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).split("\n").map(row => row.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean);
  const selected = new Set([rootPid]);
  let added = true;
  while (added) {
    added = false;
    for (const row of rows) if (selected.has(Number(row[2])) && !selected.has(Number(row[1]))) { selected.add(Number(row[1])); added = true; }
  }
  const usage = JSON.parse(execFileSync("python3", ["-c", SNAPSHOT, JSON.stringify([...selected])], { encoding: "utf8" }));
  return { rootPid, processes: rows.filter(row => usage[row[1]]).map(row => ({ pid: Number(row[1]), role: Number(row[1]) === rootPid ? "main" : row[3].includes("--type=renderer") ? "renderer" : row[3].includes("--type=gpu-process") ? "gpu" : row[3].includes("network.mojom") ? "network" : "other", ...usage[row[1]] })) };
}

export function macProcessDelta(before, after) {
  const result = {};
  for (const end of after.processes) {
    const start = before.processes.find(row => row.pid === end.pid);
    if (!start) continue;
    const role = result[end.role] ??= { cpuMs: 0, childCpuMs: 0, interruptWakeups: 0, diskWritten: 0 };
    for (const key of Object.keys(role)) role[key] += end[key] - start[key];
  }
  return { roles: result, liveCpuMs: Object.values(result).reduce((sum, r) => sum + r.cpuMs, 0), completedChildCpuMs: result.main?.childCpuMs ?? 0 };
}
