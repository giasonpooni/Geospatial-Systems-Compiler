// Compile shared reader source; tests require real exported observations.
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve('.'), out=mkdtempSync(join(tmpdir(),'synthetic-fsrt-view-'));
try {
  const compiler=join(root,'node_modules/typescript/bin/tsc');
  const args=['--strict','--target','ES2022','--module','commonjs','--lib','ES2022,DOM','--outDir',out,
    'src/lib/notation/simulated-fsrt-view.ts'];
  const compiled=existsSync(compiler)?spawnSync(process.execPath,[compiler,...args],{stdio:'inherit'}):spawnSync('tsc',args,{stdio:'inherit'});
  if(compiled.error)throw compiled.error;
  if(compiled.status!==0)throw Error('Reader compilation failed');
  if(!process.argv.includes('--compile-only')) {
    if(!process.env.SIMULATED_FSRT_VIEW_FIXTURES)throw Error('Actual exported fixture directory is required');
    const tested=spawnSync(process.execPath,['--test','validation/simulated-fsrt-view.node.mjs'],{
      stdio:'inherit',env:{...process.env,SIMULATED_FSRT_VIEW_MODULE:pathToFileURL(join(out,'simulated-fsrt-view.js')).href,
        LEGACY_FSRT_VIEW_MODULE:pathToFileURL(join(out,'fsrt-view.js')).href}});
    if(tested.error)throw tested.error;
    if(tested.status!==0)throw Error('Synthetic FSRT reader checks failed');
  }
} finally {rmSync(out,{recursive:true,force:true});}
