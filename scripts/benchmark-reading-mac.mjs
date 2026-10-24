#!/usr/bin/env node
// Launches only through the repository smoke controller; does not edit content.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { macProcessSnapshot, macProcessDelta, isolatedAppPid } from "./mac-process-metrics.mjs";
const { values } = parseArgs({options:{ source:{type:"string"},repo:{type:"string"},file:{type:"string",default:"README.md"},output:{type:"string"},seconds:{type:"string",default:"60"}}});
assert.ok(values.source && values.repo && values.output);
const temporary = mkdtempSync(path.join(tmpdir(), "openglance-reading-metrics-"));
const profile = path.join(temporary,"profile");const results=[];let child,exitCode,done,target,log="";
async function until(check, timeout=240000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(100);}throw Error("Timed out awaiting isolated App");}
async function evaluate(expression){return new Promise((resolve,reject)=>{const ws=new WebSocket(target.webSocketDebuggerUrl);const timer=setTimeout(()=>{ws.close();reject(Error("CDP timeout"));},20000);ws.onopen=()=>ws.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{expression,returnByValue:true,awaitPromise:true}}));ws.onmessage=({data})=>{const r=JSON.parse(data);if(r.id!==1)return;clearTimeout(timer);ws.close();if(r.error||r.result?.exceptionDetails)reject(Error(JSON.stringify(r)));else resolve(r.result.result.value);};});}
try{
 const server=createServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));const port=server.address().port;await new Promise(r=>server.close(r));
 child=spawn("make",["smoke-dev-mac"],{cwd:path.resolve(values.source),env:{...process.env,OPENGLANCE_SMOKE_USER_DATA_DIR:profile,OPENGLANCE_SMOKE_REPO_ROOT:path.resolve(values.repo),OPENGLANCE_SMOKE_FILE:values.file,OPENGLANCE_SMOKE_REMOTE_DEBUGGING_PORT:String(port)},stdio:["ignore","pipe","pipe"]});done=new Promise(r=>child.on("exit",code=>{exitCode=code;r(code);}));for(const stream of[child.stdout,child.stderr])stream.on("data",d=>{log+=d;});
 await until(async()=>{if(exitCode!=null)throw Error(log);if(!log.includes(`Agent smoke profile: ${profile}`))return false;try{target=(await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())).find(t=>t.type==="page"&&t.url.includes("file="));return target&&await evaluate("!document.documentElement.classList.contains('is-workbench-loading')");}catch{return false;}});
 const pid=isolatedAppPid(profile);assert.ok(pid);
 for(const mode of["preview","source","live"]){
  await evaluate(`document.querySelector('#mode-${mode}').click()`);
  await until(()=>evaluate(`document.querySelector('#mode-${mode}').getAttribute('aria-pressed')==='true'`),20000);
  await delay(3000);
  await evaluate("performance.clearResourceTimings();window.readingRequests=[];window.readingObserver?.disconnect();window.readingObserver=new PerformanceObserver(list=>window.readingRequests.push(...list.getEntries().filter(e=>e.name.includes('/api/')).map(e=>({path:new URL(e.name).pathname,bytes:e.decodedBodySize}))));window.readingObserver.observe({type:'resource'});");
  const before=macProcessSnapshot(pid),started=performance.now();await delay(Number(values.seconds)*1000);const after=macProcessSnapshot(pid);
  results.push({mode,seconds:(performance.now()-started)/1000,...macProcessDelta(before,after),requests:await evaluate("window.readingRequests")});console.log(JSON.stringify(results.at(-1)));
 }
}finally{
 const pid=isolatedAppPid(profile);if(pid)process.kill(pid,"SIGTERM");if(done)assert.equal(await done,0,log);
 mkdirSync(path.dirname(values.output),{recursive:true});writeFileSync(values.output,JSON.stringify(results,null,2));writeFileSync(values.output+".controller.log",log);rmSync(temporary,{recursive:true,force:true});
}
