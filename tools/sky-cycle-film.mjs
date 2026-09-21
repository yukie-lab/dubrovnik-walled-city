// Preserve the captured pixels: this assembles the fixed-view sky inspection
// into a review video, with no grading, interpolation or synthetic frames.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const name=process.argv[2];
if(!name||!/^[\w-]+$/.test(name))throw new Error('Provide a sky-cycle record name');
const dir=new URL('../shots/rendercheck/',import.meta.url);
const report=JSON.parse(readFileSync(new URL(name+'.json',dir)));
if(report.errors.length)throw new Error('Review films require a completed capture with no errors');
for(const view of [...new Set(report.rows.map(r=>r.view))]) {
  const rows=report.rows.filter(r=>r.view===view&&Number.isFinite(r.time));
  if(!rows.length)continue;
  const files=rows.map(r=>`${name}-${view}-${r.time.toFixed(3).replace('.','_')}.png`);
  const listing=files.map(f=>`file '${f}'\nduration 0.5`).join('\n')+`\nfile '${files.at(-1)}'\n`;
  const input=new URL(`${name}-${view}-film.txt`,dir),output=new URL(`${name}-${view}.mp4`,dir);
  writeFileSync(input,listing);
  const result=spawnSync('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-y',
    '-f','concat','-safe','0','-i',input.pathname,'-vf','format=yuv420p','-r','30',
    '-c:v','libx264','-crf','17','-preset','fast','-movflags','+faststart',output.pathname],{encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr);
  console.log(`${view}: ${rows.length} original frames, ${rows.length*.5}s, ${output.pathname}`);
}
