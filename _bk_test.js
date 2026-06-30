const os=require("os"),fs=require("fs"),path=require("path");
const mysqldump=require("mysqldump");
const { Storage }=require("megajs");
(async()=>{
  try{
    console.log("1) mysqldump local...");
    let t=Date.now();
    const tmp=path.join(os.tmpdir(),"crm-test-backup.sql.gz");
    await mysqldump({ connection:{host:"127.0.0.1",port:3306,database:"crm_juridico",user:"root",password:""}, dumpToFile:tmp, compressFile:true });
    const buf=fs.readFileSync(tmp);
    console.log("   DUMP OK em "+((Date.now()-t)/1000).toFixed(1)+"s, "+Math.round(buf.length/1024)+" KB");
    console.log("2) login MEGA...");
    t=Date.now();
    const storage=await new Storage({email:"advogadaleticia.barros@gmail.com",password:"J140215l@"}).ready;
    console.log("   MEGA login OK em "+((Date.now()-t)/1000).toFixed(1)+"s");
    console.log("3) upload para MEGA...");
    t=Date.now();
    const up=storage.root.upload({name:"crm-test-backup.sql.gz",size:buf.length},buf);
    const to=setTimeout(()=>{console.log("   UPLOAD TRAVOU (>60s) -> problema e o upload megajs");process.exit(1);},60000);
    await up.complete;
    clearTimeout(to);
    console.log("   UPLOAD OK em "+((Date.now()-t)/1000).toFixed(1)+"s");
    await storage.close();
    console.log("TUDO OK - backup funciona");
    process.exit(0);
  }catch(e){ console.log("ERRO: "+e.message); process.exit(1); }
})();
