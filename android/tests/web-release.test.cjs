const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {generate}=require('../../scripts/android-web-release.cjs');
const root=path.resolve(__dirname,'../..');
test('release describes actual immutable web assets and excludes native binaries and secrets',()=>{
  const m=generate(root,'a'.repeat(40));assert.equal(m.bridgeVersion,1);assert.equal(m.minimumNativeVersion,4);
  for(const [name,f] of Object.entries(m.files)){
    assert.match(name,/^[A-Za-z0-9_-]+\.(html|js|css|json|png|webmanifest)$/);
    const b=fs.readFileSync(path.join(root,name));assert.equal(f.size,b.length);assert.equal(f.sha256,crypto.createHash('sha256').update(b).digest('hex'));
  }
  assert.ok(m.files['home-support.js']);assert.ok(m.files['practice-data.js']);assert.ok(m.files['practice.js']);assert.ok(m.files['practice.css']);assert.ok(m.files['android-native.js']);assert.equal(m.files['sq-bank.json'],undefined);assert.equal(m.files['local.properties'],undefined);
});
test('release cannot point at a mutable branch or arbitrary URL',()=>{for(const rev of ['main','../secret','https://example.com','a'.repeat(39)])assert.throws(()=>generate(root,rev));});
