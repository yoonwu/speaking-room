// Generate a descriptor for immutable, owner-controlled web assets. No credentials or APKs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
function generate(root,revision,committed=false){
  if(!/^[a-f0-9]{40}$/.test(revision)) throw Error('Expected source commit SHA');
  const read=name=>committed?execFileSync('git',['show',revision+':'+name],{cwd:root,maxBuffer:24000000}):fs.readFileSync(path.join(root,name));
  const config=JSON.parse(read('android/web-release-config.json').toString('utf8'));
  const listing=committed?execFileSync('git',['ls-tree','--name-only',revision],{cwd:root,encoding:'utf8'}).trim().split('\n'):fs.readdirSync(root);
  const names=listing.filter(n=>['index.html','android-native.js','android-voice.html','privacy.html','shadowing.html','manifest.webmanifest'].includes(n)||/^(?:.*-bank\.json|icon[^/]*\.png)$/.test(n)).sort();
  const files={};for(const name of names){const bytes=read(name);files[name]={size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}
  if(!files['index.html']||!files['android-native.js']) throw Error('Missing entry points');
  return {...config,revision,files};
}
module.exports={generate};
if(require.main===module){const root=path.resolve(__dirname,'..'),revision=process.argv[2],output=process.argv[3];if(!output)throw Error('Usage: node scripts/android-web-release.cjs COMMIT OUTPUT');fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(generate(root,revision,true),null,2)+'\n');}
